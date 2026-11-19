// Tally Match: payments recorded in the app against Tally's receipt vouchers,
// and possible duplicate transactions on either side. Pure functions, so the
// rules are easy to read and check.
import { normalizeName, type Receipt, type TallyVoucher, type TallyVoucherSet } from "./data";

export type Account = "business" | "cash";
export const DAY_WINDOW = 3;          // a payment and its Tally entry may be a few days apart
const SAME_AMOUNT = (a: number, b: number) => Math.abs(a - b) < 1;
const days = (a: string, b: string) => Math.abs(Math.round((new Date(a + "T00:00:00").getTime() - new Date(b + "T00:00:00").getTime()) / 86400000));

export interface AppPayment { key: string; receiptId: string; account: Account; date: string; name: string; amount: number; mode: string; source: string; ref?: string }
export interface TallyEntry extends TallyVoucher { key: string; account: Account }

export const isReceipt = (v: TallyVoucher) => !v.dr && /receipt/i.test(v.t);

// one line per account: a payment split between both accounts is two lines
export function appPayments(receipts: Receipt[], from: string, to: string): AppPayment[] {
  const out: AppPayment[] = [];
  receipts.filter((r) => !r.cancelled && r.date >= from && r.date <= to).forEach((r) => {
    const base = { receiptId: r.id, date: r.date, name: r.customerName, mode: r.mode, source: r.source, ref: r.ref };
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

export interface MatchResult {
  matched: { app: AppPayment; tally: TallyEntry; dayGap: number }[];
  nameDiffers: { app: AppPayment; tally: TallyEntry; dayGap: number }[];  // same amount and date, different name
  onlyApp: AppPayment[];      // recorded in the app, not found in Tally
  onlyTally: TallyEntry[];    // in Tally, not recorded in the app
}

export function matchPayments(app: AppPayment[], tally: TallyEntry[]): MatchResult {
  const used = new Set<string>();
  const res: MatchResult = { matched: [], nameDiffers: [], onlyApp: [], onlyTally: [] };
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
  const left: AppPayment[] = [];
  for (const a of sorted) {
    const m = pick(a, true);
    if (m) { used.add(m.tally.key); res.matched.push({ app: a, tally: m.tally, dayGap: m.gap }); } else left.push(a);
  }
  for (const a of left) {
    const m = pick(a, false);
    if (m) { used.add(m.tally.key); res.nameDiffers.push({ app: a, tally: m.tally, dayGap: m.gap }); } else res.onlyApp.push(a);
  }
  res.onlyTally = tally.filter((t) => !used.has(t.key));
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
