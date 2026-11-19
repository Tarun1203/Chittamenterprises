// Orders: list with summary, search and status filter; an editor with items
// from the Product list, transport + charges, advance (→ Payments Received)
// and the Order Confirmation message; pick lists for one order or a day.
// No delete — an order is cancelled by its status.
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import { motion } from "motion/react";
import { IconArrowLeft, IconClipboardList, IconDeviceFloppy, IconPlus } from "@tabler/icons-react";
import { Button, Card, EmptyState, Field, PageHeader, useToast } from "@/components/kit";
import { CustomerPicker, MessagePanel, Money, RowRemove, Select, SuggestInput, Text, TotalLine, n, useProductSuggestions, useTransportSuggestions } from "@/components/forms";
import { useStore } from "@/lib/store";
import { normalizeName, saveRecord, uid, type Customer, type Order, type OrderItem, type Receipt } from "@/lib/data";
import { FREIGHT_TERMS, findTransport, freightRefund, msgDate, orderConfirmation } from "@/lib/messages";
import { inr, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Chip } from "./ReceiptsReport";
import { PickListDialog } from "./PickList";

export const ORDER_STATUSES = ["Pending", "Confirmed", "Packed", "Dispatched", "Delivered", "Cancelled"];
const STATUS_STYLE: Record<string, string> = {
  Pending: "bg-amber-50 text-amber-700 ring-amber-200", Confirmed: "bg-sky-50 text-sky-700 ring-sky-200",
  Packed: "bg-violet-50 text-violet-700 ring-violet-200", Dispatched: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  Delivered: "bg-emerald-50 text-emerald-700 ring-emerald-200", Cancelled: "bg-neutral-100 text-neutral-500 ring-neutral-200",
  Received: "bg-amber-50 text-amber-700 ring-amber-200", "Under Service": "bg-sky-50 text-sky-700 ring-sky-200",
  "Ready to Return": "bg-violet-50 text-violet-700 ring-violet-200", "Sent Back": "bg-emerald-50 text-emerald-700 ring-emerald-200",
};
export function StatusBadge({ status }: { status: string }) {
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap ring-1", STATUS_STYLE[status] || STATUS_STYLE.Pending)}>{status}</span>;
}

// Order No. = DD/MM-serial; the serial restarts every day
export function nextOrderNo(orders: Order[], iso: string) {
  const [, m, d] = (iso || todayISO()).split("-");
  const prefix = d + "/" + m + "-";
  const max = orders.reduce((mx, o) => (o.date === iso && String(o.orderNo || "").startsWith(prefix) ? Math.max(mx, Number(String(o.orderNo).slice(prefix.length)) || 0) : mx), 0);
  return prefix + String(max + 1).padStart(2, "0");
}

type Row = { name: string; qty: string; rate: string };
interface Form {
  orderNo: string; date: string; deliveryDate: string; transport: string; transportPhone: string; freightTerms: string; freight: string;
  status: string; advance: string; notes: string; items: Row[];
}

