import { useState } from "react";
import { Button, Card, Field, PageHeader, useToast } from "@/components/kit";
import { BalanceNote, CustomerPicker, MessagePanel, Money, Select, Text, TotalLine, TwoColumn, n, useTallyFill } from "@/components/forms";
import { useStore } from "@/lib/store";
import { logEvent, saveRecord, type Customer, type Receipt } from "@/lib/data";
import { receiptPdf, receiptNo, safeFileName, sharePdf } from "@/lib/pdf";
import { IconBrandWhatsapp } from "@tabler/icons-react";
import { isCashMode, payRefLabel, paymentUpdated } from "@/lib/messages";
import { inr, todayISO } from "@/lib/format";
import { ReceiptsReport } from "./ReceiptsReport";
import { TallyFreshness } from "@/components/TallyFreshness";
import { useCompanies } from "@/lib/companies";


export function PaymentUpdated() {
  const { settings, receipts } = useStore();
  const toast = useToast();
  const tally = useTallyFill();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [note, setNote] = useState("");
  const [f, setF] = useState({ mode: settings.paymentModes[0] || "", date: todayISO(), eprev: "", eamt: "", cprev: "", camt: "", receivedBy: "", txnRef: "" });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  // companies added in the Windows app: previous balance and amount received for each
  const extraCos = useCompanies().filter((c) => c.key !== "business" && c.key !== "cash");
  const [xf, setXf] = useState<Record<string, { prev: string; amt: string }>>({});
  const xget = (k: string) => xf[k] || { prev: "", amt: "" };
  const xset = (k: string, field: "prev" | "amt") => (v: string) => setXf((x) => ({ ...x, [k]: { ...xget(k), [field]: v } }));
  const xamt = extraCos.reduce((t, c) => t + n(xget(c.key).amt), 0);
  const xfinal = extraCos.reduce((t, c) => t + n(xget(c.key).prev) - n(xget(c.key).amt), 0);

  function pick(c: Customer | null) {
    setCustomer(c);
    const t = tally(c);
    setNote(t.note);
    if (t.business !== null || t.cash !== null) setF((x) => ({ ...x, eprev: t.business === null ? "" : String(t.business), cprev: t.cash === null ? "" : String(t.cash) }));
    setXf(Object.fromEntries(Object.entries(t.others).map(([k, v]) => [k, { prev: v === null ? "" : String(v), amt: "" }])));
  }

  const efinal = n(f.eprev) - n(f.eamt), cfinal = n(f.cprev) - n(f.camt);
  const name = settings.businessName;

  // every Payment Updated message is also a payment in the report below:
  // one per customer per day, so generating again after a fix updates it
  async function recordReceipt() {
    if (!customer || (!n(f.eamt) && !n(f.camt) && !xamt)) return;
    const id = "pu_" + customer.id + "_" + (f.date || todayISO());
    const before = receipts.find((r) => r.id === id) || null;
    const rec: Receipt = {
      ...(before || {}), id, date: f.date || todayISO(), customerId: customer.id, customerName: customer.name,
      mode: f.mode || "—", business: n(f.eamt), cash: n(f.camt), source: "Payment Updated", ref: before?.ref || "", note: before?.note || "", cancelled: false,
      receivedBy: isCashMode(f.mode) ? f.receivedBy.trim() : "", txnRef: isCashMode(f.mode) ? "" : f.txnRef.trim(),
      extra: Object.fromEntries(extraCos.filter((c) => n(xget(c.key).amt)).map((c) => [c.key, n(xget(c.key).amt)])),
    };
    try { await saveRecord("receipts", rec, before); return rec; } catch (e) { toast("Payment not saved: " + (e as Error).message); return null; }
  }

  // the payment receipt as a PDF, with both balances
  const [making, setMaking] = useState(false);
  async function sendReceipt() {
    if (!customer) { toast("Please select a customer first."); return; }
    if (!n(f.eamt) && !n(f.camt) && !xamt) { toast("Enter the amount received."); return; }
    setMaking(true);
    try {
      const rec = await recordReceipt();
      if (!rec) return;
      const blob = await receiptPdf(settings, rec, customer.mobile, {
        business: n(f.eamt) ? [n(f.eprev), efinal] : undefined, cash: n(f.camt) ? [n(f.cprev), cfinal] : undefined,
        ...Object.fromEntries(extraCos.filter((c) => n(xget(c.key).amt)).map((c) => [c.key, [n(xget(c.key).prev), n(xget(c.key).prev) - n(xget(c.key).amt)] as [number, number]])),
      }, Object.fromEntries(extraCos.map((c) => [c.key, c.label])));
      const r = await sharePdf(blob, safeFileName("Receipt " + receiptNo(rec) + " " + customer.name) + ".pdf", { mobile: customer.mobile, kind: "Receipts", text: "Payment receipt – " + name });
      if (r.message) toast(r.message);
      logEvent("receipt-pdf-shared", { customerName: customer.name, mobile: customer.mobile || "", receiptId: rec.id, savedTo: r.path || "" }).catch(() => {});
    } catch (e) { toast("Could not make the PDF: " + (e as Error).message); }
    finally { setMaking(false); }
  }

  return (
    <div>
      <PageHeader icon="money-bag" eyebrow="Messages" title="Payment Updated" subtitle="Thank the customer for a payment with both ledgers. Each one is also added to Payments Received below." />
      <TwoColumn
        form={
          <Card className="space-y-4">
            <Field label="Customer"><CustomerPicker value={customer} onPick={pick} /><BalanceNote note={note} />{customer && <TallyFreshness className="mt-2" customer={customer.name} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment mode"><Select value={f.mode} onChange={set("mode")} options={settings.paymentModes.length ? settings.paymentModes : ["Cash", "UPI", "Bank Transfer", "Cheque"]} /></Field>
              <Field label="Date"><Text type="date" value={f.date} onChange={(e) => set("date")(e.target.value)} /></Field>
            </div>
            {isCashMode(f.mode)
              ? <Field label="Received by"><Text value={f.receivedBy} onChange={(e) => set("receivedBy")(e.target.value)} placeholder="Who collected the cash, e.g. Ramesh" /></Field>
              : <Field label={payRefLabel(f.mode)}><Text value={f.txnRef} onChange={(e) => set("txnRef")(e.target.value)} placeholder={/cheque/i.test(f.mode) ? "e.g. 004512" : "e.g. 431298765432"} /></Field>}
            <div className="rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4">
              <p className="mb-3 text-sm font-bold">🏢 {name}</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Previous balance"><Money value={f.eprev} onChange={set("eprev")} /></Field>
                <Field label="Amount received"><Money value={f.eamt} onChange={set("eamt")} /></Field>
              </div>
              <TotalLine label="Final balance" value={inr(efinal)} />
            </div>
            <div className="rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4">
              <p className="mb-3 text-sm font-bold">💵 Cash</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Previous balance"><Money value={f.cprev} onChange={set("cprev")} /></Field>
                <Field label="Amount received"><Money value={f.camt} onChange={set("camt")} /></Field>
              </div>
              <TotalLine label="Final balance" value={inr(cfinal)} />
            </div>
            {extraCos.map((c) => (
              <div key={c.key} className="rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4">
                <p className="mb-3 text-sm font-bold">🏬 {c.label}</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Previous balance"><Money value={xget(c.key).prev} onChange={xset(c.key, "prev")} /></Field>
                  <Field label="Amount received"><Money value={xget(c.key).amt} onChange={xset(c.key, "amt")} /></Field>
                </div>
                <TotalLine label="Final balance" value={inr(n(xget(c.key).prev) - n(xget(c.key).amt))} />
              </div>
            ))}
            <TotalLine strong label="Total outstanding" value={inr(efinal + cfinal + xfinal)} />
          </Card>
        }
        message={<div className="space-y-4">
          <MessagePanel
            type="payment-updated" customer={customer} inputs={{ customer: customer?.name || "", ...f, ...(extraCos.length ? { extra: xf } : {}) }}
            build={() => customer
              ? paymentUpdated(settings, { name: customer.name, mode: f.mode, date: f.date, eprev: n(f.eprev), eamt: n(f.eamt), cprev: n(f.cprev), camt: n(f.camt), receivedBy: f.receivedBy, txnRef: f.txnRef,
                extra: extraCos.map((c) => ({ label: c.label, prev: n(xget(c.key).prev), amt: n(xget(c.key).amt) })) })
              : "!Please select a customer first."}
            onGenerated={async () => { await recordReceipt(); }}
          />
          <Button variant="whatsapp" className="w-full" onClick={sendReceipt} disabled={making}><IconBrandWhatsapp size={18} /> {making ? "Making PDF…" : "Send receipt PDF on WhatsApp"}</Button>
        </div>}
      />
      <ReceiptsReport />
    </div>
  );
}
