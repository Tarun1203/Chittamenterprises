// Tally Match: payments recorded in the app against Tally's receipt vouchers,
// and possible duplicate transactions on either side. Pure functions, so the
// rules are easy to read and check.
import { normalizeName, type Receipt, type TallyVoucher, type TallyVoucherSet } from "./data";

export type Account = "business" | "cash";
export const DAY_WINDOW = 3;          // a payment and its Tally entry may be a few days apart
const SAME_AMOUNT = (a: number, b: number) => Math.abs(a - b) < 1;
const days = (a: string, b: string) => Math.abs(Math.round((new Date(a + "T00:00:00").getTime() - new Date(b + "T00:00:00").getTime()) / 86400000));

export interface AppPayment { key: string; receiptId: string; account: Account; date: string; name: string; amount: number; mode: string; source: string; ref?: string; tallyNo?: string; tallyId?: string }
export interface TallyEntry extends TallyVoucher { key: string; account: Account }

export const isReceipt = (v: TallyVoucher) => !v.dr && /receipt/i.test(v.t);

// how a payment was made: cash, or bank (UPI, transfer, cheque…); "" when unknown
export type PayKind = "cash" | "bank" | "";
export const modeKind = (mode: string): PayKind => (!mode || /advance|^—$/i.test(mode) ? "" : /cash/i.test(mode) ? "cash" : "bank");
// how Tally booked it, from the voucher's other ledger(s)
export const viaKind = (via?: string): PayKind => (!via ? "" : /(^|[^a-z])cash([^a-z]|$)/i.test(via) ? "cash" : "bank");

// one line per account: a payment split between both accounts is two lines
export function appPayments(receipts: Receipt[], from: string, to: string): AppPayment[] {
  const out: AppPayment[] = [];
  receipts.filter((r) => !r.cancelled && r.date >= from && r.date <= to).forEach((r) => {
    const base = { receiptId: r.id, date: r.date, name: r.customerName, mode: r.mode, source: r.source, ref: r.ref, tallyNo: r.tallyNo, tallyId: r.tallyId };
    if (Number(r.business) > 0) out.push({ ...base, key: r.id + ":b", account: "business", amount: Number(r.business) });
    if (Number(r.cash) > 0) out.push({ ...base, key: r.id + ":c", account: "cash", amount: Number(r.cash) });
  });
  return out;
}

export function tallyEntries(sets: Record<string, TallyVoucherSet>, from: string, to: string, only?: (v: TallyVoucher) => boolean): TallyEntry[] {
  const out: TallyEntry[] = [];
  (["business", "cash"] as Account[]).forEach((acc) => {
    (sets[acc]?.vouchers || []).forEach((v, i) => {
      if (v.d < from || v.d > to || (only && !only(v))) return;
      out.push({ ...v, key: acc + ":" + (v.id || i), account: acc });
    });
  });
  return out;
}

export interface Pair { app: AppPayment; tally: TallyEntry; dayGap: number; byVoucher: boolean; differs: string[] }
export interface MatchResult {
  matched: Pair[];
  detailsDiffer: Pair[];      // matched, but paid differently / other amount / dates far apart
  nameDiffers: Pair[];        // same amount and date, different name
  onlyApp: AppPayment[];      // recorded in the app, not found in Tally
  recordedTwice: { app: AppPayment; other: Pair }[];  // its Tally receipt is already matched to another payment
  onlyTally: TallyEntry[];    // in Tally, not recorded in the app
}

const sameNo = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

function differences(a: AppPayment, t: TallyEntry, gap: number) {
  const out: string[] = [];
  const am = modeKind(a.mode), tm = viaKind(t.via);
  if (am && tm && am !== tm) out.push("Paid by " + a.mode + " in the app, booked to " + t.via + " in Tally");
  if (!SAME_AMOUNT(a.amount, t.a)) out.push("Amount differs");
  if (gap > DAY_WINDOW) out.push("Dates " + gap + " days apart");
  return out;
}

