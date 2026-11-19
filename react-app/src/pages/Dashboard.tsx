import { Link } from "react-router";
import { motion } from "motion/react";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { TextGenerateEffect } from "@/components/ui/text-generate-effect";
import { Icon3D } from "@/components/kit";
import { NAV } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { greeting } from "@/lib/format";
import { cn } from "@/lib/utils";

function Stat({ icon, label, value, to, delay }: { icon: string; label: string; value: string | number; to: string; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}>
      <Link to={to} className="group relative block h-full rounded-3xl border border-neutral-200/80 p-1.5">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} borderWidth={2} />
        <div className="relative flex h-full items-center gap-4 overflow-hidden rounded-[20px] bg-white p-5 shadow-sm">
          <Icon3D name={icon} className="h-14 w-14 drop-shadow-lg transition duration-300 group-hover:scale-110 group-hover:-rotate-6" />
          <div>
            <div className="text-3xl font-extrabold tracking-tight">{value}</div>
            <div className="text-sm font-medium text-neutral-500">{label}</div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

export function Dashboard() {
  const { customers, products, transports, settings } = useStore();
  const shortcuts = NAV.flatMap((g) => g.items).filter((i) => i.to !== "/");

  return (
    <div>
      <div className="relative mb-8 overflow-hidden rounded-3xl border border-brand-100 bg-[radial-gradient(circle_at_1px_1px,rgba(36,99,235,0.14)_1px,transparent_0)] [background-size:18px_18px] p-6 md:p-8">
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-gradient-to-br from-brand-200/60 to-violet-200/50 blur-3xl" />
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold tracking-[0.16em] text-brand-600 uppercase">Welcome back</p>
            <h1 className="mt-1 bg-gradient-to-r from-neutral-900 via-brand-600 to-violet-600 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent md:text-4xl">
              {greeting()}, {settings.businessName}
            </h1>
            <TextGenerateEffect
              words="Orders, service jobs, payments and WhatsApp messages — all in one place."
              className="mt-2 font-medium [&_*]:!text-[15px] [&_*]:!font-medium [&_*]:!text-neutral-500 [&>div]:!mt-0"
              duration={0.3}
            />
          </div>
          <Icon3D name="rocket" className="hidden h-28 w-28 animate-float drop-shadow-2xl md:block" />
        </div>
      </div>

      <div className="mb-10 grid gap-4 sm:grid-cols-3">
        <Stat icon="boy" label="Customers" value={customers.length} to="/customers" delay={0.05} />
        <Stat icon="cube" label="Products" value={products.length} to="/products" delay={0.1} />
        <Stat icon="location" label="Transports" value={transports.length} to="/transports" delay={0.15} />
      </div>

      <h2 className="mb-4 text-lg font-extrabold tracking-tight">Go to</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {shortcuts.map((s, i) => (
          <motion.div key={s.to} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.03 }}>
            <Link
              to={s.to}
              className={cn(
                "group flex h-full flex-col gap-3 rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm transition hover:-translate-y-1 hover:border-brand-200 hover:shadow-[0_14px_30px_-12px_rgba(36,99,235,0.35)]",
              )}
            >
              <Icon3D name={s.icon} className="h-11 w-11 drop-shadow-md transition duration-300 group-hover:scale-110 group-hover:-rotate-6" />
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-neutral-800">{s.label}</span>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
