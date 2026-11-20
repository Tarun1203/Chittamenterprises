// History: the latest messages (copy or send again) and the change log —
// every add / edit and app event, with what changed. Read-only: the
// database lets these entries be added, never edited or deleted.
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { IconBrandWhatsapp, IconChevronDown, IconCopy, IconRefresh } from "@tabler/icons-react";
import { Button, Card, EmptyState, PageHeader, useToast } from "@/components/kit";
import { Text, copyText } from "@/components/forms";
import { loadLatest, logEvent, type ActivityEntry, type MessageEntry } from "@/lib/data";
import { waNumber } from "@/lib/messages";
import { cn } from "@/lib/utils";

export const TYPE_LABELS: Record<string, string> = {
  "payment-updated": "Payment Updated", "balance-confirmation": "Balance Confirmation", "payment-reminder": "Payment Reminder",
  "dispatch-confirmation": "Dispatch", "stock-update": "Stock Update", "service-material": "Service Material",
  "stock-return": "Stock Return", "ledger-statement": "Ledger Statement", "order-confirmation": "Order Confirmation", "service-job": "Service Job",
};
const EVENT_LABELS: Record<string, string> = {
  "message-generated": "Message generated", "message-copied": "Message copied", "whatsapp-opened": "Sent to WhatsApp",
  "import-customers": "Customers imported", "customers-merged": "Customers merged", "customer-removed": "Customer removed", "customer-restored": "Customer restored", "import-products": "Products imported", "backup-export": "Backup downloaded",
  "backup-restore": "Backup restored", "sheet-push": "Pushed to Sheet", "sheet-pull": "Pulled from Sheet", "sheet-url-changed": "Sheet URL changed",
  "catalog-photo": "Catalog photo added", "catalog-copy": "Catalog copied", "catalog-share": "Catalog shared", "app-installed": "App installed",
  "balances-imported": "Tally balances imported", "balances-synced": "Tally balances synced", "tally-vouchers-synced": "Tally transactions synced", "tally-stock-synced": "Tally stock synced", "ledger-printed": "Ledger printed", "ledger-pdf-shared": "Ledger PDF shared", "receipt-pdf-shared": "Receipt PDF shared", "voucher-pdf-shared": "Voucher PDF shared", "tally-voucher-posted": "Receipt posted to Tally", "tally-company-switched": "Tally new financial year", "tally-masters-synced": "Customers / products from Tally", "tally-bills-synced": "Tally open invoices synced", "picklist-copied": "Pick list copied",
  "picklist-printed": "Pick list printed", "receipts-report-copied": "Payments report copied", "receipts-report-downloaded": "Payments report downloaded",
  "sign-in": "Signed in", "sign-out": "Signed out",
};
const RECORD_LABELS: Record<string, string> = { customers: "Customer", products: "Product", settings: "Settings", orders: "Order", services: "Service job", transports: "Transport", receipts: "Payment" };
const FIELD_LABELS: Record<string, string> = {
  replSerial: "new S/N", replProduct: "replacement", serial: "S/N", qty: "qty", totalCharges: "total charges", sentDate: "sent back",
  receivedDate: "received", deliveryDate: "delivery", outTransport: "return transport", inTransport: "received via", customerName: "customer",
  transportPhone: "transport phone", contactPerson: "contact person", freightTerms: "transport charges", freight: "transport charges ₹",
  orderNo: "order no.", jobNo: "job no.", businessName: "business name", upiList: "UPI IDs", bankList: "bank accounts", paymentModes: "payment modes",
};
const label = (k: string) => FIELD_LABELS[k] || k;
const show = (v: unknown) => (v === undefined || v === "" || v === null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// item lists: what changed per line
function listDiff(key: string, before: Record<string, unknown>[], after: Record<string, unknown>[]) {
  const out: string[] = [];
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    const b = before[i], a = after[i];
    const name = String((a && (a.name || a.product)) || (b && (b.name || b.product)) || key + " " + (i + 1));
    if (!b) { out.push("added " + name); continue; }
    if (!a) { out.push("removed " + name); continue; }
    if (typeof a !== "object" || typeof b !== "object") { if (!same(a, b)) out.push(show(b) + " → " + show(a)); continue; }
    const ch = Object.keys({ ...b, ...a }).filter((f) => !same(b[f], a[f])).map((f) => label(f) + " " + show(b[f]) + " → " + show(a[f]));
    if (ch.length) out.push(name + ": " + ch.join(", "));
  }
  return out.join("; ");
}
function diff(before: Record<string, unknown> | null | undefined, after: Record<string, unknown>) {
  if (!before) return "";
  return Object.keys({ ...before, ...after }).filter((k) => k !== "id" && !same(before[k], after[k])).map((k) =>
    Array.isArray(before[k]) && Array.isArray(after[k])
      ? listDiff(k, before[k] as Record<string, unknown>[], after[k] as Record<string, unknown>[])
      : label(k) + ": " + show(before[k]) + " → " + show(after[k])).join(", ");
}
function eventInfo(action: string, d: Record<string, unknown>) {
  const type = d.type ? TYPE_LABELS[String(d.type)] || String(d.type) : "";
  switch (action) {
    case "message-generated": case "message-copied": case "whatsapp-opened": return [type, d.mobile].filter(Boolean).join(" · ");
    case "import-customers": return d.added + " added, " + d.updated + " updated, " + d.skippedBank + " bank ledgers skipped";
    case "import-products": return d.added + " added, " + d.updated + " prices updated";
    case "backup-export": case "sheet-push": case "sheet-pull": return d.customers + " customers, " + d.products + " products";
    case "backup-restore": return (d.file ? d.file + " — " : "") + d.customers + " customers, " + d.products + " products";
    case "sheet-url-changed": return String(d.url || "(cleared)");
    case "balances-synced": return (d.company ? "From Tally company " + d.company + " — " : "") + (d.names || 0) + " names";
    case "balances-imported": return (d.file ? d.file + " — " : "") + d.matched + " customers matched" + (d.unmatched ? ", " + d.unmatched + " other names" : "");
    case "tally-masters-synced": return d.customersAdded + " customers added, " + d.customersUpdated + " mobiles filled, " + d.productsAdded + " products added, " + d.productsUpdated + " products updated";
    case "tally-company-switched": return "Now syncing " + d.to + " (was " + d.from + ")";
    case "tally-voucher-posted": return "₹" + Number(d.amount || 0).toLocaleString("en-IN") + " into " + d.into + " · " + d.company + " · " + d.date;
    case "tally-stock-synced": return (d.company ? "From Tally company " + d.company + " — " : "") + (d.count || 0) + " stock items";
    case "tally-bills-synced": return (d.company ? "From Tally company " + d.company + " — " : "") + (d.count || 0) + " open invoices";
    case "tally-vouchers-synced": return (d.company ? "From Tally company " + d.company + " — " : "") + (d.count || 0) + " transactions" + (d.from ? ", " + d.from + " to " + d.to : "");
    case "catalog-copy": case "catalog-share": return ((d.products as string[]) || []).join(", ");
    default: return "";
  }
}
function when(ts: ActivityEntry["at"]) {
  const d = ts && typeof ts.toDate === "function" ? ts.toDate() : null;
  return d ? d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "just now";
}

