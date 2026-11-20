// Orders: list with summary, search and status filter; an editor with items
// from the Product list, transport + charges, advance (→ Payments Received)
// and the Order Confirmation message; pick lists for one order or a day.
// No delete — an order is cancelled by its status.
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import { motion } from "motion/react";
import { IconArrowLeft, IconClipboardList, IconDeviceFloppy, IconHourglass, IconPackage, IconPlus } from "@tabler/icons-react";
import { Button, Card, Dialog, EmptyState, Field, PageHeader, useToast } from "@/components/kit";
import { CustomerPicker, MessagePanel, Money, RowRemove, Select, SuggestInput, Text, TotalLine, n, useProductSuggestions, useTransportSuggestions } from "@/components/forms";
import { useStore } from "@/lib/store";
import { normalizeName, saveRecord, uid, type Customer, type Order, type OrderItem, type Receipt } from "@/lib/data";
import { FREIGHT_TERMS, findTransport, freightRefund, msgDate, orderConfirmation, orderPending, packQty, pendingQty } from "@/lib/messages";
import { inr, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Chip } from "./ReceiptsReport";
import { stockOf, syncedWhen, useTallyStock } from "@/lib/tallydata";
import { TallyFreshness } from "@/components/TallyFreshness";

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

// avail: "" = all of it can be packed now; a number = only that many (rest pending)
type Row = { name: string; qty: string; rate: string; avail: string };
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
  const [pendingOpen, setPendingOpen] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [showDone, setShowDone] = useState(false);

  const sorted = useMemo(() => [...orders].sort((a, b) => (b.date || "").localeCompare(a.date || "") || String(b.orderNo).localeCompare(String(a.orderNo))), [orders]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    let open = 0;
    sorted.forEach((o) => { c[o.status] = (c[o.status] || 0) + 1; if (o.status !== "Delivered" && o.status !== "Cancelled") open += n(o.total); });
    return { c, open };
  }, [sorted]);
  const pendingCount = useMemo(() => sorted.filter((o) => o.status !== "Cancelled" && o.status !== "Delivered").reduce((t, o) => t + orderPending(o).length, 0), [sorted]);
  const list = sorted.filter((o) => {
    if (status && o.status !== status) return false;
    const f = q.trim().toLowerCase();
    return !f || [o.orderNo, o.customerName, o.notes, ...(o.items || []).map((i) => i.name)].join(" ").toLowerCase().includes(f);
  });

  // without a status filter: open orders first, then delivered orders that still owe
  // items (showing only those), and fully delivered / cancelled ones hidden behind a button
  const isDone = (o: Order) => o.status === "Delivered" || o.status === "Cancelled";
  const open = list.filter((o) => !isDone(o));
  const deliveredPending = list.filter((o) => o.status === "Delivered" && orderPending(o).length > 0);
  const done = list.filter((o) => isDone(o) && !(o.status === "Delivered" && orderPending(o).length > 0));

  if (editing) return <OrderEditor order={editing === "new" ? null : editing} onClose={() => setEditing(null)} />;

  return (
    <div>
      <PageHeader icon="file-text" eyebrow="Work" title="Orders" subtitle="Take orders, send the confirmation, and print pick lists for the godown."
        actions={<>
          <Button variant="secondary" size="sm" onClick={() => setPendingOpen(true)}><IconHourglass size={16} /> Pending items{pendingCount ? " (" + pendingCount + ")" : ""}</Button>
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
        <Text className="max-w-md min-w-[15rem] flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search order no., customer or product…" />
        <Select className="w-auto" value={status} onChange={setStatus} options={[{ value: "", label: "All statuses" }, ...ORDER_STATUSES.map((s) => ({ value: s, label: s }))]} />
      </div>
      {list.length === 0 ? (
        <EmptyState icon="file-text" title={sorted.length ? "No orders match" : "No orders yet"} text={sorted.length ? "Try another search or status." : "Press “New order” to take the first one."}
          action={!sorted.length && <Button onClick={() => setEditing("new")}><IconPlus size={16} /> New order</Button>} />
      ) : (
        status ? (
          <div className="grid gap-3 md:grid-cols-2">{list.map((o, i) => <OrderCard key={o.id} o={o} i={i} onOpen={() => setEditing(o)} />)}</div>
        ) : (
          <div className="space-y-6">
            {open.length > 0
              ? <div className="grid gap-3 md:grid-cols-2">{open.map((o, i) => <OrderCard key={o.id} o={o} i={i} onOpen={() => setEditing(o)} />)}</div>
              : <p className="rounded-2xl border border-dashed border-neutral-200 p-4 text-sm text-neutral-500">No open orders{q ? " match" : ""}.</p>}
            {deliveredPending.length > 0 && (
              <section>
                <h2 className="mb-2 flex items-center gap-2 text-sm font-extrabold text-amber-800"><IconHourglass size={16} /> Delivered — items still pending ({deliveredPending.length})</h2>
                <div className="grid gap-3 md:grid-cols-2">{deliveredPending.map((o, i) => <OrderCard key={o.id} o={o} i={i} pendingOnly onOpen={() => setEditing(o)} />)}</div>
              </section>
            )}
            {done.length > 0 && (
              <section>
                <button onClick={() => setShowDone((v) => !v)} className="text-sm font-semibold text-brand-600 hover:underline">
                  {showDone ? "Hide delivered & cancelled" : "Show delivered & cancelled (" + done.length + ")"}
                </button>
                {showDone && <div className="mt-3 grid gap-3 opacity-80 md:grid-cols-2">{done.map((o, i) => <OrderCard key={o.id} o={o} i={i} onOpen={() => setEditing(o)} />)}</div>}
              </section>
            )}
          </div>
        )
      )}
      <PickListDialog open={pickOpen} onClose={() => setPickOpen(false)} />
      <PendingDialog open={pendingOpen} onClose={() => setPendingOpen(false)} />
    </div>
  );
}

