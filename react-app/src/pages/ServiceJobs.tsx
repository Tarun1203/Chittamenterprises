// Service Jobs: products a dealer sends in for service — what came in
// (product, qty, serial no., issue), what was done (repaired, replaced with a
// new product + serial, not repairable, returned as is), charges, and when it
// went back. Messages for "received" and "sent back". Jobs are never deleted.
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import { motion } from "motion/react";
import { IconArrowLeft, IconDeviceFloppy, IconPlus } from "@tabler/icons-react";
import { Button, Card, EmptyState, Field, PageHeader, useToast } from "@/components/kit";
import { CustomerPicker, MessagePanel, Money, Select, SuggestInput, Text, n, useProductSuggestions, useTransportSuggestions } from "@/components/forms";
import { useStore } from "@/lib/store";
import { saveRecord, uid, type Customer, type ServiceItem, type ServiceJob } from "@/lib/data";
import { msgDate, serviceJobMessage } from "@/lib/messages";
import { inr, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Chip } from "./ReceiptsReport";
import { StatusBadge } from "./Orders";

export const JOB_STATUSES = ["Received", "Under Service", "Ready to Return", "Sent Back"];
const ACTIONS = ["Pending", "Repaired", "Replaced", "Not Repairable", "Returned As Is"];

// Job No. = SV-DD/MM-serial, restarting every day
function nextJobNo(jobs: ServiceJob[], iso: string) {
  const [, m, d] = (iso || todayISO()).split("-");
  const prefix = "SV-" + d + "/" + m + "-";
  const max = jobs.reduce((mx, j) => (j.receivedDate === iso && String(j.jobNo || "").startsWith(prefix) ? Math.max(mx, Number(String(j.jobNo).slice(prefix.length)) || 0) : mx), 0);
  return prefix + String(max + 1).padStart(2, "0");
}
function itemSummary(it: ServiceItem) {
  let s = it.product + (it.qty > 1 ? " × " + it.qty : "") + (it.serial ? " (S/N " + it.serial + ")" : "");
  if (it.action === "Replaced") s += " → replaced with " + (it.replProduct || it.product) + (it.replSerial ? " (S/N " + it.replSerial + ")" : "");
  else if (it.action && it.action !== "Pending") s += " — " + it.action.toLowerCase();
  return s;
}

