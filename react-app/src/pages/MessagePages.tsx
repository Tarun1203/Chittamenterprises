// Payment Reminder, Balance Confirmation, Dispatch, Stock Update, Stock Return
// and Service Material: a form on the left, the WhatsApp message on the right.
import { useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { Button, Card, Field, PageHeader } from "@/components/kit";
import {
  BalanceNote, CustomerPicker, MessagePanel, Money, RowRemove, Select, SuggestInput, Text, TotalLine, TwoColumn, n,
  useProductSuggestions, useTallyFill, useTransportSuggestions,
} from "@/components/forms";
import { useStore } from "@/lib/store";
import { normalizeName, type Customer } from "@/lib/data";
import {
  FREIGHT_TERMS, RETURN_REASONS, RETURN_STATUSES, balanceConfirmation, dispatchConfirmation, invoiceStatus, paymentReminder,
  serviceMaterial, stockReturn, stockUpdate, type Invoice,
} from "@/lib/messages";
import { inr, todayISO } from "@/lib/format";
import { billsOf, syncedWhen, useTallyBills } from "@/lib/tallydata";
import { TallyFreshness } from "@/components/TallyFreshness";
import { useCompanies } from "@/lib/companies";


const NEED_CUSTOMER = "!Please select a customer first.";
function useForm<T extends Record<string, unknown>>(init: T) {
  const [f, setF] = useState(init);
  const set = (k: keyof T) => (v: T[keyof T] | string) => setF((x) => ({ ...x, [k]: v }));
  return [f, set, setF] as const;
}
function useRows<T>(init: T[]) {
  const [rows, setRows] = useState(init);
  return {
    rows,
    add: (r: T) => setRows((x) => [...x, r]),
    remove: (i: number) => setRows((x) => x.filter((_, j) => j !== i)),
    update: (i: number, patch: Partial<T>) => setRows((x) => x.map((r, j) => (j === i ? { ...r, ...patch } : r))),
    setRows,
  };
}
function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold tracking-wide text-neutral-500 uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </Card>
  );
}

