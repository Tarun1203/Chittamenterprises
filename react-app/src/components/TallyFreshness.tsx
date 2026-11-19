// Warns when the Tally figures are out of date: the Windows app on the Tally
// PC writes a "last checked" note (balances/status) on every sync, every 30
// minutes. If it's older than a couple of hours, the PC is probably off or
// Tally is closed, and balances / stock / invoices may be old.
import { IconAlertTriangle } from "@tabler/icons-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { normalizeName } from "@/lib/data";
import { inr } from "@/lib/format";

interface Misfiled { company: string; label?: string; name: string; group?: string; a: number; dr: boolean }
interface Status { checkedAt?: string; ok?: boolean; error?: string; misfiled?: Misfiled[] }
const STALE_HOURS = 2;

export function useTallyFreshness() {
  const { balances } = useStore();
  const st = (balances as unknown as Record<string, Status | undefined>).status;
  const last = st?.checkedAt || balances.business?.importedAt || balances.cash?.importedAt || "";
  if (!last) return null;
  const hours = (Date.now() - new Date(last).getTime()) / 3600e3;
  const age = hours < 1 ? Math.max(1, Math.round(hours * 60)) + " min" : hours < 48 ? Math.round(hours) + " hours" : Math.round(hours / 24) + " days";
  const stale = hours > STALE_HOURS;
  const problem = st && st.ok === false ? st.error || "Tally could not be reached" : "";
  return { stale, problem, age, last };
}

// customers whose Tally ledger sits under Sundry Creditors: their balance and
// transactions aren't synced (the Windows app checks on every sync)
export function useMisfiled(customerName?: string) {
  const { balances } = useStore();
  const all = (balances as unknown as Record<string, Status | undefined>).status?.misfiled || [];
  return customerName === undefined ? all : all.filter((m) => normalizeName(m.name) === normalizeName(customerName));
}

export function MisfiledNote({ customer, className }: { customer?: string; className?: string }) {
  const list = useMisfiled(customer);
  if (!list.length) return null;
  const one = (m: Misfiled) => "“" + m.name + "” is under " + (m.group || "Sundry Creditors") + " in Tally (" + (m.label || m.company) + "), not Sundry Debtors — its balance " +
    inr(m.a) + (m.dr ? " Dr" : m.a ? " Cr" : "") + " and its transactions aren't included here.";
  return (
    <div className={cn("flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800", className)}>
      <IconAlertTriangle size={15} className="mt-px shrink-0" />
      <span>
        {customer !== undefined ? one(list[0]) + (list.length > 1 ? " Same in " + list.slice(1).map((m) => m.label || m.company).join(", ") + "." : "")
          : <>{list.length} customer{list.length > 1 ? "s are" : " is"} filed under Sundry Creditors in Tally, so {list.length > 1 ? "their balances are" : "the balance is"} missing: {list.map((m) => m.name + " (" + (m.label || m.company) + ", " + inr(m.a) + (m.dr ? " Dr" : " Cr") + ")").join("; ")}.</>}
        {" "}In Tally, alter the ledger and set “Under” to Sundry Debtors (or a group under it, e.g. Raichur).
      </span>
    </div>
  );
}

export function TallyFreshness({ className, what = "Tally figures", customer }: { className?: string; what?: string; customer?: string }) {
  const f = useTallyFreshness();
  const misfiled = <MisfiledNote customer={customer} className={className} />;
  if (!f || (!f.stale && !f.problem)) return misfiled;
  return (<>{misfiled}
    <div className={cn("flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800", className)}>
      <IconAlertTriangle size={15} className="mt-px shrink-0" />
      <span>
        {f.stale ? what + " are " + f.age + " old — the Tally PC may be off or Tally closed. Check before sending." : ""}
        {f.problem ? (f.stale ? " " : "") + f.problem + " at the last check (" + f.age + " ago)." : ""}
      </span>
    </div></>
  );
}
