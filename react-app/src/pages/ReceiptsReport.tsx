// Payments received: every payment, date-wise. Added by Payment Updated
// messages, order advances and "Add payment". Edit or cancel — never delete.
import { useMemo, useState } from "react";
import { IconCopy, IconDownload, IconFileTypePdf, IconPencil, IconPlus } from "@tabler/icons-react";
import { receiptPdf, receiptNo, safeFileName, sharePdf } from "@/lib/pdf";
import { amountOf, receiptTotal, useCompanies } from "@/lib/companies";
import { Button, Card, Dialog, Field, useToast } from "@/components/kit";
import { CustomerPicker, Money, Select, Text, copyText, n } from "@/components/forms";
import { useStore } from "@/lib/store";
import { logEvent, saveRecord, uid, type Customer, type Receipt } from "@/lib/data";
import { isCashMode, msgDate, payRefLabel } from "@/lib/messages";
import { inr, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

const total = (r: Receipt) => receiptTotal(r);

export function ReceiptsReport() {
  const { receipts, customers, settings } = useStore();
  const toast = useToast();
  // companies added in the Windows app get their own amount in each payment
  const extraCos = useCompanies().filter((c) => c.key !== "business" && c.key !== "cash");
  const labels = Object.fromEntries(extraCos.map((c) => [c.key, c.label]));
  const [xform, setXform] = useState<Record<string, string>>({});
  // the payment receipt as a PDF, to WhatsApp
  async function sendReceipt(r: Receipt) {
    const c = customers.find((x) => x.id === r.customerId);
    try {
      toast("Making the receipt PDF…");
      const blob = await receiptPdf(settings, r, c?.mobile, undefined, labels);
      const res = await sharePdf(blob, safeFileName("Receipt " + receiptNo(r) + " " + r.customerName) + ".pdf", { mobile: c?.mobile, kind: "Receipts", text: "Payment receipt – " + settings.businessName });
      if (res.message) toast(res.message);
      logEvent("receipt-pdf-shared", { customerName: r.customerName, mobile: c?.mobile || "", receiptId: r.id, savedTo: res.path || "" }).catch(() => {});
    } catch (e) { toast("Could not make the PDF: " + (e as Error).message); }
  }
  const biz = settings.businessName || "Business";
  const [from, setFrom] = useState(todayISO().slice(0, 8) + "01");
  const [to, setTo] = useState(todayISO());
  const [mode, setMode] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Receipt | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState({ customer: null as Customer | null, date: "", mode: "", business: "", cash: "", note: "", tallyNo: "", receivedBy: "", txnRef: "", cancelled: false });

  const modes = useMemo(() => [...new Set(receipts.map((r) => r.mode).filter(Boolean))].sort(), [receipts]);
  const list = useMemo(() => {
    const f = q.trim().toLowerCase();
    return receipts.filter((r) => {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      if (mode && r.mode !== mode) return false;
      return !f || [r.customerName, r.ref, r.note, r.mode].join(" ").toLowerCase().includes(f);
    }).sort((a, b) => b.date.localeCompare(a.date) || String(a.customerName).localeCompare(String(b.customerName)));
  }, [receipts, from, to, mode, q]);
  const live = list.filter((r) => !r.cancelled);
  const sums = useMemo(() => {
    const byMode: Record<string, number> = {};
    let business = 0, cash = 0, all = 0;
    const extra: Record<string, number> = {};
    live.forEach((r) => {
      business += n(r.business); cash += n(r.cash); all += total(r);
      for (const [k, v] of Object.entries(r.extra || {})) extra[k] = (extra[k] || 0) + n(v);
      byMode[r.mode || "—"] = (byMode[r.mode || "—"] || 0) + total(r);
    });
    return { business, cash, extra, all, byMode };
  }, [live]);
  const days = useMemo(() => {
    const out: { date: string; rows: Receipt[] }[] = [];
    list.forEach((r) => { const d = out[out.length - 1]; if (d && d.date === r.date) d.rows.push(r); else out.push({ date: r.date, rows: [r] }); });
    return out;
  }, [list]);

  async function copyReport() {
    const lines = ["💵 *Payments Received — " + (settings.businessName || "Chittam Enterprises") + "*", msgDate(from) + (to && to !== from ? " to " + msgDate(to) : ""), ""];
    let grand = 0;
    days.forEach((d) => {
      const rows = d.rows.filter((r) => !r.cancelled);
      if (!rows.length) return;
      const dayTotal = rows.reduce((t, r) => t + total(r), 0);
      grand += dayTotal;
      lines.push("📅 *" + msgDate(d.date) + " — " + inr(dayTotal) + "*");
      rows.forEach((r) => lines.push("• " + r.customerName + " — " + inr(total(r)) + " (" + (r.mode || "—") + ")"));
      lines.push("");
    });
    lines.push("*Total received: " + inr(grand) + "* (" + live.length + " payment" + (live.length === 1 ? "" : "s") + ")");
    await copyText(lines.join("\n"));
    toast("Payments report copied.");
    logEvent("receipts-report-copied", {}).catch(() => {});
  }

  function downloadCsv() {
    const rows: (string | number)[][] = [["Date", "Customer", "Mode", biz + " (Rs)", "Cash (Rs)", ...extraCos.map((c) => c.label + " (Rs)"), "Total (Rs)", "From", "Ref", "Note", "Cancelled"]];
    [...list].reverse().forEach((r) => rows.push([r.date, r.customerName, r.mode, r.business || 0, r.cash || 0, ...extraCos.map((c) => amountOf(r, c.key)), total(r), r.source, r.ref || "", r.note || "", r.cancelled ? "Yes" : ""]));
    const csv = rows.map((row) => row.map((v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "payments-" + from + "-to-" + to + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    logEvent("receipts-report-downloaded", { rows: rows.length - 1 }).catch(() => {});
  }

  function open(r: Receipt | null) {
    const m = settings.paymentModes[0] || "";
    setIsNew(!r);
    setEditing(r || { id: "rc_" + uid().slice(2), date: todayISO(), customerId: "", customerName: "", mode: m, business: 0, cash: 0, source: "Manual" });
    const c = r ? customers.find((x) => x.id === r.customerId) || { id: r.customerId, name: r.customerName } : null;
    setXform(Object.fromEntries(Object.entries(r?.extra || {}).map(([k, v]) => [k, v ? String(v) : ""])));
    setForm({ customer: c, date: r?.date || todayISO(), mode: r?.mode || m, business: r?.business ? String(r.business) : "", cash: r?.cash ? String(r.cash) : "", note: r?.note || "", tallyNo: r?.tallyNo || "", receivedBy: r?.receivedBy || "", txnRef: r?.txnRef || "", cancelled: !!r?.cancelled });
  }
  async function save() {
    if (!editing) return;
    if (!form.customer) { toast("Please select a customer first."); return; }
    const extra = Object.fromEntries(extraCos.filter((c) => n(xform[c.key])).map((c) => [c.key, n(xform[c.key])]));
    // amounts of companies no longer set up are kept as they were
    for (const [k, v] of Object.entries(editing.extra || {})) if (!extraCos.some((c) => c.key === k) && v) extra[k] = v;
    if (!n(form.business) && !n(form.cash) && !Object.keys(extra).length) { toast("Enter the amount received."); return; }
    const rec: Receipt = {
      ...editing, date: form.date || todayISO(), customerId: form.customer.id, customerName: form.customer.name,
      mode: form.mode, business: n(form.business), cash: n(form.cash), note: form.note.trim(), cancelled: form.cancelled, ref: editing.ref || "",
      receivedBy: isCashMode(form.mode) ? form.receivedBy.trim() : "", txnRef: isCashMode(form.mode) ? "" : form.txnRef.trim(),
      tallyNo: form.tallyNo.trim(), tallyId: form.tallyNo.trim() === (editing.tallyNo || "") ? editing.tallyId || "" : "",
      extra,
    };
    try { await saveRecord("receipts", rec, isNew ? null : editing); toast("Payment saved."); setEditing(null); }
    catch (e) { toast("Could not save: " + (e as Error).message); }
  }
  const modeOptions = [...new Set([...(settings.paymentModes || []), ...(form.mode ? [form.mode] : [])])];

  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold tracking-[0.16em] text-brand-600 uppercase">Report</p>
          <h2 className="text-xl font-extrabold tracking-tight">Payments Received</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={copyReport}><IconCopy size={16} /> Copy report</Button>
          <Button variant="secondary" size="sm" onClick={downloadCsv}><IconDownload size={16} /> CSV</Button>
          <Button size="sm" onClick={() => open(null)}><IconPlus size={16} /> Add payment</Button>
        </div>
      </div>
      <Card className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="From"><Text type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Text type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Mode"><Select value={mode} onChange={setMode} options={[{ value: "", label: "All modes" }, ...modes.map((m) => ({ value: m, label: m }))]} /></Field>
        <Field label="Search"><Text value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer, note…" /></Field>
      </Card>
      {list.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Chip label="Total received" value={inr(sums.all)} strong />
          <Chip label={biz + " a/c"} value={inr(sums.business)} />
          <Chip label="Cash a/c" value={inr(sums.cash)} />
          {extraCos.filter((c) => sums.extra[c.key]).map((c) => <Chip key={c.key} label={c.label + " a/c"} value={inr(sums.extra[c.key])} />)}
          <Chip label="Payments" value={String(live.length)} />
          {Object.keys(sums.byMode).sort().map((m) => <Chip key={m} label={m} value={inr(sums.byMode[m])} />)}
        </div>
      )}
      {days.length === 0 ? (
        <Card className="text-center text-sm text-neutral-500">No payments in this period. A payment is added when you generate a Payment Updated message above, save an order with an advance, or press “Add payment”.</Card>
      ) : (
        <div className="space-y-4">
          {days.map((d) => (
            <Card key={d.date} className="p-0">
              <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
                <span className="font-bold">{msgDate(d.date)}</span>
                <strong className="tabular-nums">{inr(d.rows.filter((r) => !r.cancelled).reduce((t, r) => t + total(r), 0))}</strong>
              </div>
              <div className="divide-y divide-neutral-100">
                {d.rows.map((r) => (
                  <div key={r.id} className={cn("flex items-center gap-3 px-5 py-3", r.cancelled && "opacity-50")}>
                    <div className="min-w-0 flex-1">
                      <div className={cn("truncate font-semibold", r.cancelled && "line-through")}>{r.customerName || "—"}</div>
                      <div className="text-xs text-neutral-500">
                        {r.mode || "—"}{r.txnRef ? " " + r.txnRef : ""}{r.receivedBy ? " (by " + r.receivedBy + ")" : ""} · {r.source}{r.ref ? " " + r.ref : ""}
                        {r.business ? " · " + biz + " " + inr(r.business) : ""}{r.cash ? " · Cash " + inr(r.cash) : ""}{Object.entries(r.extra || {}).filter(([, v]) => v).map(([k, v]) => " · " + (labels[k] || k) + " " + inr(v)).join("")}
                        {r.note ? " · " + r.note : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold tabular-nums">{inr(total(r))}</div>
                      {r.cancelled && <div className="text-[11px] font-bold text-rose-600 uppercase">Cancelled</div>}
                    </div>
                    {!r.cancelled && <button onClick={() => sendReceipt(r)} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100" aria-label="Receipt PDF to WhatsApp" title="Receipt PDF to WhatsApp"><IconFileTypePdf size={16} /></button>}
                    <button onClick={() => open(r)} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100" aria-label="Edit payment"><IconPencil size={16} /></button>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={isNew ? "Add payment" : "Edit payment"}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Close</Button><Button onClick={save}>Save</Button></>}>
        <Field label="Customer"><CustomerPicker value={form.customer} onPick={(c) => setForm((x) => ({ ...x, customer: c }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Text type="date" value={form.date} onChange={(e) => setForm((x) => ({ ...x, date: e.target.value }))} /></Field>
          <Field label="Mode"><Select value={form.mode} onChange={(v) => setForm((x) => ({ ...x, mode: v }))} options={modeOptions} /></Field>
          <Field label={biz + " (₹)"}><Money value={form.business} onChange={(v) => setForm((x) => ({ ...x, business: v }))} /></Field>
          <Field label="Cash (₹)"><Money value={form.cash} onChange={(v) => setForm((x) => ({ ...x, cash: v }))} /></Field>
          {extraCos.map((c) => <Field key={c.key} label={c.label + " (₹)"}><Money value={xform[c.key] || ""} onChange={(v) => setXform((x) => ({ ...x, [c.key]: v }))} /></Field>)}
        </div>
        {isCashMode(form.mode)
          ? <Field label="Received by"><Text value={form.receivedBy} onChange={(e) => setForm((x) => ({ ...x, receivedBy: e.target.value }))} placeholder="Who collected the cash" /></Field>
          : <Field label={payRefLabel(form.mode)}><Text value={form.txnRef} onChange={(e) => setForm((x) => ({ ...x, txnRef: e.target.value }))} placeholder="Optional" /></Field>}
        <Field label="Note"><Text value={form.note} onChange={(e) => setForm((x) => ({ ...x, note: e.target.value }))} placeholder="Optional" /></Field>
        <Field label="Tally voucher no." hint="Links this payment to that Tally receipt on Tally Match."><Text value={form.tallyNo} onChange={(e) => setForm((x) => ({ ...x, tallyNo: e.target.value }))} placeholder="Optional, e.g. RCPT/80-2026/27" /></Field>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={form.cancelled} onChange={(e) => setForm((x) => ({ ...x, cancelled: e.target.checked }))} className="h-4 w-4 accent-rose-600" />
          Cancelled (kept in the records, left out of totals)
        </label>
        {!isNew && editing && <p className="text-xs text-neutral-400">From: {editing.source}{editing.ref ? " " + editing.ref : ""}</p>}
      </Dialog>
    </section>
  );
}

export function Chip({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium", strong ? "border-brand-200 bg-brand-50 text-brand-800" : "border-neutral-200 bg-white text-neutral-600")}>
      {label}<strong className="tabular-nums text-neutral-900">{value}</strong>
    </span>
  );
}
