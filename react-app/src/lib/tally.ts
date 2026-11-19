// Tally JSON imports, same rules as the current app.
import { normalizeName, uid, type Customer, type Product } from "./data";

/* ---------------- customers: Ledger Contact Details export ---------------- */

function cleanMobile(entry: Record<string, string>) {
  let d = String(entry.dspledcontact || entry.dspaddtnlmobilenum || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}

// returns the customers to save (new + changed) and a summary
export function customersFromLedgerExport(obj: unknown, existing: Customer[]) {
  const rows = (obj as { ledgercontactdetails?: { ledgercontactdetails?: Record<string, string>[] } })?.ledgercontactdetails?.ledgercontactdetails;
  if (!rows || !rows.length) throw new Error("This doesn't look like a Tally Ledger Contact Details export.");
  const byName = new Map(existing.map((c) => [normalizeName(c.name), c]));
  const changes: { item: Customer; before: Customer | null }[] = [];
  let added = 0, updated = 0, skippedBank = 0;
  for (const r of rows) {
    const name = (r.acctypename || "").trim();
    if (!name) continue;
    if (/bank a\/c/i.test(name)) { skippedBank++; continue; }
    const mobile = cleanMobile(r);
    const match = byName.get(normalizeName(name));
    if (match) {
      if (mobile && !match.mobile) {
        const item = { ...match, mobile };
        changes.push({ item, before: match });
        byName.set(normalizeName(name), item);
        updated++;
      }
    } else {
      const item: Customer = { id: uid(), name, mobile };
      changes.push({ item, before: null });
      byName.set(normalizeName(name), item);
      added++;
    }
  }
  return { changes, summary: { added, updated, skippedBank, rows: rows.length } };
}

/* ---------------- products: Stock Summary export ---------------- */

interface StockLine {
  dspaccname?: { dspdispname?: string };
  ssgrpexplosion?: { dspaccline?: StockLine[] };
  dspstkinfo?: { dspstkcl?: { dspclqty?: string; dspclrate?: string } }[];
}

function flatten(lines: StockLine[], items: { name: string; rate?: string; category: string }[] = [], category = "") {
  for (const line of lines || []) {
    const name = line.dspaccname?.dspdispname || "";
    const sub = line.ssgrpexplosion?.dspaccline;
    if (sub && sub.length) flatten(sub, items, category || name);
    else items.push({ name, rate: line.dspstkinfo?.[0]?.dspstkcl?.dspclrate, category });
  }
  return items;
}

export function productsFromStockExport(obj: unknown, existing: Product[]) {
  const lines = (obj as { dspaccbody?: { dspaccline?: StockLine[] } })?.dspaccbody?.dspaccline;
  if (!lines || !lines.length) throw new Error("This doesn't look like a Tally Stock Summary export.");
  const usable = flatten(lines).filter((it) => it.name.trim());
  const byName = new Map(existing.map((p) => [normalizeName(p.name), p]));
  const changes: { item: Product; before: Product | null }[] = [];
  let added = 0, updated = 0, noPrice = 0;
  for (const it of usable) {
    const key = normalizeName(it.name);
    const price = it.rate && parseFloat(it.rate) > 0 ? parseFloat(it.rate) : 0;
    if (!price) noPrice++;
    const match = byName.get(key);
    if (match) {
      const next = { ...match };
      if (price && match.price !== price) { next.price = price; updated++; }
      if (it.category && !match.category) next.category = it.category;
      if (next.price !== match.price || next.category !== match.category) { changes.push({ item: next, before: match }); byName.set(key, next); }
    } else {
      const item: Product = { id: uid(), name: it.name, category: it.category || "", price };
      changes.push({ item, before: null });
      byName.set(key, item);
      added++;
    }
  }
  return { changes, summary: { added, updated, noPrice } };
}

/* ---------------- closing balances (Group Summary of Sundry Debtors) ---------------- */
// Tally shows debit as negative and credit as positive; a customer who owes
// us has a debit balance, so receivable = -(debit) - credit
function balNum(v: unknown) {
  if (v === undefined || v === null || v === "") return 0;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
}
const balAmount = (dr: unknown, cr: unknown) => Math.round((-balNum(dr) - balNum(cr)) * 100) / 100;
function getCI(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const k = Object.keys(obj).find((x) => x.toLowerCase() === key);
  return k === undefined ? undefined : (obj as Record<string, unknown>)[k];
}
const firstOf = (v: unknown) => (Array.isArray(v) ? v[0] : v);
function infoAmounts(info: unknown) {
  const i = firstOf(info) || {};
  return balAmount(getCI(firstOf(getCI(i, "dspcldramt")) || {}, "dspcldramta"), getCI(firstOf(getCI(i, "dspclcramt")) || {}, "dspclcramta"));
}
function nameOf(n: unknown) {
  const v = firstOf(n);
  return typeof v === "string" ? v : String(getCI(v || {}, "dspdispname") || "").trim();
}
// [{name, amount}] from Tally's JSON or XML export
export function parseTallyBalances(text: string) {
  const rows: { name: string; amount: number }[] = [];
  text = text.trim();
  if (text.charAt(0) === "<") {
    text = text.replace(/&#(\d+);/g, (m, n) => { const c = Number(n); return c < 32 && c !== 9 && c !== 10 && c !== 13 ? "" : m; });
    const doc = new DOMParser().parseFromString(text, "text/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("not valid XML");
    const names = doc.getElementsByTagName("DSPACCNAME");
    for (let i = 0; i < names.length; i++) {
      let info = names[i].nextElementSibling;
      while (info && info.tagName !== "DSPACCINFO" && info.tagName !== "DSPACCNAME") info = info.nextElementSibling;
      if (!info || info.tagName !== "DSPACCINFO") continue;
      const nm = names[i].getElementsByTagName("DSPDISPNAME")[0];
      const dr = info.getElementsByTagName("DSPCLDRAMTA")[0], cr = info.getElementsByTagName("DSPCLCRAMTA")[0];
      if (nm) rows.push({ name: (nm.textContent || "").trim(), amount: balAmount(dr?.textContent, cr?.textContent) });
    }
    return rows;
  }
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    const nm = getCI(node, "dspaccname"), info = getCI(node, "dspaccinfo");
    if (nm !== undefined && info !== undefined) {
      if (Array.isArray(nm) && Array.isArray(info) && nm.length === info.length && nm.length > 1) nm.forEach((n, i) => rows.push({ name: nameOf(n), amount: infoAmounts(info[i]) }));
      else rows.push({ name: nameOf(nm), amount: infoAmounts(info) });
    }
    Object.values(node as Record<string, unknown>).forEach((v) => { if (v && typeof v === "object") walk(v); });
  };
  walk(JSON.parse(text));
  return rows.filter((r) => r.name);
}
