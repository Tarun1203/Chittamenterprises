// Possible duplicate customers: the same name written differently
// ("Tirumala Electronics - Raichur" / "Tirumala Electronics Raichur"), a small
// spelling slip ("Kushi" / "Khushi"), or the same mobile number. Pairs marked
// "not duplicates" (saved in settings) are left out.
import type { Customer } from "./data";

// letters and digits only, lower case
export const nameKey = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const mobileKey = (s?: string) => { const d = (s || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };

function distance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export const pairKey = (a: string, b: string) => (a < b ? a + "|" + b : b + "|" + a);

export interface DupGroup { ids: string[]; reasons: string[] }

export function findDuplicates(customers: Customer[], notDuplicates: string[] = []): DupGroup[] {
  const skip = new Set(notDuplicates);
  const list = customers.map((c) => ({ c, k: nameKey(c.name), m: mobileKey(c.mobile) }));
  const parent = new Map(list.map((x) => [x.c.id, x.c.id]));
  const find = (id: string): string => { let r = id; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
  const reasons = new Map<string, Set<string>>();
  const join = (a: string, b: string, why: string) => {
    if (skip.has(pairKey(a, b))) return;
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
    const k = pairKey(a, b);
    if (!reasons.has(k)) reasons.set(k, new Set());
    reasons.get(k)!.add(why);
  };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const x = list[i], y = list[j];
      if (x.k && x.k === y.k) join(x.c.id, y.c.id, "same name");
      else if (x.k.length >= 8 && y.k.length >= 8) {
        const max = Math.min(x.k.length, y.k.length) >= 16 ? 2 : 1;
        if (distance(x.k, y.k, max) <= max) join(x.c.id, y.c.id, "similar name");
      }
      if (x.m && x.m === y.m) join(x.c.id, y.c.id, "same mobile");
    }
  }
  const groups = new Map<string, string[]>();
  for (const x of list) {
    const r = find(x.c.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(x.c.id);
  }
  return [...groups.values()].filter((g) => g.length > 1).map((ids) => {
    const why = new Set<string>();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) reasons.get(pairKey(ids[i], ids[j]))?.forEach((r) => why.add(r));
    return { ids, reasons: [...why] };
  });
}
