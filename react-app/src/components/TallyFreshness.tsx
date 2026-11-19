// Warns when the Tally figures are out of date: the Windows app on the Tally
// PC writes a "last checked" note (balances/status) on every sync, every 30
// minutes. If it's older than a couple of hours, the PC is probably off or
// Tally is closed, and balances / stock / invoices may be old.
import { IconAlertTriangle } from "@tabler/icons-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

interface Status { checkedAt?: string; ok?: boolean; error?: string }
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

export function TallyFreshness({ className, what = "Tally figures" }: { className?: string; what?: string }) {
  const f = useTallyFreshness();
  if (!f || (!f.stale && !f.problem)) return null;
  return (
    <div className={cn("flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800", className)}>
      <IconAlertTriangle size={15} className="mt-px shrink-0" />
      <span>
        {f.stale ? what + " are " + f.age + " old — the Tally PC may be off or Tally closed. Check before sending." : ""}
        {f.problem ? (f.stale ? " " : "") + f.problem + " at the last check (" + f.age + " ago)." : ""}
      </span>
    </div>
  );
}
