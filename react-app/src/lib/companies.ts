// The Tally companies the app works with. Chittam Enterprises ("business") and
// Cash ("cash") always; more are added in the Windows app (Tally Sync →
// Companies), which lists them in the status note it writes on every sync.
// A payment keeps its amount for business / cash in its own fields (as always)
// and for any other company in `extra[key]`.
import { useMemo } from "react";
import { useStore } from "./store";
import type { BalanceSet, Receipt, Settings } from "./data";

export interface Company { key: string; label: string; icon: string; tallyCompany?: string }
export type Account = string;

const num = (v: unknown) => Number(v) || 0;
export const companyIcon = (key: string) => (key === "business" ? "🏢" : key === "cash" ? "💵" : "🏬");

export function companyList(balances: Record<string, BalanceSet>, settings: Settings): Company[] {
  const accounts = ((balances as unknown as Record<string, { accounts?: { key: string; label: string; company?: string }[] } | undefined>).status?.accounts) || [];
  const list: Company[] = [
    { key: "business", label: settings.businessName || "Chittam Enterprises", icon: "🏢", tallyCompany: accounts.find((a) => a.key === "business")?.company },
    { key: "cash", label: "Cash", icon: "💵", tallyCompany: accounts.find((a) => a.key === "cash")?.company },
  ];
  for (const a of accounts) if (a.key && a.key !== "business" && a.key !== "cash" && !list.some((c) => c.key === a.key))
    list.push({ key: a.key, label: a.label || a.company || a.key, icon: "🏬", tallyCompany: a.company });
  return list;
}

export function useCompanies() {
  const { balances, settings } = useStore();
  return useMemo(() => companyList(balances, settings), [balances, settings]);
}

// a payment's amount for one company
export function amountOf(r: Pick<Receipt, "business" | "cash" | "extra">, key: string) {
  return key === "business" ? num(r.business) : key === "cash" ? num(r.cash) : num(r.extra?.[key]);
}
// the same payment with one company's amount changed
export function withAmount<T extends Pick<Receipt, "business" | "cash" | "extra">>(r: T, key: string, v: number): T {
  const val = Math.round(v * 100) / 100;
  if (key === "business") return { ...r, business: val };
  if (key === "cash") return { ...r, cash: val };
  const extra = { ...(r.extra || {}) };
  if (val) extra[key] = val; else delete extra[key];
  return { ...r, extra };
}
export function receiptTotal(r: Pick<Receipt, "business" | "cash" | "extra">) {
  return num(r.business) + num(r.cash) + Object.values(r.extra || {}).reduce((t, v) => t + num(v), 0);
}
// every company a payment has an amount in
export const receiptKeys = (r: Pick<Receipt, "business" | "cash" | "extra">) =>
  ["business", "cash", ...Object.keys(r.extra || {})].filter((k) => amountOf(r, k) > 0);