export function History() {
  const toast = useToast();
  const [kind, setKind] = useState<"messages" | "activity">("messages");
  const [data, setData] = useState<{ messages?: MessageEntry[]; activity?: ActivityEntry[] }>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (k: "messages" | "activity") => {
    setLoading(true); setError("");
    try {
      // local development only (left out of the published build)
      if (import.meta.env.DEV && new URLSearchParams(location.search).has("demo")) {
        const d = await import("@/lib/demo");
        setData((x) => ({ ...x, [k]: k === "messages" ? d.demoMessages : d.demoActivity }));
      } else {
        const rows = k === "messages" ? await loadLatest<MessageEntry>("messages") : await loadLatest<ActivityEntry>("activity");
        setData((x) => ({ ...x, [k]: rows }));
      }
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(kind); }, [kind, load]);

  const list = data[kind];
  const rows = useMemo(() => {
    const f = q.trim().toLowerCase();
    return (list || []).filter((r) => !f || JSON.stringify(r).toLowerCase().includes(f));
  }, [list, q]);

  async function resend(r: MessageEntry, chat: boolean) {
    await copyText(r.text || "");
    logEvent(chat ? "whatsapp-opened" : "message-copied", { type: r.type, customerName: r.customerName || "", mobile: r.mobile || "", fromHistory: true }).catch(() => {});
    if (chat) { window.open("https://wa.me/" + waNumber(r.mobile), "_blank"); toast("Message copied — paste it into the chat that just opened."); }
    else toast("Message copied.");
  }

  return (
    <div>
      <PageHeader icon="clock" eyebrow="App" title="History" subtitle="The latest 300 messages and changes, from every device. Nothing here can be edited or deleted."
        actions={<Button variant="secondary" size="sm" onClick={() => load(kind)}><IconRefresh size={16} className={cn(loading && "animate-spin")} /> Refresh</Button>} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-200/60 p-1">
          {([["messages", "Messages"], ["activity", "All changes"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setKind(v)} className={cn("rounded-lg px-4 py-1.5 text-sm font-semibold", kind === v ? "bg-white shadow-sm" : "text-neutral-500")}>{l}</button>
          ))}
        </div>
        <Text className="max-w-md flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search customer, type, product…" />
      </div>

      {error ? <Card className="text-sm text-rose-700">Could not load history: {error}</Card>
        : !list ? <Card className="text-center text-sm text-neutral-500">Loading…</Card>
        : rows.length === 0 ? <EmptyState icon="clock" title={list.length ? "Nothing matches your search" : "Nothing saved yet"} />
        : (
          <div className="space-y-2.5">
            {kind === "messages" ? (rows as MessageEntry[]).map((r, i) => (
              <motion.div key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.015 }}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="mr-2 inline-flex rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-bold text-brand-700 uppercase">{TYPE_LABELS[r.type] || r.type}</span>
                      <span className="font-semibold">{r.customerName || "—"}</span>
                    </div>
                    <span className="text-xs text-neutral-500">{when(r.at)} · {r.by}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => resend(r, false)}><IconCopy size={15} /> Copy</Button>
                    {r.mobile && <Button size="sm" variant="whatsapp" onClick={() => resend(r, true)}><IconBrandWhatsapp size={15} /> WhatsApp</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>
                      <IconChevronDown size={15} className={cn("transition", open === r.id && "rotate-180")} /> {open === r.id ? "Hide" : "Show"} message
                    </Button>
                  </div>
                  {open === r.id && <pre className="mt-3 rounded-xl bg-[#d9fdd3] p-3 font-sans text-[13.5px] leading-relaxed whitespace-pre-wrap">{r.text}</pre>}
                </Card>
              </motion.div>
            )) : (rows as ActivityEntry[]).map((r, i) => {
              const isEvent = r.collection === "app";
              const tag = isEvent ? EVENT_LABELS[r.action] || r.action : (RECORD_LABELS[r.collection] || r.collection) + " " + (r.action === "create" ? "added" : "edited");
              const info = isEvent ? eventInfo(r.action, r.details || {}) : diff(r.before, r.after || {});
              return (
                <motion.div key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.015 }}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className={cn("mr-2 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase", isEvent ? "bg-neutral-100 text-neutral-600" : r.action === "create" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>{tag}</span>
                        <span className="font-semibold">{r.name || ""}</span>
                      </div>
                      <span className="text-xs text-neutral-500">{when(r.at)} · {r.by}</span>
                    </div>
                    {info && <p className="mt-2 text-[13px] break-words text-neutral-600">{info}</p>}
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
    </div>
  );
}