/* ================= Payment Reminder ================= */
export function PaymentReminder() {
  const { settings } = useStore();
  const tally = useTallyFill();
  const tallyBills = useTallyBills();
  const companies = useCompanies();
  const extraCos = companies.filter((c) => c.key !== "business" && c.key !== "cash");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [note, setNote] = useState("");
  const [billNote, setBillNote] = useState("");
  const [f, set, setF] = useForm({ date: todayISO(), dueDate: "", eb: "", ed: "", cb: "", cd: "" });
  // companies added in the Windows app: outstanding and pending days for each
  const [xo, setXo] = useState<Record<string, { bal: string; days: string }>>({});
  const xget = (k: string) => xo[k] || { bal: "", days: "" };
  const xset = (k: string, field: "bal" | "days") => (v: string) => setXo((x) => ({ ...x, [k]: { ...xget(k), [field]: v } }));
  const inv = useRows<Invoice>([]);
  function pick(c: Customer | null) {
    setCustomer(c);
    const t = tally(c);
    setNote(t.note);
    if (t.business !== null || t.cash !== null) setF((x) => ({ ...x, eb: t.business === null ? "" : String(t.business), cb: t.cash === null ? "" : String(t.cash) }));
    const nextXo: Record<string, { bal: string; days: string }> = Object.fromEntries(Object.entries(t.others).map(([k, v]) => [k, { bal: v === null ? "" : String(v), days: "" }]));
    setXo(nextXo);
    // open invoices from Tally (every company): invoice-wise due dates, and days pending since the oldest
    setBillNote("");
    if (!c || !tallyBills) return;
    const age = (iso?: string) => (iso ? Math.max(0, Math.round((new Date(todayISO() + "T00:00:00").getTime() - new Date(iso + "T00:00:00").getTime()) / 86400000)) : 0);
    const per = companies.map((co) => ({ co, bills: billsOf(tallyBills, co.key, c.name) }));
    const count = per.reduce((t, x) => t + x.bills.length, 0);
    if (!count) return;
    inv.setRows(per.flatMap(({ co, bills }) => bills.map((b) => ({ no: b.n, billDate: b.d, due: b.due || b.d, amt: b.a, account: co.key, label: co.label }))));
    const oldest = (k: string) => per.find((x) => x.co.key === k)?.bills[0]?.d;
    setF((x) => ({ ...x, ...(oldest("business") ? { ed: String(age(oldest("business"))) } : {}), ...(oldest("cash") ? { cd: String(age(oldest("cash"))) } : {}) }));
    setXo(Object.fromEntries(Object.entries(nextXo).map(([k, v]) => [k, { ...v, days: oldest(k) ? String(age(oldest(k))) : v.days }])));
    const when = syncedWhen(companies.map((co) => tallyBills[co.key]?.syncedAt).find(Boolean));
    setBillNote("🧾 " + count + " open invoice" + (count === 1 ? "" : "s") + " and pending days filled in from Tally (synced " + when + "). Check before sending.");
  }
  return (
    <div>
      <PageHeader icon="calender" eyebrow="Messages" title="Payment Reminder" subtitle="Outstanding in both accounts, invoice-wise due dates, and your UPI / bank details from Settings." />
      <TwoColumn
        form={<>
          <Card className="space-y-4">
            <Field label="Customer"><CustomerPicker value={customer} onPick={pick} /><BalanceNote note={note} />{customer && <TallyFreshness className="mt-2" customer={customer.name} />}{billNote && <BalanceNote note={"📒" + billNote.slice(2)} />}{customer && <a href={"#/ledger?c=" + customer.id} className="mt-2 inline-block text-xs font-semibold text-brand-600 hover:underline">Share the full ledger (all companies) →</a>}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="As on"><Text type="date" value={f.date} onChange={(e) => set("date")(e.target.value)} /></Field>
              <Field label="Pay by (optional)"><Text type="date" value={f.dueDate} onChange={(e) => set("dueDate")(e.target.value)} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={settings.businessName + " outstanding"}><Money value={f.eb} onChange={set("eb")} /></Field>
              <Field label="Pending days"><Money value={f.ed} onChange={set("ed")} /></Field>
              <Field label="Cash outstanding"><Money value={f.cb} onChange={set("cb")} /></Field>
              <Field label="Pending days"><Money value={f.cd} onChange={set("cd")} /></Field>
              {extraCos.map((co) => [
                <Field key={co.key + "b"} label={co.label + " outstanding"}><Money value={xget(co.key).bal} onChange={xset(co.key, "bal")} /></Field>,
                <Field key={co.key + "d"} label="Pending days"><Money value={xget(co.key).days} onChange={xset(co.key, "days")} /></Field>,
              ])}
            </div>
            <TotalLine strong label="Total outstanding" value={inr(n(f.eb) + n(f.cb) + extraCos.reduce((t, co) => t + n(xget(co.key).bal), 0))} />
          </Card>
          <Section title="Invoices (optional)" action={<Button size="sm" variant="secondary" onClick={() => inv.add({ no: "", billDate: "", due: "", amt: 0, account: "business" })}><IconPlus size={15} /> Invoice</Button>}>
            {inv.rows.length === 0 && <p className="text-sm text-neutral-400">Add invoices to list each one with its due date. 30+ days overdue makes the message urgent.</p>}
            {inv.rows.map((r, i) => (
              <div key={i} className="rounded-xl border border-neutral-100 bg-neutral-50/60 p-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <Text placeholder="Invoice No." value={r.no} onChange={(e) => inv.update(i, { no: e.target.value })} />
                  <Money placeholder="Amount (₹)" value={r.amt ? String(r.amt) : ""} onChange={(v) => inv.update(i, { amt: n(v) })} />
                  <Select value={r.account} onChange={(v) => inv.update(i, { account: v, label: companies.find((co) => co.key === v)?.label })} options={companies.map((co) => ({ value: co.key, label: co.label }))} className="col-span-2 sm:col-span-1" />
                  <div className="hidden sm:block"><RowRemove onClick={() => inv.remove(i)} /></div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Field label="Bill date"><Text type="date" value={r.billDate} onChange={(e) => inv.update(i, { billDate: e.target.value })} /></Field>
                  <Field label="Due date"><Text type="date" value={r.due} onChange={(e) => inv.update(i, { due: e.target.value })} /></Field>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-neutral-500">{invoiceStatus(r.due)}</span>
                  <button className="text-xs font-semibold text-rose-600 sm:hidden" onClick={() => inv.remove(i)}>Remove</button>
                </div>
              </div>
            ))}
          </Section>
        </>}
        message={
          <MessagePanel type="payment-reminder" customer={customer} inputs={{ customer: customer?.name || "", ...f, invoices: inv.rows, ...(extraCos.length ? { extra: xo } : {}) }}
            build={() => customer ? paymentReminder(settings, { date: f.date, dueDate: f.dueDate, eb: n(f.eb), ed: n(f.ed), cb: n(f.cb), cd: n(f.cd), invoices: inv.rows,
              others: extraCos.map((co) => ({ key: co.key, label: co.label, bal: n(xget(co.key).bal), days: n(xget(co.key).days) })) }) : NEED_CUSTOMER} />
        }
      />
    </div>
  );
}

