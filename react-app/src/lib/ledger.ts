// A customer's ledger statement in both companies, from the Tally data the
// Windows app syncs: the transactions (last N days) and today's closing
// balance. The opening balance is worked out backwards from the closing one,
// so the statement always ends on Tally's own balance.
import { normalizeName, type BalanceSet, type Settings, type TallyVoucher, type TallyVoucherSet } from "./data";
import { msgDate } from "./messages";
import { inr } from "./format";

import { companyIcon } from "./companies";

export type Account = string;   // a company key
export interface LedgerRow { d: string; label: string; dr: number; cr: number; bal: number; t?: string; n?: string; via?: string; nar?: string; id?: string; v?: TallyVoucher }
export interface LedgerPart { account: Account; label: string; opening: number; rows: LedgerRow[]; closing: number; known: boolean }

const key = (s?: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const round = (n: number) => Math.round(n * 100) / 100;
export const drcr = (n: number) => (Math.abs(n) < 0.005 ? inr(0) : inr(Math.abs(round(n))) + (n > 0 ? " Dr" : " Cr"));

// the dates the synced transactions cover (earliest "from" to latest "to")
export function syncedRange(sets: Record<string, TallyVoucherSet> | null) {
  const keys = Object.keys(sets || {}).filter((k) => k !== "status");
  const f = keys.map((a) => sets?.[a]?.from).filter(Boolean).sort() as string[];
  const t = keys.map((a) => sets?.[a]?.to).filter(Boolean).sort() as string[];
  return { from: f[f.length - 1] || "", to: t[t.length - 1] || "" };   // the range both companies cover
}

export function buildLedger(sets: Record<string, TallyVoucherSet> | null, balances: Record<string, BalanceSet>, account: Account,
  customerName: string, label: string, from: string, to: string): LedgerPart {
  const k = key(customerName);
  const all = (sets?.[account]?.vouchers || []).filter((v) => key(v.p) === k).sort((a, b) => a.d.localeCompare(b.d) || (a.n || "").localeCompare(b.n || ""));
  const balMap = balances[account]?.balances || {};
  let closingNow = balMap[normalizeName(customerName)];
  if (closingNow === undefined) {
    const hit = Object.keys(balMap).find((x) => key(x) === k);
    if (hit) closingNow = balMap[hit];
  }
  const known = closingNow !== undefined;
  const move = (v: { a: number; dr: boolean }) => (v.dr ? v.a : -v.a);   // what the customer owes goes up on a debit
  // closing at "to" = today's closing minus anything after "to"; opening = that minus the period's movements
  const after = all.filter((v) => v.d > to).reduce((t, v) => t + move(v), 0);
  const closing = round((closingNow || 0) - after);
  const inPeriod = all.filter((v) => v.d >= from && v.d <= to);
  const opening = round(closing - inPeriod.reduce((t, v) => t + move(v), 0));
  let bal = opening;
  const rows = inPeriod.map((v) => {
    bal = round(bal + move(v));
    return { d: v.d, label: v.t + (v.n ? " " + v.n : "") + (v.nar ? " — " + v.nar : ""), dr: v.dr ? v.a : 0, cr: v.dr ? 0 : v.a, bal, t: v.t, n: v.n, via: v.via, nar: v.nar, id: v.id, v };
  });
  return { account, label, opening, rows, closing, known };
}

// the WhatsApp text
export interface LedgerBill { n: string; d: string; due?: string; a: number; od?: number }
export const billAge = (iso: string) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86400e3)) : 0);

export function ledgerMessage(s: Settings, customerName: string, from: string, to: string, parts: LedgerPart[], bills?: Partial<Record<Account, LedgerBill[]>>) {
  const total = parts.reduce((t, p) => t + p.closing, 0);
  let msg = "📒 *Ledger Statement – " + s.businessName + "*\n\n" +
    "Dear " + customerName + ",\n\n" +
    "Here is your account statement from *" + msgDate(from) + "* to *" + msgDate(to) + "*.\n";
  parts.forEach((p) => {
    msg += "\n" + companyIcon(p.account) + " *" + p.label + "*\n" +
      "Opening Balance: " + drcr(p.opening) + "\n";
    if (!p.rows.length) msg += "No transactions in this period.\n";
    p.rows.forEach((r) => {
      msg += "• " + msgDate(r.d) + " · " + r.label.replace(/ — .*$/, "") + " · " + (r.dr ? inr(r.dr) + " Dr" : inr(r.cr) + " Cr") + "\n";
    });
    msg += "*Closing Balance: " + drcr(p.closing) + "*\n";
    const pb = bills?.[p.account];
    if (pb) {
      msg += "_Pending bills:_\n";
      if (!pb.length) msg += "None\n";
      pb.forEach((b) => { msg += "▫️ " + b.n + " · " + msgDate(b.d) + " · " + inr(b.a) + " · " + billAge(b.d) + " days" + (b.od ? " (" + b.od + " overdue)" : "") + "\n"; });
    }
  });
  if (parts.length > 1) msg += "\n" + parts.map((p) => p.label + ": " + drcr(p.closing)).join("\n");
  msg += "\n🔹 *" + (parts.length > 2 ? "Grand Total (all companies)" : parts.length > 1 ? "Grand Total (both companies)" : "Total Outstanding") + ": " + drcr(total) + "*\n\n" +
    "Kindly verify and let us know if anything differs from your records.\n\n" +
    "Regards,\n" + s.businessName + (s.address ? "\n" + s.address : "");
  return msg;
}
