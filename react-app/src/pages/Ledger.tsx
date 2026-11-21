// Ledger statement: a customer's account in both companies for a period —
// opening balance, every transaction with a running balance, closing balance
// and the total — from the Tally data the Windows app syncs. Share it on
// WhatsApp, copy it, or print it / save it as a PDF.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { IconBrandWhatsapp, IconFileTypePdf, IconLoader2, IconPrinter } from "@tabler/icons-react";
import { Button, Card, Field, PageHeader, useToast } from "@/components/kit";
import { CustomerPicker, MessagePanel, Text } from "@/components/forms";
import { TallyFreshness } from "@/components/TallyFreshness";
import { useStore } from "@/lib/store";
import { loadTallyVouchers, logEvent, type Customer, type TallyVoucherSet } from "@/lib/data";
import { buildLedger, drcr, ledgerMessage, syncedRange, type LedgerPart } from "@/lib/ledger";
import { msgDate } from "@/lib/messages";
import { inr, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { printHtml } from "./PickList";
import { safeFileName, sharePdf } from "@/lib/pdf";
import { billsOf, useTallyBills } from "@/lib/tallydata";
import { billAge } from "@/lib/ledger";
import { fetchVoucher, summaryVoucher, tallyLedgerPdf, voucherPdf, voucherTitle } from "@/lib/tallypdf";
import type { LedgerRow as Row } from "@/lib/ledger";
import { companyIcon, useCompanies } from "@/lib/companies";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function Ledger() {
  const { customers, balances, settings } = useStore();
  const companies = useCompanies();
  const toast = useToast();
  const [params] = useSearchParams();
  const [sets, setSets] = useState<Record<string, TallyVoucherSet> | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(todayISO());
  // bill-wise pending payments (from Tally's open bills), with their age in days
  const [withBills, setWithBills] = useState(true);
  const tallyBills = useTallyBills();
  const biz = settings.businessName || "Chittam Enterprises";

  useEffect(() => {
    (async () => {
      try {
        // local development only (left out of the published build)
        if (import.meta.env.DEV && new URLSearchParams(location.search).has("demo")) setSets((await import("@/lib/demo")).demoTallyVouchers);
        else setSets(await loadTallyVouchers());
      } catch { setSets({}); }
    })();
  }, []);
  const range = useMemo(() => syncedRange(sets), [sets]);
  useEffect(() => { if (range.from && !from) setFrom(range.from); }, [range.from, from]);
  // opened from another page with ?c=<customer id>
  useEffect(() => {
    const id = params.get("c");
    if (id && !customer) { const c = customers.find((x) => x.id === id); if (c) setCustomer(c); }
  }, [params, customers, customer]);

  const parts: LedgerPart[] = useMemo(() => !customer || !sets || !from ? [] : [
    // one section per company (Chittam Enterprises, Cash, and any added in the Windows app)
    ...companies.map((c) => buildLedger(sets, balances, c.key, customer.name, c.key === "business" ? biz : c.label, from, to)),
  ].filter((p) => p.known || p.rows.length), [customer, sets, balances, from, to, biz, companies]);
  const total = parts.reduce((t, p) => t + p.closing, 0);
  const tooEarly = range.from && from < range.from;

  const [making, setMaking] = useState(false);
  async function sendPdf() {
    if (!customer || !parts.length) { toast("Pick a customer with Tally entries first."); return; }
    setMaking(true);
    try {
      const blob = await tallyLedgerPdf(settings, customer, from, to, parts, { bills: billsFor() });
      const r = await sharePdf(blob, safeFileName("Ledger " + customer.name + " " + from + " to " + to) + ".pdf",
        { mobile: customer.mobile, kind: "Ledgers", text: "Ledger statement – " + biz });
      if (r.message) toast(r.message);
      logEvent("ledger-pdf-shared", { customerName: customer.name, mobile: customer.mobile || "", from, to, savedTo: r.path || "" }).catch(() => {});
    } catch (e) { toast("Could not make the PDF: " + (e as Error).message); }
    finally { setMaking(false); }
  }

  // any voucher in the ledger, printed like Tally, to WhatsApp
  const [vbusy, setVbusy] = useState("");
  async function sendVoucher(account: string, r: Row) {
    if (!customer || !r.v) return;
    const k = account + (r.id || r.n || "") + r.d;
    setVbusy(k);
    try {
      let v = null;
      try { v = await fetchVoucher(account, r.id || "", r.d); }
      catch (e) { toast("Couldn't read the voucher from Tally (" + (e as Error).message + ") — sending the summary."); }
      const detail = v || summaryVoucher(r.v);
      const blob = await voucherPdf(settings, detail);
      const res = await sharePdf(blob, safeFileName(voucherTitle(detail) + " " + (detail.number || "") + " " + customer.name) + ".pdf",
        { mobile: customer.mobile, kind: "Vouchers", text: voucherTitle(detail) + " " + (detail.number || "") + " – " + biz });
      if (res.message) toast(res.message);
      logEvent("voucher-pdf-shared", { customerName: customer.name, mobile: customer.mobile || "", company: account, voucherType: detail.type, voucherNo: detail.number || "", date: r.d, full: !!v, savedTo: res.path || "" }).catch(() => {});
    } catch (e) { toast("Could not make the PDF: " + (e as Error).message); }
    finally { setVbusy(""); }
  }

  function billsFor() {
    if (!withBills || !customer) return undefined;
    const out: Partial<Record<string, { n: string; d: string; due?: string; a: number; od?: number }[]>> = {};
    for (const p of parts) out[p.account] = billsOf(tallyBills, p.account, customer.name);
    return out;
  }

  function print() {
    if (!customer || !parts.length) { toast("Pick a customer with Tally entries first."); return; }
    const table = (p: LedgerPart) => `<h2>${esc(p.label)}</h2><table><thead><tr><th>Date</th><th>Particulars</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th></tr></thead><tbody>
      <tr class="ob"><td>${esc(msgDate(from))}</td><td>Opening balance</td><td></td><td></td><td class="n">${esc(drcr(p.opening))}</td></tr>
      ${p.rows.map((r) => `<tr><td>${esc(msgDate(r.d))}</td><td>${esc(r.label)}</td><td class="n">${r.dr ? esc(inr(r.dr)) : ""}</td><td class="n">${r.cr ? esc(inr(r.cr)) : ""}</td><td class="n">${esc(drcr(r.bal))}</td></tr>`).join("")}
      <tr class="cb"><td>${esc(msgDate(to))}</td><td>Closing balance</td><td></td><td></td><td class="n">${esc(drcr(p.closing))}</td></tr></tbody></table>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ledger - ${esc(customer.name)}</title><style>
      @page { size: A4; margin: 14mm; } body { font: 12px/1.45 "Segoe UI", Arial, sans-serif; color: #111; }
      h1 { font-size: 18px; margin: 0; } .sub { color: #555; margin: 2px 0 14px; } h2 { font-size: 14px; margin: 18px 0 6px; }
      table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid #ddd; padding: 5px 6px; text-align: left; vertical-align: top; }
      th { font-size: 11px; text-transform: uppercase; color: #555; border-bottom: 1.5px solid #333; } .n { text-align: right; white-space: nowrap; }
      tr.ob td, tr.cb td { font-weight: 700; background: #f5f5f5; } .total { margin-top: 16px; font-size: 14px; font-weight: 700; text-align: right; }
      .foot { margin-top: 18px; color: #555; font-size: 11px; }</style></head><body>
      <h1>${esc(biz)} — Ledger statement</h1>
      <div class="sub">${esc(customer.name)}${customer.mobile ? " · " + esc(customer.mobile) : ""} · ${esc(msgDate(from))} to ${esc(msgDate(to))}${settings.address ? " · " + esc(settings.address) : ""}</div>
      ${parts.map(table).join("")}
      <div class="total">Total outstanding: ${esc(drcr(total))}</div>
      <div class="foot">From Tally. Dr = amount due to ${esc(biz)}; Cr = paid in advance. Printed ${esc(new Date().toLocaleString("en-IN"))}.</div>
      </body></html>`;
    printHtml(html, () => toast("Printing is not available here — use Copy instead."));
    logEvent("ledger-printed", { customerName: customer.name, from, to }).catch(() => {});
  }

  return (
    <div>
      <PageHeader icon="notebook" eyebrow="Messages" title="Ledger Statement" subtitle="A customer's account in every company, in Tally's layout — send it as a PDF on WhatsApp. Tap the PDF icon on any transaction to send that voucher (invoice, receipt, credit note…)."
        actions={<><Button variant="whatsapp" size="sm" onClick={sendPdf} disabled={making}><IconBrandWhatsapp size={16} /> {making ? "Making PDF…" : "PDF to WhatsApp"}</Button>
          <Button variant="secondary" size="sm" onClick={print}><IconPrinter size={16} /> Print</Button></>} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card className="space-y-4">
            <Field label="Customer"><CustomerPicker value={customer} onPick={setCustomer} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From"><Text type="date" value={from} min={range.from || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="To"><Text type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            </div>
            <p className="text-xs text-neutral-500">
              Tally transactions are synced {range.from ? "from " + msgDate(range.from) + " to " + msgDate(range.to) : "— not yet"}. The Windows app (2.9 and later) syncs from 1 April, the start of the financial year.
            </p>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="size-4 accent-brand-600" checked={withBills} onChange={(e) => setWithBills(e.target.checked)} />
              Include pending bills (bill-wise, with number of days)
            </label>
            {tooEarly && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">Transactions before {msgDate(range.from)} aren't synced, so the opening balance on {msgDate(from)} would be wrong. Start on or after {msgDate(range.from)}.</p>}
            {customer && <TallyFreshness customer={customer.name} />}
            {/* every company is checked; one without a Tally account for this customer is left out of the statement */}
            {customer && sets && companies.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {companies.map((c) => {
                  const has = parts.some((p) => p.account === c.key);
                  return (
                    <span key={c.key} className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", has ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-neutral-200 bg-neutral-50 text-neutral-500")}
                      title={has ? "In the statement" : "No Tally balance or transactions for this customer in " + c.label}>
                      {c.icon} {c.key === "business" ? biz : c.label} · {has ? "included" : "no account"}
                    </span>
                  );
                })}
              </div>
            )}
          </Card>

          {customer && sets && !parts.length && <Card className="text-sm text-neutral-500">No Tally balance or transactions for {customer.name} in any company. Check the name matches the Tally ledger.</Card>}
          {parts.map((p) => (
            <Card key={p.account} className="p-0">
              <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
                <span className="font-extrabold">{companyIcon(p.account) + " "}{p.label}</span>
                {!p.known && <span className="text-xs font-semibold text-amber-700">no Tally balance — opening taken as 0</span>}
              </div>
              <div className="divide-y divide-neutral-100 text-sm">
                <LedgerLine strong date={from} label="Opening balance" bal={p.opening} />
                {p.rows.map((r, i) => <LedgerLine key={i} date={r.d} label={r.label} dr={r.dr} cr={r.cr} bal={r.bal}
                  busy={vbusy === p.account + (r.id || r.n || "") + r.d} onShare={r.v ? () => sendVoucher(p.account, r) : undefined} />)}
                {!p.rows.length && <p className="px-4 py-3 text-neutral-500">No transactions in this period.</p>}
                <LedgerLine strong date={to} label="Closing balance" bal={p.closing} />
              </div>
            </Card>
          ))}
          {withBills && customer && parts.map((p) => {
            const bills = billsOf(tallyBills, p.account, customer.name);
            return (
              <Card key={"b" + p.account} className="p-0">
                <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
                  <span className="font-extrabold">Pending bills · {p.label}</span>
                  <span className="text-sm font-bold tabular-nums">{inr(bills.reduce((t, b) => t + b.a, 0))}</span>
                </div>
                {tallyBills === null ? <p className="px-4 py-3 text-sm text-neutral-500">Loading…</p>
                  : !bills.length ? <p className="px-4 py-3 text-sm text-neutral-500">No pending bills.</p>
                  : <div className="divide-y divide-neutral-100 text-sm">
                      {bills.map((b) => (
                        <div key={b.n} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2">
                          <span className="min-w-0"><span className="block truncate font-semibold">{b.n}</span><span className="text-xs text-neutral-500">{msgDate(b.d)}{b.due ? " · due " + msgDate(b.due) : ""}</span></span>
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", b.od ? "bg-rose-50 text-rose-700" : "bg-neutral-100 text-neutral-600")}>{billAge(b.d)} days{b.od ? " · " + b.od + " overdue" : ""}</span>
                          <span className="text-right font-semibold tabular-nums">{inr(b.a)}</span>
                        </div>
                      ))}
                    </div>}
              </Card>
            );
          })}
          {parts.length > 0 && (
            <Card className="space-y-3 border-2 border-brand-200 bg-brand-50/40">
              {parts.length > 1 && parts.map((p) => (
                <div key={"t" + p.account} className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{p.label} · closing balance</span>
                  <span className="font-bold tabular-nums">{drcr(p.closing)}</span>
                </div>
              ))}
              <div className={cn("flex items-center justify-between", parts.length > 1 && "border-t border-brand-200 pt-3")}>
                <span className="font-extrabold">{parts.length > 2 ? "Grand total (all companies)" : parts.length > 1 ? "Grand total (both companies)" : "Total outstanding"}</span>
                <span className="text-xl font-extrabold text-brand-700 tabular-nums">{drcr(total)}</span>
              </div>
              <Button variant="whatsapp" className="w-full" onClick={sendPdf} disabled={making}><IconBrandWhatsapp size={18} /> {making ? "Making PDF…" : "Send ledger PDF on WhatsApp"}</Button>
            </Card>
          )}
        </div>
        <MessagePanel title="Ledger message" type="ledger-statement" customer={customer} inputs={{ customer: customer?.name || "", from, to }}
          build={() => !customer ? "!Please select a customer first." : !parts.length ? "!No Tally entries for this customer." : ledgerMessage(settings, customer.name, from, to, parts, billsFor())} />
      </div>
    </div>
  );
}

