// Tally stock and open invoices, sent by the Windows app on the Tally PC.
// Read once when first needed (not kept live: they change at most every
// 30 minutes) and shared by every page.
import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "./firebase";
import { normalizeName } from "./data";

export interface StockItem { n: string; q: number; u?: string }
export interface StockSet { company: string; label?: string; tallyCompany?: string; syncedAt?: string; items: Record<string, StockItem> }
export interface TallyBill { p: string; n: string; d: string; due: string; a: number; od: number }
export interface BillSet { company: string; label?: string; tallyCompany?: string; syncedAt?: string; asOn?: string; bills: TallyBill[] }

const isDemo = () => import.meta.env.DEV && new URLSearchParams(location.search).has("demo");
const cache: { stock?: Promise<Record<string, StockSet>>; bills?: Promise<Record<string, BillSet>> } = {};

async function load<T>(coll: "tallyStock" | "tallyBills"): Promise<Record<string, T>> {
  // local development only (left out of the published build)
  if (import.meta.env.DEV && isDemo()) {
    const d = await import("./demo");
    return (coll === "tallyStock" ? d.demoTallyStock : d.demoTallyBills) as unknown as Record<string, T>;
  }
  const snap = await getDocs(collection(db, coll));
  const out: Record<string, T> = {};
  snap.docs.forEach((d) => { out[d.id] = d.data() as T; });
  return out;
}

function useLoaded<T>(key: "stock" | "bills", coll: "tallyStock" | "tallyBills") {
  const [data, setData] = useState<Record<string, T> | null>(null);
  useEffect(() => {
    let alive = true;
    if (!cache[key]) cache[key] = load<T>(coll).catch(() => ({})) as never;
    (cache[key] as unknown as Promise<Record<string, T>>).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [key, coll]);
  return data;
}
export const useTallyStock = () => useLoaded<StockSet>("stock", "tallyStock");
export const useTallyBills = () => useLoaded<BillSet>("bills", "tallyBills");

// stock of one product: every company added up (goods bought in one book are
// often sold in another, so one alone can be wrong or negative)
export function stockOf(sets: Record<string, StockSet> | null, name: string) {
  if (!sets) return null;
  const k = normalizeName(name);
  const per: Record<string, number> = {};
  let unit = "", found = false;
  for (const [co, set] of Object.entries(sets)) {
    const it = set?.items?.[k];
    if (!it) continue;
    found = true; per[co] = it.q; unit = unit || it.u || "";
  }
  if (!found) return null;
  const total = Math.round(Object.values(per).reduce((t, q) => t + q, 0) * 100) / 100;
  return { total, business: per.business, cash: per.cash, per, unit };
}

// a customer's open invoices in one company, oldest first
export function billsOf(sets: Record<string, BillSet> | null, company: string, customerName: string) {
  const k = normalizeName(customerName);
  return (sets?.[company]?.bills || []).filter((b) => normalizeName(b.p) === k && b.a > 0).sort((x, y) => (x.d || "").localeCompare(y.d || ""));
}

export const syncedWhen = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
