// Layout: Aceternity sidebar on desktop (icons, expands on hover), and on
// phones a top bar, a bottom tab bar and a slide-in menu.
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { IconDownload, IconX } from "@tabler/icons-react";
import { DesktopSidebar, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { Icon3D, useToast } from "@/components/kit";
import { useInstall, useJustUpdated } from "@/lib/pwa";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/version";

export interface NavItem { to: string; label: string; icon: string }
export const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Overview", items: [{ to: "/", label: "Dashboard", icon: "chart" }] },
  {
    group: "Work",
    items: [
      { to: "/orders", label: "Orders", icon: "file-text" },
      { to: "/service-jobs", label: "Service Jobs", icon: "tool" },
    ],
  },
  {
    group: "Messages",
    items: [
      { to: "/payment-updated", label: "Payment Updated", icon: "money-bag" },
      { to: "/payment-reminder", label: "Payment Reminder", icon: "calender" },
      { to: "/balance-confirmation", label: "Balance Confirmation", icon: "notebook" },
      { to: "/dispatch", label: "Dispatch Confirmation", icon: "rocket" },
      { to: "/stock-update", label: "Stock Update", icon: "bag" },
      { to: "/stock-return", label: "Stock Return", icon: "back" },
      { to: "/service-material", label: "Service Material", icon: "gift" },
      { to: "/catalog", label: "Product Catalog", icon: "picture" },
    ],
  },
  {
    group: "Masters",
    items: [
      { to: "/customers", label: "Customers", icon: "boy" },
      { to: "/products", label: "Products", icon: "cube" },
      { to: "/transports", label: "Transports", icon: "location" },
    ],
  },
  {
    group: "App",
    items: [
      { to: "/history", label: "History", icon: "clock" },
      { to: "/settings", label: "Settings", icon: "setting" },
    ],
  },
];

const TABS: NavItem[] = [
  { to: "/", label: "Home", icon: "chart" },
  { to: "/orders", label: "Orders", icon: "file-text" },
  { to: "/customers", label: "Customers", icon: "boy" },
  { to: "/products", label: "Products", icon: "cube" },
];

function SyncLine({ compact }: { compact?: boolean }) {
  const { synced, user, signOutUser } = useStore();
  return (
    <div className={cn("text-xs text-neutral-500", compact && "text-[11px]")}>
      <div className="flex items-center gap-1.5 font-semibold">
        <span className={cn("h-2 w-2 rounded-full", synced ? "bg-emerald-500" : "bg-amber-400")} />
        {synced ? "Synced" : "Offline — will sync"}
      </div>
      {!compact && (
        <div className="mt-0.5 truncate">
          {user?.email} ·{" "}
          <button onClick={signOutUser} className="font-semibold text-brand-600 hover:underline">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function InstallButton() {
  const { canInstall, install } = useInstall();
  if (!canInstall) return null;
  return (
    <button onClick={install} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-100">
      <IconDownload size={14} /> Install app
    </button>
  );
}

function SideLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const { open } = useSidebar();
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group/link relative flex items-center gap-3 rounded-xl px-2 py-2 text-sm font-medium text-neutral-600 transition",
          isActive ? "bg-gradient-to-r from-brand-600 to-indigo-600 text-white shadow-[0_8px_18px_-8px_rgba(36,99,235,0.8)]" : "hover:bg-white hover:text-neutral-900 hover:shadow-sm",
        )
      }
    >
      <Icon3D name={item.icon} className="h-7 w-7 shrink-0 drop-shadow transition group-hover/link:scale-110 group-hover/link:-rotate-6" />
      <motion.span
        animate={{ opacity: open ? 1 : 0, display: open ? "inline-flex" : "none" }}
        className="flex-1 items-center justify-between gap-2 whitespace-pre"
      >
        {item.label}
      </motion.span>
    </NavLink>
  );
}