export function ServiceJobs() {
  const { services } = useStore();
  const [editing, setEditing] = useState<ServiceJob | "new" | null>(null);
  // the menu link (same page) goes back to the list
  const { key } = useLocation();
  useEffect(() => { setEditing(null); }, [key]);
  useEffect(() => { window.scrollTo(0, 0); }, [editing]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const sorted = useMemo(() => [...services].sort((a, b) => (b.receivedDate || "").localeCompare(a.receivedDate || "") || String(b.jobNo).localeCompare(String(a.jobNo))), [services]);
  const stats = useMemo(() => {
    const c: Record<string, number> = {};
    let pending = 0, replaced = 0;
    sorted.forEach((j) => {
      c[j.status] = (c[j.status] || 0) + 1;
      (j.items || []).forEach((it) => {
        if (j.status !== "Sent Back" && (!it.action || it.action === "Pending")) pending += n(it.qty) || 1;
        if (it.action === "Replaced") replaced += n(it.qty) || 1;
      });
    });
    return { c, pending, replaced };
  }, [sorted]);
  const list = sorted.filter((j) => {
    if (status && j.status !== status) return false;
    const f = q.trim().toLowerCase();
    return !f || [j.jobNo, j.customerName, j.notes, ...(j.items || []).map((it) => [it.product, it.serial, it.issue, it.replProduct, it.replSerial].join(" "))].join(" ").toLowerCase().includes(f);
  });

  if (editing) return <JobEditor job={editing === "new" ? null : editing} onClose={() => setEditing(null)} />;

  return (
    <div>
      <PageHeader icon="tool" eyebrow="Work" title="Service Jobs" subtitle="Products dealers send in for service: what came in, what was done, and when it went back."
        actions={<Button size="sm" onClick={() => setEditing("new")}><IconPlus size={16} /> New job</Button>} />
      {sorted.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {JOB_STATUSES.filter((s) => stats.c[s]).map((s) => <Chip key={s} label={s} value={String(stats.c[s])} />)}
          <Chip strong label="Products still to service" value={String(stats.pending)} />
          <Chip label="Replaced so far" value={String(stats.replaced)} />
        </div>
      )}
      <div className="mb-5 flex flex-wrap gap-3">
        <Text className="max-w-md min-w-[15rem] flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search job no., dealer, product or serial no.…" />
        <Select className="w-auto" value={status} onChange={setStatus} options={[{ value: "", label: "All statuses" }, ...JOB_STATUSES.map((s) => ({ value: s, label: s }))]} />
      </div>
      {list.length === 0 ? (
        <EmptyState icon="tool" title={sorted.length ? "No jobs match" : "No service jobs yet"} text={sorted.length ? "Try another search or status." : "Press “New job” when a dealer sends products for service."}
          action={!sorted.length && <Button onClick={() => setEditing("new")}><IconPlus size={16} /> New job</Button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((j, i) => (
            <motion.button key={j.id} onClick={() => setEditing(j)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02 }}
              className="rounded-2xl border border-neutral-200/80 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-brand-600 tabular-nums">{j.jobNo} · {msgDate(j.receivedDate)}</div>
                  <div className="truncate text-[15px] font-bold">{j.customerName || "—"}</div>
                </div>
                <StatusBadge status={j.status || "Received"} />
              </div>
              <div className="mt-2 space-y-0.5 text-xs text-neutral-500">{(j.items || []).map((it, k) => <div key={k}>{itemSummary(it)}</div>)}</div>
              {j.sentDate && <div className="mt-2 text-xs font-semibold text-emerald-700">Sent back {msgDate(j.sentDate)}</div>}
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}

type Row = { product: string; qty: string; serial: string; issue: string; action: string; replProduct: string; replSerial: string; charges: string };
const blankRow: Row = { product: "", qty: "1", serial: "", issue: "", action: "Pending", replProduct: "", replSerial: "", charges: "" };

function JobEditor({ job, onClose }: { job: ServiceJob | null; onClose: () => void }) {
  const { services, customers, transports, settings } = useStore();
  const toast = useToast();
  const productList = useProductSuggestions();
  const transportList = useTransportSuggestions();
  const [saved, setSaved] = useState<ServiceJob | null>(job);
  const [customer, setCustomer] = useState<Customer | null>(() =>
    job ? customers.find((c) => c.id === job.customerId) || { id: job.customerId, name: job.customerName, mobile: job.mobile } : null);
  const [f, setF] = useState(() => ({
    jobNo: job?.jobNo || nextJobNo(services, todayISO()), receivedDate: job?.receivedDate || todayISO(), inTransport: job?.inTransport || "",
    status: job?.status || "Received", timeline: job?.timeline || "", sentDate: job?.sentDate || "", outTransport: job?.outTransport || "", notes: job?.notes || "",
  }));
  const [rows, setRows] = useState<Row[]>(() => job?.items?.length
    ? job.items.map((it) => ({ product: it.product, qty: String(it.qty || 1), serial: it.serial || "", issue: it.issue || "", action: it.action || "Pending", replProduct: it.replProduct || "", replSerial: it.replSerial || "", charges: it.charges ? String(it.charges) : "" }))
    : [blankRow]);
  const [msgType, setMsgType] = useState<"received" | "returned">(job?.status === "Sent Back" ? "returned" : "received");
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const setRow = (i: number, patch: Partial<Row>) => setRows((x) => x.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const items: ServiceItem[] = rows.filter((r) => r.product.trim()).map((r) => ({
    product: r.product.trim(), qty: n(r.qty) || 1, serial: r.serial.trim(), issue: r.issue.trim(), action: r.action,
    replProduct: r.action === "Replaced" ? r.replProduct.trim() || r.product.trim() : "",
    replSerial: r.action === "Replaced" ? r.replSerial.trim() : "", charges: n(r.charges),
  }));
  const totalCharges = items.reduce((t, it) => t + it.charges, 0);
  const done = items.filter((it) => it.action !== "Pending").length;

  function changeReceived(iso: string) {
    setF((x) => ({ ...x, receivedDate: iso, jobNo: !saved && (!x.jobNo || /^SV-\d{2}\/\d{2}-\d+$/.test(x.jobNo)) ? nextJobNo(services, iso || todayISO()) : x.jobNo }));
  }
  function changeSent(iso: string) {
    // filling in the sent-back date moves the job to Sent Back
    setF((x) => ({ ...x, sentDate: iso, status: iso ? "Sent Back" : x.status }));
    if (iso) setMsgType("returned");
  }

  function fromForm(): Omit<ServiceJob, "id"> | string {
    if (!customer) return "Please select the dealer first.";
    if (!items.length) return "Add at least one product with a name.";
    const received = f.receivedDate || todayISO();
    const jobNo = f.jobNo.trim() || nextJobNo(services, received);
    const clash = services.find((j) => j.jobNo === jobNo && j.id !== saved?.id && String(j.receivedDate || "").slice(0, 4) === received.slice(0, 4));
    if (clash) return "Job No. " + jobNo + " is already used — change it.";
    return {
      jobNo, receivedDate: received, inTransport: f.inTransport.trim(), customerId: customer.id, customerName: customer.name, mobile: customer.mobile || "",
      status: f.status, timeline: f.timeline.trim(), items, totalCharges, sentDate: f.sentDate, outTransport: f.outTransport.trim(), notes: f.notes.trim(),
    };
  }
  async function save() {
    const data = fromForm();
    if (typeof data === "string") { toast(data); return; }
    const item: ServiceJob = { ...(saved || {}), ...data, id: saved?.id || "sv_" + uid().slice(2) };
    try { await saveRecord("services", item, saved); setSaved(item); toast("Service job " + item.jobNo + " saved."); }
    catch (e) { toast("Could not save: " + (e as Error).message); }
  }

  return (
    <div>
      <button onClick={onClose} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-500 hover:text-brand-700"><IconArrowLeft size={16} /> All service jobs</button>
      <PageHeader icon="tool" eyebrow={saved ? "Service Job " + saved.jobNo : "New service job"} title={saved?.customerName || customer?.name || "New service job"}
        actions={<Button size="sm" onClick={save}><IconDeviceFloppy size={16} /> Save job</Button>} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card className="space-y-4">
            <Field label="Dealer"><CustomerPicker value={customer} onPick={setCustomer} placeholder="Search dealer…" /></Field>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Job No."><Text value={f.jobNo} onChange={(e) => set("jobNo", e.target.value)} /></Field>
              <Field label="Received on"><Text type="date" value={f.receivedDate} onChange={(e) => changeReceived(e.target.value)} /></Field>
              <Field label="Status"><Select value={f.status} onChange={(v) => set("status", v)} options={JOB_STATUSES} /></Field>
              <Field label="Received via" className="col-span-2 sm:col-span-1"><SuggestInput value={f.inTransport} onChange={(v) => set("inTransport", v)} suggestions={transportList} placeholder="Transport" /></Field>
              <Field label="Expected service time" className="col-span-2"><Text value={f.timeline} onChange={(e) => set("timeline", e.target.value)} placeholder="e.g. 7–10 days" /></Field>
            </div>
          </Card>
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold tracking-wide text-neutral-500 uppercase">Products</h3>
                {items.length > 0 && <p className="text-xs text-neutral-500">{items.length} product{items.length === 1 ? "" : "s"} · {done} done · Charges <strong>{inr(totalCharges)}</strong></p>}
              </div>
              <Button size="sm" variant="secondary" onClick={() => setRows((x) => [...x, blankRow])}><IconPlus size={15} /> Product</Button>
            </div>
            {rows.map((r, i) => (
              <div key={i} className="rounded-xl border border-neutral-100 bg-neutral-50/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-500">Product {i + 1}</span>
                  <button className="text-xs font-semibold text-rose-600" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Remove</button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_4.5rem_9rem]">
                  <SuggestInput className="col-span-2 sm:col-span-1" value={r.product} onChange={(v) => setRow(i, { product: v })} suggestions={productList} placeholder="Product received" />
                  <Money placeholder="Qty" value={r.qty} onChange={(v) => setRow(i, { qty: v })} />
                  <Text placeholder="Serial No." value={r.serial} onChange={(e) => setRow(i, { serial: e.target.value })} />
                </div>
                <Text className="mt-2" placeholder="Issue reported, e.g. No output" value={r.issue} onChange={(e) => setRow(i, { issue: e.target.value })} />
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Field label="Action taken"><Select value={r.action} onChange={(v) => setRow(i, { action: v })} options={ACTIONS} /></Field>
                  <Field label="Charges (₹)"><Money value={r.charges} onChange={(v) => setRow(i, { charges: v })} /></Field>
                  {r.action === "Replaced" && <>
                    <Field label="Replacement product"><SuggestInput value={r.replProduct} onChange={(v) => setRow(i, { replProduct: v })} suggestions={productList} placeholder="Same as received" /></Field>
                    <Field label="New Serial No."><Text value={r.replSerial} onChange={(e) => setRow(i, { replSerial: e.target.value })} placeholder="S/N" /></Field>
                  </>}
                </div>
              </div>
            ))}
          </Card>
          <Card className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Sent back on"><Text type="date" value={f.sentDate} onChange={(e) => changeSent(e.target.value)} /></Field>
              <Field label="Sent via"><SuggestInput value={f.outTransport} onChange={(v) => set("outTransport", v)} suggestions={transportList} placeholder="Transport" /></Field>
            </div>
            <Field label="Notes"><Text value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional" /></Field>
          </Card>
        </div>
        <div className="space-y-3 lg:sticky lg:top-6">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1">
            {([["received", "📥 Received"], ["returned", "📤 Sent back"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => setMsgType(v)} className={cn("rounded-lg py-2 text-sm font-semibold", msgType === v ? "bg-white shadow-sm" : "text-neutral-500")}>{l}</button>
            ))}
          </div>
          <MessagePanel key={msgType} title={msgType === "received" ? "Received message" : "Sent back message"} type="service-job" customer={customer}
            inputs={{ customer: customer?.name || "", ...f, items, messageType: msgType }}
            build={() => { const d = fromForm(); return typeof d === "string" ? "!" + d : serviceJobMessage(settings, transports, d, msgType); }} />
        </div>
      </div>
    </div>
  );
}
