// Installable app + updates: registers the service worker, offers "Install
// app" when the browser allows it, and — because a window left open (the
// Windows app in the tray, a phone app in the background) never reloads by
// itself — checks the live version every 10 minutes and whenever the app
// comes back to the front, then offers a reload.
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconRefresh, IconX } from "@tabler/icons-react";
import { logEvent } from "./data";
import { APP_VERSION } from "@/version";

const BASE = import.meta.env.BASE_URL;

export function registerServiceWorker() {
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => { navigator.serviceWorker.register(BASE + "sw.js", { scope: BASE }).catch(() => {}); });
  }
}

/* ---------- install ---------- */
interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as InstallEvent; listeners.forEach((l) => l()); });
  window.addEventListener("appinstalled", () => { deferred = null; listeners.forEach((l) => l()); });
}
export function useInstall() {
  const [can, setCan] = useState(!!deferred);
  useEffect(() => { const l = () => setCan(!!deferred); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  const standalone = matchMedia("(display-mode: standalone)").matches || !!(navigator as { standalone?: boolean }).standalone;
  return {
    canInstall: can && !standalone,
    install: async () => {
      if (!deferred) return;
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") logEvent("app-installed", {}).catch(() => {});
      deferred = null; setCan(false);
    },
  };
}

/* ---------- updates ---------- */
export function useUpdateCheck() {
  const [newVersion, setNewVersion] = useState("");
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let last = 0;
    const check = () => {
      if (Date.now() - last < 60000) return;
      last = Date.now();
      fetch(BASE + "version.json?check=" + Date.now(), { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => { if (v?.version && v.version !== APP_VERSION) setNewVersion(v.version); })
        .catch(() => {});
    };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    const timer = setInterval(check, 10 * 60 * 1000);
    const first = setTimeout(check, 8000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => { clearInterval(timer); clearTimeout(first); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", check); };
  }, []);
  return newVersion;
}

// tells each device once that it is now on a new version
export function useJustUpdated() {
  const [msg, setMsg] = useState("");
  useEffect(() => {
    try {
      const seen = localStorage.getItem("ce_next_seen_version");
      if (seen && seen !== APP_VERSION) setMsg("App updated to version " + APP_VERSION);
      localStorage.setItem("ce_next_seen_version", APP_VERSION);
    } catch { /* private window: skip */ }
  }, []);
  return msg;
}

export function UpdateBar() {
  const v = useUpdateCheck();
  const [hidden, setHidden] = useState(false);
  return (
    <AnimatePresence>
      {v && !hidden && (
        <motion.div initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -60, opacity: 0 }}
          className="fixed inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-[150] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-neutral-900 px-4 py-3 text-sm text-white shadow-2xl">
          <span className="flex-1 font-semibold">Version {v} is ready</span>
          <button onClick={() => location.reload()} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 font-bold text-neutral-900"><IconRefresh size={15} /> Reload</button>
          <button onClick={() => setHidden(true)} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10" aria-label="Later"><IconX size={16} /></button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
