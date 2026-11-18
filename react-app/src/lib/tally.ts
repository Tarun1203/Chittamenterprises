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