function LedgerLine({ date, label, dr, cr, bal, strong, onShare, busy }: { date: string; label: string; dr?: number; cr?: number; bal: number; strong?: boolean; onShare?: () => void; busy?: boolean }) {
  return (
    <div className={cn("grid grid-cols-[4.5rem_1fr_auto_2rem] items-start gap-3 px-4 py-2", strong && "bg-neutral-50 font-bold")}>
      <span className="text-xs text-neutral-500 tabular-nums">{msgDate(date).replace(/ \d{4}$/, "")}</span>
      <span className="min-w-0">
        <span className="block truncate">{label}</span>
        {(dr || cr) ? <span className={cn("text-xs font-semibold tabular-nums", dr ? "text-rose-700" : "text-emerald-700")}>{dr ? inr(dr) + " Dr" : inr(cr || 0) + " Cr"}</span> : null}
      </span>
      <span className="text-right tabular-nums">{drcr(bal)}</span>
      {onShare ? <button onClick={onShare} disabled={busy} className="-my-1 rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-brand-700" title="Send this voucher as a PDF (Tally format)" aria-label="Voucher PDF to WhatsApp">
        {busy ? <IconLoader2 size={16} className="animate-spin" /> : <IconFileTypePdf size={16} />}</button> : <span />}
    </div>
  );
}