export function Orders() {
  const { orders } = useStore();
  const [editing, setEditing] = useState<Order | "new" | null>(null);
  // the menu link (same page) goes back to the list
  const { key } = useLocation();
  useEffect(() => { setEditing(null); }, [key]);
  useEffect(() => { window.scrollTo(0, 0); }, [editing]);
  const [pickOpen, setPickOpen] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  const sorted = useMemo(() => [...orders].sort((a, b) => (b.date || "").localeCompare(a.date || "") || String(b.orderNo).localeCompare(String(a.orderNo))), [orders]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    let open = 0;
    sorted.forEach((o) => { c[o.status] = (c[o.status] || 0) + 1; if (o.status !== "Delivered" && o.status !== "Cancelled") open += n(o.total); });
    return { c, open };
  }, [sorted]);
  const list = sorted.filter((o) => {
    if (status && o.status !== status) return false;
    const f = q.trim().toLowerCase();
    return !f || [o.orderNo, o.customerName, o.notes, ...(o.items || []).map((i) => i.name)].join(" ").toLowerCase().includes(f);
  });

  if (editing) return <OrderEditor order={editing === "new" ? null : editing} onClose={() => setEditing(null)} />;

  return (
    <div>
      <PageHeader icon="file-text" eyebrow="Work" title="Orders" subtitle="Take orders, send the confirmation, and print pick lists for the godown."
        actions={<>
          <Button variant="secondary" size="sm" onClick={() => setPickOpen(true)}><IconClipboardList size={16} /> Pick list</Button>
          <Button size="sm" onClick={() => setEditing("new")}><IconPlus size={16} /> New order</Button>
        </>} />
      {sorted.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {ORDER_STATUSES.filter((s) => counts.c[s]).map((s) => <Chip key={s} label={s} value={String(counts.c[s])} />)}
          <Chip strong label="Open order value" value={inr(Math.round(counts.open))} />
        </div>
      )}
      <div className="mb-5 flex flex-wrap gap-3">
        <Text className="max-w-md flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search order no., customer or product…" />
        <Select className="w-auto" value={status} onChange={setStatus} options={[{ value: "", label: "All statuses" }, ...ORDER_STATUSES.map((s) => ({ value: s, label: s }))]} />
      </div>
      {list.length === 0 ? (
        <EmptyState icon="file-text" title={sorted.length ? "No orders match" : "No orders yet"} text={sorted.length ? "Try another search or status." : "Press “New order” to take the first one."}
          action={!sorted.length && <Button onClick={() => setEditing("new")}><IconPlus size={16} /> New order</Button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((o, i) => (
            <motion.button key={o.id} onClick={() => setEditing(o)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02 }}
              className="rounded-2xl border border-neutral-200/80 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-brand-600 tabular-nums">{o.orderNo} · {msgDate(o.date)}</div>
                  <div className="truncate text-[15px] font-bold">{o.customerName || "—"}</div>
                </div>
                <StatusBadge status={o.status || "Pending"} />
              </div>
              <div className="mt-2 line-clamp-2 text-xs text-neutral-500">{(o.items || []).map((it) => it.name + (it.qty ? " × " + it.qty : "")).join(", ")}</div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-neutral-500">{o.transport ? "🚛 " + o.transport : ""}</span>
                <strong className="tabular-nums">{inr(o.total)}</strong>
              </div>
            </motion.button>
          ))}
        </div>
      )}
      <PickListDialog open={pickOpen} onClose={() => setPickOpen(false)} />
    </div>
  );
}