/* ================= Balance Confirmation ================= */
export function BalanceConfirmation() {
  const { settings } = useStore();
  const tally = useTallyFill();
  const extraCos = useCompanies().filter((c) => c.key !== "business" && c.key !== "cash");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [note, setNote] = useState("");
  const [f, set, setF] = useForm({ month: todayISO().slice(0, 7), date: todayISO(), eb: "", cb: "" });
  const [xb, setXb] = useState<Record<string, string>>({});
  function pick(c: Customer | null) {
    setCustomer(c);
    const t = tally(c);
    setNote(t.note);
    if (t.business !== null || t.cash !== null) setF((x) => ({ ...x, eb: t.business === null ? "" : String(t.business), cb: t.cash === null ? "" : String(t.cash) }));
    setXb(Object.fromEntries(Object.entries(t.others).map(([k, v]) => [k, v === null ? "" : String(v)])));
  }
  return (
    <div>
      <PageHeader icon="notebook" eyebrow="Messages" title="Balance Confirmation" subtitle="Ask the customer to confirm their month closing balance in both accounts." />
      <TwoColumn
        form={
          <Card className="space-y-4">
            <Field label="Customer"><CustomerPicker value={customer} onPick={pick} /><BalanceNote note={note} />{customer && <TallyFreshness className="mt-2" customer={customer.name} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Month"><Text type="month" value={f.month} onChange={(e) => set("month")(e.target.value)} /></Field>
              <Field label="As on"><Text type="date" value={f.date} onChange={(e) => set("date")(e.target.value)} /></Field>
              <Field label={settings.businessName + " A/C"}><Money value={f.eb} onChange={set("eb")} /></Field>
              <Field label="Cash A/C"><Money value={f.cb} onChange={set("cb")} /></Field>
              {extraCos.map((co) => <Field key={co.key} label={co.label + " A/C"}><Money value={xb[co.key] || ""} onChange={(v) => setXb((x) => ({ ...x, [co.key]: v }))} /></Field>)}
            </div>
            <TotalLine strong label="Total outstanding" value={inr(n(f.eb) + n(f.cb) + extraCos.reduce((t, co) => t + n(xb[co.key]), 0))} />
          </Card>
        }
        message={
          <MessagePanel type="balance-confirmation" customer={customer} inputs={{ customer: customer?.name || "", ...f, ...(extraCos.length ? { extra: xb } : {}) }}
            build={() => customer ? balanceConfirmation(settings, { name: customer.name, month: f.month, date: f.date, eb: n(f.eb), cb: n(f.cb),
              others: extraCos.map((co) => ({ label: co.label, bal: n(xb[co.key]) })) }) : NEED_CUSTOMER} />
        }
      />
    </div>
  );
}

/* ================= Dispatch ================= */
export function Dispatch() {
  const { settings, transports } = useStore();
  const transportList = useTransportSuggestions();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [f, set] = useForm({ date: todayISO(), invoice: "", transport: "", boxes: "", items: "", freightTerms: "", freight: "" });
  return (
    <div>
      <PageHeader icon="rocket" eyebrow="Messages" title="Dispatch Confirmation" subtitle="Tell the customer their goods are on the way, with transport and charges." />
      <TwoColumn
        form={
          <Card className="space-y-4">
            <Field label="Customer"><CustomerPicker value={customer} onPick={setCustomer} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><Text type="date" value={f.date} onChange={(e) => set("date")(e.target.value)} /></Field>
              <Field label="Invoice No.(s)"><Text value={f.invoice} onChange={(e) => set("invoice")(e.target.value)} placeholder="e.g. 245, 246" /></Field>
            </div>
            <Field label="Transport"><SuggestInput value={f.transport} onChange={set("transport")} suggestions={transportList} placeholder="Pick or type a transport" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="No. of boxes"><Money value={f.boxes} onChange={set("boxes")} /></Field>
              <Field label="No. of items"><Text value={f.items} onChange={(e) => set("items")(e.target.value)} placeholder="e.g. 24" /></Field>
              <Field label="Transport charges"><Select value={f.freightTerms} onChange={set("freightTerms")} options={FREIGHT_TERMS} /></Field>
              <Field label="Amount (₹)"><Money value={f.freight} onChange={set("freight")} /></Field>
            </div>
          </Card>
        }
        message={
          <MessagePanel type="dispatch-confirmation" customer={customer} inputs={{ customer: customer?.name || "", ...f }}
            build={() => customer ? dispatchConfirmation(settings, transports, f) : NEED_CUSTOMER} />
        }
      />
    </div>
  );
}

/* ================= Stock Update ================= */
export function StockUpdate() {
  const { settings, products } = useStore();
  const productList = useProductSuggestions();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [search, setSearch] = useState("");
  const rows = useRows<{ name: string; price: string }>([]);
  function addProduct(name: string) {
    const p = products.find((x) => normalizeName(x.name) === normalizeName(name));
    rows.add({ name, price: p?.price !== undefined ? String(p.price) : "" });
    setSearch("");
  }
  const list = rows.rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), price: n(r.price) }));
  return (
    <div>
      <PageHeader icon="bag" eyebrow="Messages" title="Stock Update" subtitle="Let a customer know what's in stock, with prices." />
      <TwoColumn
        form={<>
          <Card><Field label="Customer"><CustomerPicker value={customer} onPick={setCustomer} /></Field></Card>
          <Section title="Products" action={<Button size="sm" variant="secondary" onClick={() => rows.add({ name: "", price: "" })}><IconPlus size={15} /> Blank row</Button>}>
            <SuggestInput value={search} onChange={setSearch} suggestions={productList} onPick={addProduct} placeholder="🔍 Search products to add…" />
            {rows.rows.map((r, i) => (
              <div key={i} className="flex gap-2">
                <Text className="flex-1" placeholder="Product name" value={r.name} onChange={(e) => rows.update(i, { name: e.target.value })} />
                <Money className="w-28" placeholder="Price (₹)" value={r.price} onChange={(v) => rows.update(i, { price: v })} />
                <RowRemove onClick={() => rows.remove(i)} />
              </div>
            ))}
            {rows.rows.length === 0 && <p className="text-sm text-neutral-400">Search above to add products from your Product list.</p>}
          </Section>
        </>}
        message={
          <MessagePanel type="stock-update" customer={customer} inputs={{ customer: customer?.name || "", products: list }}
            build={() => !customer ? NEED_CUSTOMER : list.length ? stockUpdate(settings, list) : "!Add at least one product with a name first."} />
        }
      />
    </div>
  );
}