export function matchPayments(app: AppPayment[], tally: TallyEntry[]): MatchResult {
  const used = new Set<string>();
  const res: MatchResult = { matched: [], detailsDiffer: [], nameDiffers: [], onlyApp: [], recordedTwice: [], onlyTally: [] };
  const add = (list: Pair[], a: AppPayment, t: TallyEntry, gap: number, byVoucher: boolean) => {
    used.add(t.key);
    const differs = differences(a, t, gap);
    (differs.length && list === res.matched ? res.detailsDiffer : list).push({ app: a, tally: t, dayGap: gap, byVoucher, differs });
  };
  const pick = (a: AppPayment, sameName: boolean) => {
    let best: TallyEntry | null = null, gap = Infinity;
    for (const t of tally) {
      if (used.has(t.key) || t.account !== a.account || !SAME_AMOUNT(t.a, a.amount)) continue;
      if (sameName !== (normalizeName(t.p) === normalizeName(a.name))) continue;
      const g = days(t.d, a.date);
      if (g <= DAY_WINDOW && g < gap) { best = t; gap = g; }
    }
    return best ? { tally: best, gap } : null;
  };
  const sorted = [...app].sort((x, y) => x.date.localeCompare(y.date));
  // 1. payments linked to a Tally voucher (by its Tally id, else its voucher number)
  const rest: AppPayment[] = [];
  for (const a of sorted) {
    const t = (a.tallyNo || a.tallyId) ? tally.find((v) => !used.has(v.key) && v.account === a.account && ((a.tallyId && v.id === a.tallyId) || sameNo(v.n, a.tallyNo))) : undefined;
    if (t) add(res.matched, a, t, days(t.d, a.date), true); else rest.push(a);
  }
  // 2. same customer and amount, within a few days
  const left: AppPayment[] = [];
  for (const a of rest) {
    const m = pick(a, true);
    if (m) add(res.matched, a, m.tally, m.gap, false); else left.push(a);
  }
  // 3. same amount and date but another name
  for (const a of left) {
    const m = pick(a, false);
    if (m) add(res.nameDiffers, a, m.tally, m.gap, false); else res.onlyApp.push(a);
  }
  res.onlyTally = tally.filter((t) => !used.has(t.key));
  // a leftover payment whose Tally receipt already went to another payment of the
  // same customer (linked to the same voucher, or same amount within a few days):
  // most likely the same payment entered twice in the app
  const pairs = [...res.matched, ...res.detailsDiffer];
  res.onlyApp = res.onlyApp.filter((a) => {
    const other = pairs.find((p) => p.app.receiptId !== a.receiptId && p.tally.account === a.account && (
      (a.tallyId && p.tally.id === a.tallyId) || sameNo(p.tally.n, a.tallyNo) ||
      (normalizeName(p.app.name) === normalizeName(a.name) && SAME_AMOUNT(p.tally.a, a.amount) && days(p.tally.d, a.date) <= DAY_WINDOW)));
    if (other) { res.recordedTwice.push({ app: a, other }); return false; }
    return true;
  });
  return res;
}

/* ---------------- possible duplicates ---------------- */
export interface DupGroup<T> { why: string; items: T[] }

// entries with the same key whose dates fall within DAY_WINDOW of each other
function clusters<T>(items: T[], key: (x: T) => string, date: (x: T) => string, why: string): DupGroup<T>[] {
  const groups = new Map<string, T[]>();
  items.forEach((x) => { const k = key(x); groups.set(k, [...(groups.get(k) || []), x]); });
  const out: DupGroup<T>[] = [];
  groups.forEach((list) => {
    if (list.length < 2) return;
    const s = [...list].sort((a, b) => date(a).localeCompare(date(b)));
    let cur: T[] = [s[0]];
    for (let i = 1; i < s.length; i++) {
      if (days(date(s[i]), date(cur[cur.length - 1])) <= DAY_WINDOW) cur.push(s[i]);
      else { if (cur.length > 1) out.push({ why, items: cur }); cur = [s[i]]; }
    }
    if (cur.length > 1) out.push({ why, items: cur });
  });
  return out;
}

export function tallyDuplicates(entries: TallyEntry[]): DupGroup<TallyEntry>[] {
  const sameEntry = clusters(entries, (v) => [v.account, v.t.toLowerCase(), normalizeName(v.p), v.a.toFixed(2), v.dr].join("|"), (v) => v.d,
    "Same customer, type and amount within " + DAY_WINDOW + " days");
  // the same voucher number used twice for the same voucher type
  const byNo = new Map<string, TallyEntry[]>();
  entries.filter((v) => v.n).forEach((v) => { const k = [v.account, v.t.toLowerCase(), v.n.toLowerCase()].join("|"); byNo.set(k, [...(byNo.get(k) || []), v]); });
  const sameNo: DupGroup<TallyEntry>[] = [];
  byNo.forEach((list) => { if (new Set(list.map((v) => v.id || v.key)).size > 1) sameNo.push({ why: "Same voucher number used twice", items: list }); });
  return [...sameNo, ...sameEntry];
}

export function appDuplicates(receipts: Receipt[], from: string, to: string): DupGroup<Receipt>[] {
  const live = receipts.filter((r) => !r.cancelled && r.date >= from && r.date <= to);
  return clusters(live, (r) => [r.customerId || normalizeName(r.customerName), (Number(r.business) || 0).toFixed(2), (Number(r.cash) || 0).toFixed(2)].join("|"), (r) => r.date,
    "Same customer and amount within " + DAY_WINDOW + " days");
}