function OrderEditor({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const { orders, customers, products, transports, receipts, settings } = useStore();
  const toast = useToast();
  const productList = useProductSuggestions();
  const transportList = useTransportSuggestions();
  const [saved, setSaved] = useState<Order | null>(order);
  const [pickOrder, setPickOrder] = useState<Order | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(() =>
    order ? customers.find((c) => c.id === order.customerId) || { id: order.customerId, name: order.customerName, mobile: order.mobile } : null);
  const [f, setF] = useState<Form>(() => ({
    orderNo: order?.orderNo || nextOrderNo(orders, todayISO()), date: order?.date || todayISO(), deliveryDate: order?.deliveryDate || "",
    transport: order?.transport || "", transportPhone: order?.transportPhone || "", freightTerms: order?.freightTerms || "", freight: order?.freight ? String(order.freight) : "",
    status: order?.status || "Pending", advance: order?.advance ? String(order.advance) : "", notes: order?.notes || "",
    items: order?.items?.length ? order.items.map((i) => ({ name: i.name, qty: i.qty ? String(i.qty) : "", rate: i.rate ? String(i.rate) : "" })) : [{ name: "", qty: "", rate: "" }, { name: "", qty: "", rate: "" }],
  }));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const setRow = (i: number, patch: Partial<Row>) => setF((x) => ({ ...x, items: x.items.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  const items: OrderItem[] = f.items.filter((r) => r.name.trim()).map((r) => {
    const qty = n(r.qty), rate = n(r.rate);
    return { name: r.name.trim(), qty, rate, amount: Math.round(qty * rate * 100) / 100 };
  });
  const total = Math.round(items.reduce((t, i) => t + i.amount, 0) * 100) / 100;
  const refund = freightRefund(f.freightTerms, f.freight);
  const balance = Math.max(0, total + refund - n(f.advance));

  function changeDate(iso: string) {
    // a new order is re-numbered for the new day, unless its number was typed in
    setF((x) => ({ ...x, date: iso, orderNo: !saved && (!x.orderNo || /^\d{2}\/\d{2}-\d+$/.test(x.orderNo)) ? nextOrderNo(orders, iso || todayISO()) : x.orderNo }));
  }
  function pickProduct(i: number, name: string) {
    const p = products.find((x) => normalizeName(x.name) === normalizeName(name));
    if (p && !f.items[i].rate) setRow(i, { rate: p.price ? String(p.price) : "" });
  }
  function pickTransport(name: string) {
    const t = findTransport(transports, name);
    if (t?.phone) set("transportPhone", t.phone);
  }

  function fromForm(): Omit<Order, "id"> | string {
    if (!customer) return "Please select a customer first.";
    if (!items.length) return "Add at least one item with a product name.";
    const date = f.date || todayISO();
    const orderNo = f.orderNo.trim() || nextOrderNo(orders, date);
    // the same DD/MM-serial comes round again next year, so only that year counts
    const clash = orders.find((o) => o.orderNo === orderNo && o.id !== saved?.id && String(o.date || "").slice(0, 4) === date.slice(0, 4));
    if (clash) return "Order No. " + orderNo + " is already used — change it.";
    return {
      orderNo, date, deliveryDate: f.deliveryDate, transport: f.transport.trim(), transportPhone: f.transportPhone.trim(),
      freightTerms: f.freightTerms, freight: n(f.freight), customerId: customer.id, customerName: customer.name, mobile: customer.mobile || "",
      status: f.status, advance: n(f.advance), items, total, notes: f.notes.trim(),
    };
  }

  async function save() {
    const data = fromForm();
    if (typeof data === "string") { toast(data); return; }
    const item: Order = { ...(saved || {}), ...data, id: saved?.id || "o_" + uid().slice(2) };
    try {
      await saveRecord("orders", item, saved);
      // a transport typed here that isn't on file yet is added to Transports
      if (item.transport && !findTransport(transports, item.transport)) {
        await saveRecord("transports", { id: "t_" + uid().slice(2), name: item.transport, phone: item.transportPhone || "", contactPerson: "", branch: "" }, null);
      }
      // the advance is a payment in Payments Received (cancelled if taken off)
      const rid = "ord_" + item.id;
      const before = receipts.find((r) => r.id === rid) || null;
      if (item.advance || before) {
        const rec: Receipt = {
          ...(before || {}), id: rid, date: item.date, customerId: item.customerId, customerName: item.customerName,
          mode: "Advance", business: item.advance, cash: 0, source: "Order advance", ref: item.orderNo, note: before?.note || "", cancelled: !item.advance,
        };
        await saveRecord("receipts", rec, before);
      }
      setSaved(item);
      toast("Order " + item.orderNo + " saved.");
    } catch (e) { toast("Could not save: " + (e as Error).message); }
  }

  function openPick() {
    const data = fromForm();
    if (typeof data === "string") { toast(data); return; }
    setPickOrder({ ...data, id: saved?.id || "draft" });
  }

  return (
    <div>
      <button onClick={onClose} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-500 hover:text-brand-700"><IconArrowLeft size={16} /> All orders</button>
      <PageHeader icon="file-text" eyebrow={saved ? "Order " + saved.orderNo : "New order"} title={saved?.customerName || customer?.name || "New order"}
        actions={<>
          <Button variant="secondary" size="sm" onClick={openPick}><IconClipboardList size={16} /> Pick list</Button>
          <Button size="sm" onClick={save}><IconDeviceFloppy size={16} /> Save order</Button>
        </>} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card className="space-y-4">
            <Field label="Customer"><CustomerPicker value={customer} onPick={setCustomer} /></Field>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Order No."><Text value={f.orderNo} onChange={(e) => set("orderNo", e.target.value)} /></Field>
              <Field label="Order date"><Text type="date" value={f.date} onChange={(e) => changeDate(e.target.value)} /></Field>
              <Field label="Expected delivery"><Text type="date" value={f.deliveryDate} onChange={(e) => set("deliveryDate", e.target.value)} /></Field>
              <Field label="Status"><Select value={f.status} onChange={(v) => set("status", v)} options={ORDER_STATUSES} /></Field>
            </div>
          </Card>
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-wide text-neutral-500 uppercase">Items</h3>
              <Button size="sm" variant="secondary" onClick={() => set("items", [...f.items, { name: "", qty: "", rate: "" }])}><IconPlus size={15} /> Item</Button>
            </div>
            {f.items.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-neutral-100 bg-neutral-50/60 p-2.5 sm:grid-cols-[1fr_5rem_6.5rem_5.5rem_auto] sm:items-center sm:border-0 sm:bg-transparent sm:p-0">
                <SuggestInput value={r.name} onChange={(v) => setRow(i, { name: v })} onPick={(v) => pickProduct(i, v)} suggestions={productList} placeholder="Product (type to search)" />
                <div className="sm:hidden"><RowRemove onClick={() => set("items", f.items.filter((_, j) => j !== i))} /></div>
                <div className="col-span-2 grid grid-cols-[1fr_1fr_auto] items-center gap-2 sm:col-span-3 sm:grid-cols-[5rem_6.5rem_5.5rem]">
                  <Money placeholder="Qty" value={r.qty} onChange={(v) => setRow(i, { qty: v })} />
                  <Money placeholder="Rate" value={r.rate} onChange={(v) => setRow(i, { rate: v })} />
                  <span className="text-right text-sm font-semibold tabular-nums">{inr(Math.round(n(r.qty) * n(r.rate) * 100) / 100)}</span>
                </div>
                <div className="hidden sm:block"><RowRemove onClick={() => set("items", f.items.filter((_, j) => j !== i))} /></div>
              </div>
            ))}
            <TotalLine strong label="Order total" value={inr(total)} />
          </Card>
          <Card className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Transport" className="col-span-2 sm:col-span-1"><SuggestInput value={f.transport} onChange={(v) => set("transport", v)} onPick={pickTransport} suggestions={transportList} placeholder="e.g. VRL Logistics (pick or type)" /></Field>
              <Field label="Transport phone" className="col-span-2 sm:col-span-1"><Text value={f.transportPhone} onChange={(e) => set("transportPhone", e.target.value)} placeholder="Filled in from Transports" /></Field>
              <Field label="Transport charges"><Select value={f.freightTerms} onChange={(v) => set("freightTerms", v)} options={FREIGHT_TERMS} /></Field>
              <Field label="Amount (₹)"><Money value={f.freight} onChange={(v) => set("freight", v)} /></Field>
              <Field label="Advance received (₹)"><Money value={f.advance} onChange={(v) => set("advance", v)} /></Field>
            </div>
            <Field label="Notes"><Text value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional" /></Field>
            {refund > 0 && <TotalLine label="Transport refund" value={inr(refund)} />}
            <TotalLine strong label="Balance payable" value={inr(balance)} />
          </Card>
        </div>
        <MessagePanel title="Order confirmation" type="order-confirmation" customer={customer} inputs={{ customer: customer?.name || "", ...f }}
          build={() => { const d = fromForm(); return typeof d === "string" ? "!" + d : orderConfirmation(settings, transports, d); }} />
      </div>
      <PickListDialog open={!!pickOrder} onClose={() => setPickOrder(null)} single={pickOrder} />
    </div>
  );
}