/* ================= Stock Return ================= */
export function StockReturn() {
  const { settings } = useStore();
  const productList = useProductSuggestions();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [f, set] = useForm({ date: todayISO(), cn: "", invoice: "", reason: RETURN_REASONS[0], status: "credited", credit: "", notes: "" });
  const rows = useRows<{ name: string; qty: string; amount: string }>([{ name: "", qty: "", amount: "" }]);
  const items = rows.rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), qty: r.qty.trim(), amount: n(r.amount) }));
  const total = items.reduce((t, it) => t + it.amount, 0);
  return (
    <div>
      <PageHeader icon="back" eyebrow="Messages" title="Stock Return" subtitle="Acknowledge goods a customer sent back, and whether they are credited." />
      <TwoColumn
        form={<>
          <Card className="space-y-4">
            <Field label="Customer"><CustomerPicker value={customer} onPick={setCustomer} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><Text type="date" value={f.date} onChange={(e) => set("date")(e.target.value)} /></Field>
              <Field label="Reason"><Select value={f.reason} onChange={set("reason")} options={RETURN_REASONS} /></Field>
              <Field label="Credit Note No."><Text value={f.cn} onChange={(e) => set("cn")(e.target.value)} placeholder="Optional" /></Field>
              <Field label="Against Invoice No."><Text value={f.invoice} onChange={(e) => set("invoice")(e.target.value)} placeholder="Optional" /></Field>
              <Field label="Status"><Select value={f.status} onChange={set("status")} options={RETURN_STATUSES} /></Field>
              {f.status === "credited" && <Field label="Amount credited" hint="Empty = items total"><Money value={f.credit} onChange={set("credit")} placeholder={String(total || 0)} /></Field>}
            </div>
            <Field label="Notes"><Text value={f.notes} onChange={(e) => set("notes")(e.target.value)} placeholder="Optional" /></Field>
          </Card>
          <Section title="Returned items" action={<Button size="sm" variant="secondary" onClick={() => rows.add({ name: "", qty: "", amount: "" })}><IconPlus size={15} /> Item</Button>}>
            {rows.rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_6rem_7rem_auto]">
                <SuggestInput value={r.name} onChange={(v) => rows.update(i, { name: v })} suggestions={productList} placeholder="Product name" />
                <div className="sm:hidden"><RowRemove onClick={() => rows.remove(i)} /></div>
                <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-2">
                  <Text placeholder="Qty e.g. 2 pcs" value={r.qty} onChange={(e) => rows.update(i, { qty: e.target.value })} />
                  <Money placeholder="Value (₹)" value={r.amount} onChange={(v) => rows.update(i, { amount: v })} />
                </div>
                <div className="hidden sm:block"><RowRemove onClick={() => rows.remove(i)} /></div>
              </div>
            ))}
            <TotalLine strong label="Total return value" value={inr(total)} />
          </Section>
        </>}
        message={
          <MessagePanel type="stock-return" customer={customer} inputs={{ customer: customer?.name || "", ...f, items }}
            build={() => !customer ? NEED_CUSTOMER : items.length ? stockReturn(settings, { ...f, items }) : "!Add at least one returned item with a name first."} />
        }
      />
    </div>
  );
}