function OrderCard({ o, i, onOpen, pendingOnly }: { o: Order; i: number; onOpen: () => void; pendingOnly?: boolean }) {
  const pend = orderPending(o);
  return (
    <motion.button onClick={onOpen} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02 }}
      className={cn("rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md", pendingOnly ? "border-amber-200 hover:border-amber-300" : "border-neutral-200/80 hover:border-brand-200")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold text-brand-600 tabular-nums">{o.orderNo} · {msgDate(o.date)}</div>
          <div className="truncate text-[15px] font-bold">{o.customerName || "—"}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={o.status || "Pending"} />
          {pend.length > 0 && o.status !== "Cancelled" && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200">⏳ {pend.reduce((t, it) => t + pendingQty(it), 0)} pending</span>}
        </div>
      </div>
      {pendingOnly ? (
        <ul className="mt-2 space-y-0.5 text-sm">
          {pend.map((it, k) => <li key={k} className="flex justify-between gap-3"><span className="min-w-0 truncate">{it.name}</span><span className="shrink-0 font-semibold tabular-nums text-amber-800">{pendingQty(it)} pending</span></li>)}
        </ul>
      ) : (
        <div className="mt-2 line-clamp-2 text-xs text-neutral-500">{(o.items || []).map((it) => it.name + (it.qty ? " × " + it.qty : "")).join(", ")}</div>
      )}
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-neutral-500">{o.transport ? "🚛 " + o.transport : ""}</span>
        {!pendingOnly && <strong className="tabular-nums">{inr(o.total)}</strong>}
      </div>
    </motion.button>
  );
}

const blankRow: Row = { name: "", qty: "", rate: "", avail: "" };

