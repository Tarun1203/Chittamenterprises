import { useState } from "react";
import { Card, Field, PageHeader, useToast } from "@/components/kit";
import { BalanceNote, CustomerPicker, MessagePanel, Money, Select, Text, TotalLine, TwoColumn, n, useTallyFill } from "@/components/forms";
import { useStore } from "@/lib/store";
import { saveRecord, type Customer, type Receipt } from "@/lib/data";
import { isCashMode, payRefLabel, paymentUpdated } from "@/lib/messages";
import { inr, todayISO } from "@/lib/format";
import { ReceiptsReport } from "./ReceiptsReport";
import { TallyFreshness } from "@/components/TallyFreshness";


export function PaymentUpdated() {
  const { settings, receipts } = useStore();
  const toast = useToast();
  const tally = useTallyFill();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [note, setNote] = useState("");
  const [f, setF] = useState({ mode: settings.paymentModes[0] || "", date: todayISO(), eprev: "", eamt: "", cprev: "", camt: "", receivedBy: "", txnRef: "" });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  function pick(c: Customer | null) {
    setCustomer(c);
    const t = tally(c);
    setNote(t.note);
    if (t.business !== null || t.cash !== null) setF((x) => ({ ...x, eprev: t.business === null ? "" : String(t.business), cprev: t.cash === null ? "" : String(t.cash) }));
  }

  const efinal = n(f.eprev) - n(f.eamt), cfinal = n(f.cprev) - n(f.camt);
  const name = settings.businessName;

  // every Payment Updated message is also a payment in the report below:
  // one per customer per day, so generating again after a fix updates it
  async function recordReceipt() {
    if (!customer || (!n(f.eamt) && !n(f.camt))) return;
    const id = "pu_" + customer.id + "_" + (f.date || todayISO());
    const before = receipts.find((r) => r.id === id) || null;
    const rec: Receipt = {
      ...(before || {}), id, date: f.date || todayISO(), customerId: customer.id, customerName: customer.name,
      mode: f.mode || "—", business: n(f.eamt), cash: n(f.camt), source: "Payment Updated", ref: before?.ref || "", note: before?.note || "", cancelled: false,
      receivedBy: isCashMode(f.mode) ? f.receivedBy.trim() : "", txnRef: isCashMode(f.mode) ? "" : f.txnRef.trim(),
    };
    try { await saveRecord("receipts", rec, before); } catch (e) { toast("Payment not saved: " + (e as Error).message); }
  }

  return (
    <div>
      <PageHeader icon="money-bag" eyebrow="Messages" title="Payment Updated" subtitle="Thank the customer for a payment with both ledgers. Each one is also added to Payments Received below." />
      <TwoColumn
        form={
          <Card className="space-y-4">
            <Field label="Customer"><CustomerPicker value={customer} onPick={pick} /><BalanceNote note={note} />{customer && <TallyFreshness className="mt-2" />}</Field>
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
            <TotalLine strong label="Total outstanding" value={inr(efinal + cfinal)} />
          </Card>
        }
        message={
          <MessagePanel
            type="payment-updated" customer={customer} inputs={{ customer: customer?.name || "", ...f }}
            build={() => customer
              ? paymentUpdated(settings, { name: customer.name, mode: f.mode, date: f.date, eprev: n(f.eprev), eamt: n(f.eamt), cprev: n(f.cprev), camt: n(f.camt), receivedBy: f.receivedBy, txnRef: f.txnRef })
              : "!Please select a customer first."}
            onGenerated={recordReceipt}
          />
        }
      />
      <ReceiptsReport />
    </div>
  );
}