function DesktopNav() {
  const { open } = useSidebar();
  return (
    <DesktopSidebar className="no-scrollbar sticky top-0 h-screen overflow-y-auto border-r border-neutral-200/70 bg-neutral-100/80 px-3 py-4 backdrop-blur">
      <div className="mb-5 flex items-center gap-2.5 px-1">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-indigo-600 text-xs font-extrabold text-white shadow-md">CE</span>
        <motion.div animate={{ opacity: open ? 1 : 0, display: open ? "block" : "none" }} className="whitespace-pre">
          <div className="text-sm leading-tight font-extrabold">Chittam Enterprises</div>
          <div className="text-[11px] text-neutral-500">Business tool</div>
        </motion.div>
      </div>
      <nav className="flex flex-1 flex-col gap-4">
        {NAV.map((g) => (
          <div key={g.group}>
            <motion.p animate={{ opacity: open ? 1 : 0 }} className="mb-1 h-4 px-2 text-[10px] font-bold tracking-[0.14em] text-neutral-400 uppercase">
              {g.group}
            </motion.p>
            <div className="flex flex-col gap-0.5">
              {g.items.map((it) => <SideLink key={it.to} item={it} />)}
            </div>
          </div>
        ))}
      </nav>
      <motion.div animate={{ opacity: open ? 1 : 0 }} className="mt-4 border-t border-neutral-200 px-1 pt-3">
        <SyncLine />
        <InstallButton />
        <div className="mt-2 text-[10px] text-neutral-400">Version {APP_VERSION}</div>
      </motion.div>
    </DesktopSidebar>
  );
}

function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm md:hidden" />
          <motion.aside
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="fixed inset-y-0 left-0 z-[100] flex w-[84%] max-w-sm flex-col overflow-y-auto bg-neutral-50 p-5 pt-[calc(1.25rem+env(safe-area-inset-top))] md:hidden"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-indigo-600 text-xs font-extrabold text-white">CE</span>
                <span className="font-extrabold">Chittam Enterprises</span>
              </div>
              <button onClick={onClose} className="rounded-full p-2 hover:bg-neutral-200" aria-label="Close menu">
                <IconX size={20} />
              </button>
            </div>
            <SidebarProvider open animate={false}>
              <nav className="flex flex-col gap-4">
                {NAV.map((g) => (
                  <div key={g.group}>
                    <p className="mb-1 px-2 text-[10px] font-bold tracking-[0.14em] text-neutral-400 uppercase">{g.group}</p>
                    {g.items.map((it) => <SideLink key={it.to} item={it} onNavigate={onClose} />)}
                  </div>
                ))}
              </nav>
            </SidebarProvider>
            <div className="mt-auto border-t border-neutral-200 pt-4">
              <SyncLine />
              <InstallButton />
              <div className="mt-2 text-[10px] text-neutral-400">Version {APP_VERSION}</div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function titleFor(path: string) {
  for (const g of NAV) for (const it of g.items) if (it.to === path) return it.label;
  return "Chittam Enterprises";
}

export function AppShell({ children }: { children: ReactNode }) {
  const [sideOpen, setSideOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  const toast = useToast();
  const updated = useJustUpdated();
  useEffect(() => { if (updated) setTimeout(() => toast(updated), 1500); }, [updated, toast]);
  return (
    <div className="flex min-h-full w-full">
      <SidebarProvider open={sideOpen} setOpen={setSideOpen}>
        <DesktopNav />
      </SidebarProvider>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* phone top bar */}
        <header className="sticky top-0 z-40 flex items-center justify-between gap-3 bg-gradient-to-r from-brand-600 to-indigo-600 px-4 pt-[calc(0.6rem+env(safe-area-inset-top))] pb-2.5 text-white shadow-md md:hidden">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-xs font-extrabold text-brand-700">CE</span>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-bold">{loc.pathname === "/" ? "Chittam Enterprises" : titleFor(loc.pathname)}</div>
              <div className="text-white/80 [&_*]:!text-white/85"><SyncLine compact /></div>
            </div>
          </div>
        </header>

        <main className="relative flex-1 px-4 pt-5 pb-28 md:px-8 md:pt-8 md:pb-10">
          <motion.div key={loc.pathname} initial={{ opacity: 0, y: 10, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.3, ease: [0.2, 0.7, 0.2, 1] }} className="mx-auto max-w-6xl">
            {children}
          </motion.div>
        </main>
      </div>

      {/* phone bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-neutral-200 bg-white/90 px-1 pt-1.5 pb-[calc(0.4rem+env(safe-area-inset-bottom))] backdrop-blur-lg md:hidden">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => cn("flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1 text-[11px] font-semibold", isActive ? "bg-brand-50 text-brand-700" : "text-neutral-500")}>
            {({ isActive }) => (
              <>
                <Icon3D name={t.icon} className={cn("h-6 w-6", !isActive && "opacity-70 grayscale")} />
                {t.label}
              </>
            )}
          </NavLink>
        ))}
        <button onClick={() => setMenuOpen(true)} className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1 text-[11px] font-semibold text-neutral-500">
          <Icon3D name="puzzle" className="h-6 w-6 opacity-70 grayscale" />
          Menu
        </button>
      </nav>
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}