// under each order line: how many can be packed now; the rest stays pending
function StockLine({ row, onChange, stock }: { row: Row; onChange: (avail: string) => void; stock: ReturnType<typeof stockOf> }) {
  const qty = n(row.qty);
  const avail = row.avail === "" ? qty : Math.min(qty, Math.max(0, n(row.avail)));
  const pending = qty - avail;
  return (
    <div className="col-span-2 flex flex-wrap items-center gap-2 text-xs sm:col-span-5">
      <span className="font-semibold text-neutral-500">Available now</span>
      <input type="number" inputMode="decimal" min={0} max={qty} value={row.avail === "" ? String(qty) : row.avail}
        onChange={(e) => onChange(e.target.value === "" || n(e.target.value) >= qty ? "" : e.target.value)}
        className="h-8 w-20 rounded-lg border border-neutral-200 bg-white px-2 text-sm tabular-nums outline-none focus:border-brand-500" />
      {pending > 0
        ? <span className="rounded-full bg-amber-50 px-2 py-0.5 font-bold text-amber-700">⏳ {pending} pending</span>
        : <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700">✓ in stock</span>}
      {pending < qty
        ? <button type="button" onClick={() => onChange("0")} className="rounded-lg px-2 py-1 font-semibold text-neutral-500 hover:bg-neutral-100">No stock</button>
        : <button type="button" onClick={() => onChange("")} className="rounded-lg px-2 py-1 font-semibold text-brand-600 hover:bg-brand-50">All available</button>}
      {stock && (
        <span className={cn("ml-auto rounded-full px-2 py-0.5 font-semibold", stock.total <= 0 ? "bg-rose-50 text-rose-700" : stock.total < qty ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-600")}
          title={Object.entries(stock.per || {}).map(([k, q]) => (k === "business" ? "Chittam" : k === "cash" ? "Cash" : k) + ": " + q).join(" · ")}>
          Tally stock {stock.total} {stock.unit}
        </span>
      )}
    </div>
  );
}

// every pending item across open orders, by product; "Mark available" moves it to packing
function PendingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { orders } = useStore();
  const toast = useToast();
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; total: number; rows: { o: Order; idx: number; qty: number }[] }>();
    orders.filter((o) => o.status !== "Cancelled" && o.status !== "Delivered").forEach((o) => (o.items || []).forEach((it, idx) => {
      const q = pendingQty(it);
      if (!q) return;
      const k = normalizeName(it.name);
      const g = m.get(k) || { name: it.name, total: 0, rows: [] };
      g.total += q; g.rows.push({ o, idx, qty: q }); m.set(k, g);
    }));
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [orders]);
  async function markAvailable(o: Order, idx: number) {
    const items = o.items.map((it, j) => { if (j !== idx) return it; const { avail: _drop, ...rest } = it; void _drop; return rest; });
    try { await saveRecord("orders", { ...o, items }, o); toast(o.items[idx].name + " is ready to pack for order " + o.orderNo + "."); }
    catch (e) { toast("Could not save: " + (e as Error).message); }
  }
  return (
    <Dialog open={open} onClose={onClose} title={"Pending items" + (groups.length ? " · " + groups.reduce((t, g) => t + g.total, 0) + " pcs" : "")}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      {groups.length === 0 ? <p className="rounded-xl bg-neutral-50 p-6 text-center text-sm text-neutral-500">Nothing pending — every open order can be packed.</p> : (
        <div className="space-y-3">
          <p className="text-xs text-neutral-500">Items with no stock, kept in their orders. When stock arrives, mark them available and they join the pick list.</p>
          {groups.map((g) => (
            <div key={g.name} className="rounded-xl border border-neutral-100">
              <div className="flex items-center justify-between bg-neutral-50 px-3 py-2 text-sm font-bold"><span className="min-w-0 truncate">{g.name}</span><span className="tabular-nums text-amber-700">{g.total} pending</span></div>
              {g.rows.map(({ o, idx, qty }) => (
                <div key={o.id + idx} className="flex items-center gap-3 border-t border-neutral-100 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1"><span className="font-semibold">{o.orderNo}</span> · {o.customerName}<span className="block text-xs text-neutral-500">{msgDate(o.date)} · {o.status}</span></span>
                  <span className="font-bold tabular-nums">× {qty}</span>
                  <button onClick={() => markAvailable(o, idx)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100"><IconPackage size={13} /> Mark available</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

function OrderEditor({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const { orders, customers, products, transports, receipts, settings } = useStore();
  const toast = useToast();
  const productList = useProductSuggestions();
  const transportList = useTransportSuggestions();
  const tallyStock = useTallyStock();
  // "available now" from Tally's stock: all of it if there's enough, else what there is
  const autoAvail = (name: string, qty: number) => {
    const st = stockOf(tallyStock, name);
    if (!st || !qty || qty <= st.total) return "";
    return String(Math.max(0, Math.floor(st.total)));
  };
  const [saved, setSaved] = useState<Order | null>(order);
  const [pickOrder, setPickOrder] = useState<Order | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(() =>
    order ? customers.find((c) => c.id === order.customerId) || { id: order.customerId, name: order.customerName, mobile: order.mobile } : null);
  const [f, setF] = useState<Form>(() => ({
    orderNo: order?.orderNo || nextOrderNo(orders, todayISO()), date: order?.date || todayISO(), deliveryDate: order?.deliveryDate || "",
    transport: order?.transport || "", transportPhone: order?.transportPhone || "", freightTerms: order?.freightTerms || "", freight: order?.freight ? String(order.freight) : "",
    status: order?.status || "Pending", advance: order?.advance ? String(order.advance) : "", notes: order?.notes || "",
    items: order?.items?.length ? order.items.map((i) => ({ name: i.name, qty: i.qty ? String(i.qty) : "", rate: i.rate ? String(i.rate) : "", avail: i.avail === undefined || i.avail === null || i.avail >= i.qty ? "" : String(i.avail) })) : [blankRow, blankRow],
  }));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const setRow = (i: number, patch: Partial<Row>) => setF((x) => ({ ...x, items: x.items.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  const items: OrderItem[] = f.items.filter((r) => r.name.trim()).map((r) => {
    const qty = n(r.qty), rate = n(r.rate);
    const it: OrderItem = { name: r.name.trim(), qty, rate, amount: Math.round(qty * rate * 100) / 100 };
    if (r.avail !== "" && n(r.avail) < qty) it.avail = Math.max(0, n(r.avail));
    return it;
  });
  const pendingLines = items.filter((it) => pendingQty(it) > 0);
  const packValue = Math.round(items.reduce((t, it) => t + packQty(it) * it.rate, 0) * 100) / 100;
  const total = Math.round(items.reduce((t, i) => t + i.amount, 0) * 100) / 100;
  const refund = freightRefund(f.freightTerms, f.freight);
  const balance = Math.max(0, total + refund - n(f.advance));

  function changeDate(iso: string) {
    // a new order is re-numbered for the new day, unless its number was typed in
    setF((x) => ({ ...x, date: iso, orderNo: !saved && (!x.orderNo || /^\d{2}\/\d{2}-\d+$/.test(x.orderNo)) ? nextOrderNo(orders, iso || todayISO()) : x.orderNo }));
  }
  function pickProduct(i: number, name: string) {
    const p = products.find((x) => normalizeName(x.name) === normalizeName(name));
    setRow(i, { ...(p && !f.items[i].rate ? { rate: p.price ? String(p.price) : "" } : {}), avail: autoAvail(name, n(f.items[i].qty)) });
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
              <Button size="sm" variant="secondary" onClick={() => set("items", [...f.items, blankRow])}><IconPlus size={15} /> Item</Button>
            </div>
            {f.items.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-neutral-100 bg-neutral-50/60 p-2.5 sm:grid-cols-[1fr_5rem_6.5rem_5.5rem_auto] sm:items-center">
                <SuggestInput value={r.name} onChange={(v) => setRow(i, { name: v })} onPick={(v) => pickProduct(i, v)} suggestions={productList} placeholder="Product (type to search)" />
                <div className="sm:hidden"><RowRemove onClick={() => set("items", f.items.filter((_, j) => j !== i))} /></div>
                <div className="col-span-2 grid grid-cols-[1fr_1fr_auto] items-center gap-2 sm:col-span-3 sm:grid-cols-[5rem_6.5rem_5.5rem]">
                  <Money placeholder="Qty" value={r.qty} onChange={(v) => setRow(i, { qty: v, avail: autoAvail(r.name, n(v)) })} />
                  <Money placeholder="Rate" value={r.rate} onChange={(v) => setRow(i, { rate: v })} />
                  <span className="text-right text-sm font-semibold tabular-nums">{inr(Math.round(n(r.qty) * n(r.rate) * 100) / 100)}</span>
                </div>
                <div className="hidden sm:block"><RowRemove onClick={() => set("items", f.items.filter((_, j) => j !== i))} /></div>
                {r.name.trim() && n(r.qty) > 0 && <StockLine row={r} stock={stockOf(tallyStock, r.name)} onChange={(avail) => setRow(i, { avail })} />}
              </div>
            ))}
            <TotalLine strong label="Order total" value={inr(total)} />
            <TallyFreshness what="Tally stock figures" />
            {tallyStock && Object.keys(tallyStock).length > 0 && (
              <p className="text-xs text-neutral-400">Tally stock (all companies added up) as of {syncedWhen(Object.values(tallyStock).map((x) => x?.syncedAt).find(Boolean))} — “Available now” fills in from it; change it if needed.</p>
            )}
            {pendingLines.length > 0 && <>
              <TotalLine label="To pack now" value={inr(packValue)} />
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">⏳ Pending (no stock): {pendingLines.map((it) => it.name + " × " + pendingQty(it)).join(", ")}. Kept in this order; they go in the order message and leave the pick list until marked available.</p>
            </>}
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
