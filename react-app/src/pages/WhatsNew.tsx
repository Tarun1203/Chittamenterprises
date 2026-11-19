// What's new: every update, newest first.
import { motion } from "motion/react";
import { Card, PageHeader } from "@/components/kit";
import { RELEASES } from "@/lib/changelog";
import { msgDate } from "@/lib/messages";
import { APP_VERSION } from "@/version";
import { cn } from "@/lib/utils";

export function WhatsNew() {
  return (
    <div>
      <PageHeader icon="chat" eyebrow="App" title="What's new" subtitle={"You're on version " + APP_VERSION + ". Updates arrive by themselves; the app offers a Reload when one is out."} />
      <div className="relative max-w-3xl space-y-4 border-l-2 border-brand-100 pl-6">
        {RELEASES.map((r, i) => (
          <motion.div key={r.version} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="relative">
            <span className={cn("absolute top-6 -left-[33px] h-4 w-4 rounded-full border-4 border-neutral-50", r.version === APP_VERSION ? "bg-brand-600" : "bg-brand-200")} />
            <Card>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-extrabold tracking-tight">
                  {r.title}
                  {r.version === APP_VERSION && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 align-middle text-[11px] font-bold text-brand-700 uppercase">This version</span>}
                </h2>
                <span className="text-xs font-semibold text-neutral-500">
                  Version {r.version}{r.windows ? " · Windows app " + r.windows : ""} · {msgDate(r.date)}
                </span>
              </div>
              <ul className="mt-3 space-y-1.5 text-sm text-neutral-700">
                {r.items.map((it) => <li key={it} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />{it}</li>)}
              </ul>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
