// Talking to the Windows app this page may be running inside: its Tally sync
// status, "Sync now" and "Sync settings". Elsewhere (phones, browsers) the
// hook reports that there is no Windows app.
import { useEffect, useState } from "react";

export interface DesktopStatus {
  desktopVersion: string; configured: boolean; busy: boolean; error: string; nextSync: string;
  intervalMinutes: number; syncVouchers: boolean; voucherDays: number;
  companies: { key: string; company: string; label: string; balances: string; vouchers: string }[];
  log: string[];
  update?: string;
}
interface WebView { postMessage: (m: unknown) => void; addEventListener: (t: "message", f: (e: { data: unknown }) => void) => void; removeEventListener: (t: "message", f: (e: { data: unknown }) => void) => void }
const webview = (): WebView | null => {
  const w = window as unknown as { chrome?: { webview?: WebView }; chittamDesktop?: unknown };
  return w.chittamDesktop && w.chrome?.webview ? w.chrome.webview : null;
};
export const inDesktopApp = () => !!webview();
export const desktopSend = (type: "tally-sync-now" | "tally-settings" | "tally-log" | "tally-status") => webview()?.postMessage({ type });

export function useDesktopStatus() {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  useEffect(() => {
    const wv = webview();
    if (!wv) return;
    const on = (e: { data: unknown }) => {
      const d = e.data as { type?: string } & DesktopStatus;
      if (d?.type === "tally-status") setStatus(d);
    };
    wv.addEventListener("message", on);
    wv.postMessage({ type: "tally-status" });
    return () => wv.removeEventListener("message", on);
  }, []);
  return status;
}

// a request with details (e.g. posting a voucher), and listening for the reply
export const desktopPost = (msg: Record<string, unknown>) => webview()?.postMessage(msg);
export function useDesktopReply<T>(type: string, onReply: (data: T) => void) {
  useEffect(() => {
    const wv = webview();
    if (!wv) return;
    const on = (e: { data: unknown }) => { const d = e.data as { type?: string }; if (d?.type === type) onReply(d as T); };
    wv.addEventListener("message", on);
    return () => wv.removeEventListener("message", on);
  });
}