/* ================= Service Material ================= */
export function ServiceMaterial() {
  const { settings, transports } = useStore();
  const productList = useProductSuggestions();
  const transportList = useTransportSuggestions();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [f, set] = useForm({ date: todayISO(), transport: "", delivery: "", timeline: "", notes: "" });
  const blank = { product: "", qty: "", serial: "", issue: "", charges: "" };
  const rows = useRows([blank, blank]);
  const items = rows.rows
    .map((r) => ({ product: r.product.trim(), qty: r.qty.trim(), serial: r.serial.trim(), issue: r.issue.trim(), charges: n(r.charges) }))
    .filter((r) => r.product || r.serial || r.issue);
  return (
    <div>
      <PageHeader icon="gift" eyebrow="Messages" title="Service Material" subtitle="Send a dealer the details of service material on its way: serial numbers, issues and charges." />
      <TwoColumn
        form={<>
          <Card className="space-y-4">
            <Field label="Dealer"><CustomerPicker value={customer} onPick={setCustomer} placeholder="Search dealer…" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><Text type="date" value={f.date} onChange={(e) => set("date")(e.target.value)} /></Field>
              <Field label="Expected delivery"><Text type="date" value={f.delivery} onChange={(e) => set("delivery")(e.target.value)} /></Field>
            </div>
            <Field label="Transport"><SuggestInput value={f.transport} onChange={set("transport")} suggestions={transportList} placeholder="Pick or type a transport" /></Field>
            <Field label="Service timeline"><Text value={f.timeline} onChange={(e) => set("timeline")(e.target.value)} placeholder="e.g. 7–10 working days" /></Field>
            <Field label="Note"><Text value={f.notes} onChange={(e) => set("notes")(e.target.value)} placeholder="Optional" /></Field>
          </Card>
          <Section title="Items" action={<Button size="sm" variant="secondary" onClick={() => rows.add(blank)}><IconPlus size={15} /> Item</Button>}>
            {rows.rows.map((r, i) => (
              <div key={i} className="rounded-xl border border-neutral-100 bg-neutral-50/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-500">Item {i + 1}</span>
                  <button className="text-xs font-semibold text-rose-600" onClick={() => rows.remove(i)}>Remove</button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <SuggestInput className="col-span-2" value={r.product} onChange={(v) => rows.update(i, { product: v })} suggestions={productList} placeholder="Product name" />
                  <Money placeholder="Qty" value={r.qty} onChange={(v) => rows.update(i, { qty: v })} />
                  <Money placeholder="Charges ₹" value={r.charges} onChange={(v) => rows.update(i, { charges: v })} />
                  <Text className="col-span-2" placeholder="Serial No." value={r.serial} onChange={(e) => rows.update(i, { serial: e.target.value })} />
                  <Text className="col-span-2" placeholder="Issue description" value={r.issue} onChange={(e) => rows.update(i, { issue: e.target.value })} />
                </div>
              </div>
            ))}
            <TotalLine strong label="Total service charges" value={inr(items.reduce((t, it) => t + it.charges, 0))} />
          </Section>
        </>}
        message={
          <MessagePanel type="service-material" customer={customer} inputs={{ customer: customer?.name || "", ...f, items }}
            build={() => !customer ? NEED_CUSTOMER : items.length ? serviceMaterial(settings, transports, { name: customer.name, ...f, items }) : "!Add at least one service item first."} />
        }
      />
    </div>
  );
}
