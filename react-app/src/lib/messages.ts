// The WhatsApp message texts — word for word the same as the current app,
// so customers get the same messages from either app.
import type { Order, ServiceJob, Settings, Transport } from "./data";
import { normalizeName } from "./data";
import { inr, todayISO } from "./format";

export function msgDate(iso: string | undefined) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
export function msgMonth(v: string | undefined) {
  if (!v) return "";
  const [y, m] = v.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}
const biz = (s: Settings) => s.businessName || "Chittam Enterprises";
const signOffComma = (s: Settings) => s.businessName + (s.address ? ", " + s.address : "") + ",";
const signOffPlain = (s: Settings) => s.businessName + (s.address ? ", " + s.address : "");
const num = (v: unknown) => Number(v) || 0;

/* ---------------- transport + freight ---------------- */
export const FREIGHT_TERMS = [
  { value: "", label: "Not set" },
  { value: "to-pay", label: "To Pay (customer pays transporter)" },
  { value: "paid", label: "Paid (nothing to pay on delivery)" },
  { value: "refund", label: "Paid by us — customer refunds" },
];
export function findTransport(list: Transport[], name: string) {
  const k = normalizeName(name);
  return k ? list.find((t) => normalizeName(t.name) === k) : undefined;
}
export function transportLine(list: Transport[], name?: string, phone?: string) {
  const n = (name || "").trim();
  if (!n) return "";
  const p = (phone || findTransport(list, n)?.phone || "").trim();
  return n + (p ? " · 📞 " + p : "");
}
export function freightRefund(terms?: string, amount?: unknown) { return terms === "refund" ? num(amount) : 0; }
export function freightLine(s: Settings, terms?: string, amount?: unknown) {
  const b = biz(s);
  const a = num(amount);
  if (terms === "to-pay") return "🚚 Transport Charges: *To Pay*" + (a ? " " + inr(a) : "") + "\n   Please pay the transporter at the time of delivery.";
  if (terms === "paid") return "🚚 Transport Charges: *Paid*" + (a ? " (" + inr(a) + ")" : "") + " — nothing to pay on delivery.";
  if (terms === "refund") return "🚚 Transport Charges: " + (a ? inr(a) + " " : "") + "*paid by " + b + "*" +
    "\n   Kindly refund " + (a ? "this amount" : "the transport charges") + " to " + b + " along with your payment.";
  return "";
}

/* ---------------- Payment Updated ---------------- */
// extra: companies beyond Chittam Enterprises and Cash (only those with a balance or amount are shown)
export interface ExtraLedger { label: string; prev: number; amt: number }
export interface PaymentUpdatedIn { name: string; mode: string; date: string; eprev: number; eamt: number; cprev: number; camt: number; receivedBy?: string; txnRef?: string; extra?: ExtraLedger[] }
// cash: who received it; other modes: the transaction / cheque reference
export const payRefLabel = (mode: string) => (/cheque/i.test(mode) ? "Cheque no." : /upi|gpay|phone\s*pe|paytm/i.test(mode) ? "UTR / Transaction ID" : "Transaction ID / UTR");
export const isCashMode = (mode: string) => /cash/i.test(mode || "");
export function paymentUpdated(s: Settings, i: PaymentUpdatedIn) {
  const name = s.businessName;
  const efinal = i.eprev - i.eamt, cfinal = i.cprev - i.camt;
  const extra = (i.extra || []).filter((x) => x.amt > 0 || x.prev);
  const xamt = extra.reduce((t, x) => t + x.amt, 0), xfinal = extra.reduce((t, x) => t + x.prev - x.amt, 0);
  let creditLine: string;
  const paid = [...(i.eamt > 0 ? [[name, i.eamt] as const] : []), ...(i.camt > 0 ? [["Cash", i.camt] as const] : []), ...extra.filter((x) => x.amt > 0).map((x) => [x.label, x.amt] as const)];
  if (paid.length > 2 || (paid.length === 2 && xamt > 0))
    creditLine = "split between your " + paid.map(([l, a]) => "*" + l + "* account (" + inr(a) + ")").join(", ").replace(/, ([^,]*)$/, " and $1");
  else if (i.eamt > 0 && i.camt > 0) creditLine = "split between your *" + name + "* account (" + inr(i.eamt) + ") and *Cash* account (" + inr(i.camt) + ")";
  else if (i.camt > 0) creditLine = "credited to your *Cash* account";
  else if (paid.length === 1 && xamt > 0) creditLine = "credited to your *" + paid[0][0] + "* account";
  else creditLine = "credited to your *" + name + "* account";
  const ledger = (label: string, prev: number, amt: number, fin: number) => amt > 0
    ? "📊 *" + label + " Ledger*\nPrevious Balance: " + inr(prev) + "\nAmount Received: " + inr(amt) + "\n*Final Balance: " + inr(fin) + "*\n\n"
    : "📊 *" + label + " Ledger*\n*Balance: " + inr(fin) + "*\n\n";
  return "✅ *Payment Received – " + name + "*\n\n" +
    "Dear " + i.name + ",\n\n" +
    "We have received your payment of " + inr(i.eamt + i.camt + xamt) + " via " + (i.mode || "—") +
    (isCashMode(i.mode) ? (i.receivedBy?.trim() ? " (received by " + i.receivedBy.trim() + ")" : "") : (i.txnRef?.trim() ? " (" + (/cheque/i.test(i.mode) ? "Cheque No. " : "Ref: ") + i.txnRef.trim() + ")" : "")) +
    " on " + msgDate(i.date) + ", " + creditLine + ". Thank you.\n\n" +
    ledger(name, i.eprev, i.eamt, efinal) + ledger("Cash", i.cprev, i.camt, cfinal) +
    extra.map((x) => ledger(x.label, x.prev, x.amt, x.prev - x.amt)).join("") +
    "*Total Outstanding: " + inr(efinal + cfinal + xfinal) + "*\n\n" +
    "Regards,\n" + name + (s.address ? "\n" + s.address : "");
}

/* ---------------- Balance Confirmation ---------------- */
export function balanceConfirmation(s: Settings, i: { name: string; month: string; date: string; eb: number; cb: number; others?: { label: string; bal: number }[] }) {
  const others = (i.others || []).filter((o) => o.bal);
  return "📋 *Balance Confirmation – " + s.businessName + "*\n\n" +
    "Dear " + i.name + ",\n\n" +
    "As per our records, your month closing balance for *" + msgMonth(i.month) + "* (as on " + msgDate(i.date) + ") is:\n\n" +
    s.businessName + " A/C: " + inr(i.eb) + "\n" +
    "Cash A/C: " + inr(i.cb) + "\n" +
    others.map((o) => o.label + " A/C: " + inr(o.bal) + "\n").join("") +
    "*Total Outstanding: " + inr(i.eb + i.cb + others.reduce((t, o) => t + o.bal, 0)) + "*\n\n" +
    "Kindly confirm if this matches your records. Please let us know of any discrepancy.\n\n" +
    "Regards,\n" + s.businessName;
}

/* ---------------- Payment Reminder ---------------- */
// account: "business", "cash", or another company's key (label = its name)
export interface Invoice { no: string; billDate: string; due: string; amt: number; account: string; label?: string }
export function pendingDaysLabel(days: number) {
  days = num(days);
  let label = days + " Day" + (days === 1 ? "" : "s");
  const years = Math.floor(days / 365);
  if (years >= 1) label += " (" + years + " Year" + (years > 1 ? "s" : "") + ")";
  if (days > 30) label += " 🔴";
  return label;
}
const dayDiff = (iso: string) => Math.round((new Date(iso + "T00:00:00").getTime() - new Date(todayISO() + "T00:00:00").getTime()) / 86400000);
export function invoiceStatus(dueIso: string) {
  if (!dueIso) return "";
  const d = dayDiff(dueIso);
  if (d < -30) return "🔴 Severely Overdue by " + Math.abs(d) + " days";
  if (d < 0) return "⚠️ Overdue by " + Math.abs(d) + " day" + (Math.abs(d) === 1 ? "" : "s");
  if (d === 0) return "📌 Due today";
  return "🕒 Due in " + d + " day" + (d === 1 ? "" : "s");
}
function worstOverdueDays(invoices: Invoice[]) {
  return invoices.reduce((w, inv) => (inv.due ? Math.max(w, -dayDiff(inv.due)) : w), 0);
}
const onlyDefaultOrAll = <T extends { isDefault?: boolean }>(list: T[]) => { const d = list.filter((x) => x.isDefault); return d.length ? d : list; };

export function paymentReminder(s: Settings, i: { date: string; dueDate: string; eb: number; ed: number; cb: number; cd: number; invoices: Invoice[]; others?: { key: string; label: string; bal: number; days: number }[] }) {
  const invoices = i.invoices.filter((v) => v.no || v.due || v.amt || v.billDate);
  const others = (i.others || []).filter((o) => o.bal);
  let invoiceBlock = "";
  if (invoices.length) {
    const extraKeys = [...new Set(invoices.map((v) => v.account).filter((k) => k !== "business" && k !== "cash"))];
    const groups = [
      { label: "🏢 *" + s.businessName + "*", items: invoices.filter((v) => v.account === "business" || !v.account) },
      { label: "💵 *Cash*", items: invoices.filter((v) => v.account === "cash") },
      ...extraKeys.map((k) => ({ label: "🏬 *" + (invoices.find((v) => v.account === k)?.label || others.find((o) => o.key === k)?.label || k) + "*", items: invoices.filter((v) => v.account === k) })),
    ];
    invoiceBlock = "🧾 *Invoice-wise Due Dates*\n";
    groups.forEach((g) => {
      if (!g.items.length) return;
      invoiceBlock += g.label + "\n";
      g.items.forEach((v) => {
        const parts: string[] = [];
        if (v.amt) parts.push(inr(v.amt));
        if (v.billDate) parts.push("Bill " + msgDate(v.billDate));
        if (v.due) parts.push("Due " + msgDate(v.due) + " (" + invoiceStatus(v.due) + ")");
        invoiceBlock += "• " + (v.no || "Invoice") + (parts.length ? " — " + parts.join(" — ") : "") + "\n";
      });
    });
    invoiceBlock += "\n";
  }
  const due = msgDate(i.dueDate);
  let clearLine = due ? "Kindly clear the payment by *" + due + "*." : "Kindly clear the payment at the earliest.";
  const worst = worstOverdueDays(invoices);
  let urgencyBlock = "";
  if (worst >= 30) {
    urgencyBlock = "🚨 *URGENT — Immediate Action Required*\n" +
      "Your account has invoices that are *" + worst + " days overdue*. " +
      "This is seriously affecting our business operations. " +
      "Failure to clear the dues immediately may result in *suspension of supply*.\n\n" +
      "We request you to make full payment *today* or contact us immediately to discuss a resolution.\n\n";
    clearLine = "⛔ *Please clear all outstanding dues immediately.*";
  } else if (worst > 0) {
    clearLine = "Kindly clear the overdue amount at the earliest to avoid disruption in supply.";
  }
  let msg = "💳 *Payment Reminder*\n" +
    "*Namaste Anna/Sir* 🙏\n" +
    "As per our records, the following amount is pending as on *" + msgDate(i.date) + "*.\n\n" +
    "🏢 *" + s.businessName + "*\n" +
    "💰 *Outstanding:* *" + inr(i.eb) + "*\n" +
    "📅 *Pending:* *" + pendingDaysLabel(i.ed) + "*\n\n" +
    "💵 *Cash*\n" +
    "💰 *Outstanding:* *" + inr(i.cb) + "*\n" +
    "📅 *Pending:* *" + pendingDaysLabel(i.cd) + "*\n\n" +
    others.map((o) => "🏬 *" + o.label + "*\n💰 *Outstanding:* *" + inr(o.bal) + "*\n📅 *Pending:* *" + pendingDaysLabel(o.days) + "*\n\n").join("") +
    "🔹 *Total Outstanding:* " + inr(i.eb + i.cb + others.reduce((t, o) => t + o.bal, 0)) + "\n\n" +
    invoiceBlock + urgencyBlock +
    clearLine + (worst >= 30 ? "\n\n" : " We are currently placing orders for the upcoming season, and your timely payment will help us ensure uninterrupted supply and better service.\n\n");
  if (s.upiList?.length) {
    msg += "📲 *UPI (GPay/PhonePe):*\n" + onlyDefaultOrAll(s.upiList).map((u) => u.upiId + (u.payeeName ? " – " + u.payeeName : "")).join("\n") + "\n\n";
  }
  if (s.bankList?.length) {
    const banks = onlyDefaultOrAll(s.bankList);
    banks.forEach((b, n) => {
      msg += "🏦 *Bank Account Details" + (banks.length > 1 ? " " + (n + 1) : "") + "*\n" + s.businessName + (b.label ? " (" + b.label + ")" : "") + "\n" +
        (b.accountNo ? "A/C No.: " + b.accountNo + " (Current A/C)\n" : "") +
        (b.ifsc ? "IFSC: " + b.ifsc + "\n" : "") +
        (b.bankBranch ? b.bankBranch + "\n" : "") + "\n";
    });
  }
  return msg + "Thank you for your continued support. 🙏\n" + s.businessName;
}

/* ---------------- Dispatch ---------------- */
export function dispatchConfirmation(s: Settings, transports: Transport[], i: { date: string; invoice: string; transport: string; boxes: string; items: string; freightTerms: string; freight: string }) {
  const freight = freightLine(s, i.freightTerms, i.freight);
  return "🚚 *Dispatch & Delivery Confirmation*\n\n" +
    "Namaste Anna/Sir 🙏\n" +
    "Your order has been dispatched successfully.\n\n" +
    "📅 Date: " + msgDate(i.date) + "\n" +
    "🧾 Invoice No.(s): " + (i.invoice.trim() || "—") + "\n" +
    "🚛 Transport: " + (transportLine(transports, i.transport) || "—") + "\n" +
    "📦 No. of Boxes: " + (i.boxes || "0") + "\n" +
    "📦 No. of Items: " + (i.items.trim() || "—") + "\n" +
    (freight ? freight + "\n" : "") + "\n" +
    "Once the shipment reaches you, kindly confirm:\n" +
    "✅ Stock Received\n" +
    "✅ Quantity Verified\n" +
    "✅ Goods Received in Good Condition\n\n" +
    "If you notice any shortage, damage, or other issue, please inform us immediately so we can assist you.\n\n" +
    "Thank you for your business and continued support. 🙏\n" +
    signOffComma(s);
}

/* ---------------- Stock Update ---------------- */
export function stockUpdate(s: Settings, products: { name: string; price: number }[]) {
  const so = signOffPlain(s);
  return "📦 *Stock Availability Update*\n" +
    "Namaste Anna/Sir 🙏\n" +
    "The following products are now available at " + so + ".\n\n" +
    products.map((p) => "• " + p.name + " - " + inr(p.price)).join("\n") + "\n\n" +
    "For bookings or enquiries, please contact us.\n\n" +
    "Thank you for your continued support. 🙏\n" + so;
}

/* ---------------- Stock Return ---------------- */
export const RETURN_REASONS = ["Damaged in transit", "Manufacturing defect", "Wrong item supplied", "Excess quantity", "Unsold stock", "Other"];
export const RETURN_STATUSES = [
  { value: "credited", label: "Credited to account" },
  { value: "inspection", label: "Under inspection" },
  { value: "replacement", label: "Replacement to be sent" },
];
export function stockReturn(s: Settings, i: { date: string; cn: string; invoice: string; reason: string; status: string; notes: string; credit: string; items: { name: string; qty: string; amount: number }[] }) {
  const total = i.items.reduce((t, it) => t + it.amount, 0);
  const credit = num(i.credit) || total;
  const cn = i.cn.trim(), invoice = i.invoice.trim(), notes = i.notes.trim();
  const lines = i.items.map((it) => "• " + it.name + (it.qty ? " × " + it.qty : "") + (it.amount ? " - " + inr(it.amount) : "")).join("\n");
  const statusLine = ({
    credited: "✅ The amount of " + inr(credit) + " has been credited to your account" + (cn ? " vide Credit Note No. " + cn : "") + ".",
    inspection: "🔍 The returned goods are under inspection. We will update you once the credit is processed.",
    replacement: "🔁 A replacement will be dispatched to you shortly.",
  } as Record<string, string>)[i.status];
  return "↩️ *Stock Return Acknowledgement*\n\n" +
    "Namaste Anna/Sir 🙏\n" +
    "We have received the following returned goods from you.\n\n" +
    "📅 Date: " + msgDate(i.date) + "\n" +
    (cn ? "🧾 Credit Note No.: " + cn + "\n" : "") +
    (invoice ? "📄 Against Invoice No.: " + invoice + "\n" : "") +
    "📝 Reason: " + i.reason + "\n\n" +
    "*Returned Items:*\n" + lines + "\n" +
    (total ? "\n💰 *Total Return Value: " + inr(total) + "*\n" : "") +
    "\n" + statusLine + "\n" +
    (notes ? "\n📌 " + notes + "\n" : "") +
    "\nIf any detail above does not match your records, please let us know.\n\n" +
    "Thank you for your continued support. 🙏\n" +
    signOffComma(s);
}

/* ---------------- Service Material ---------------- */
export interface SMItem { product: string; qty: string; serial: string; issue: string; charges: number }
export function serviceMaterial(s: Settings, transports: Transport[], i: { name: string; date: string; transport: string; delivery: string; timeline: string; notes: string; items: SMItem[] }) {
  const delivery = msgDate(i.delivery), timeline = i.timeline.trim(), notes = i.notes.trim();
  let msg = "🔧 *Service Material Dispatch*\n" +
    "Namaste Anna/Sir 🙏\n\n" +
    // the current app shows "&" in a name as "&amp;" here; the plain name is right
    "We are sending the following service material to *" + i.name + "*.\n\n" +
    "📅 *Date:* " + msgDate(i.date) + "\n" +
    "🚛 *Transport:* " + (transportLine(transports, i.transport) || "—") + "\n" +
    (delivery ? "📦 *Expected Delivery:* " + delivery + "\n" : "") +
    (timeline ? "⏱ *Service Timeline:* " + timeline + "\n" : "") +
    "\n📋 *Item Details*\n";
  let totalCharges = 0;
  i.items.forEach((it, n) => {
    totalCharges += it.charges;
    msg += "\n*Item " + (n + 1) + ":*\n";
    if (it.product) msg += "🛠 Product: " + it.product + "\n";
    if (it.qty) msg += "📦 Qty: " + it.qty + "\n";
    if (it.serial) msg += "🔢 Serial No.: " + it.serial + "\n";
    if (it.issue) msg += "⚠️ Issue: " + it.issue + "\n";
    if (it.charges) msg += "💰 Charges: " + inr(it.charges) + "\n";
  });
  if (totalCharges > 0) msg += "\n💳 *Total Service Charges: " + inr(totalCharges) + "*\n";
  if (notes) msg += "\n📝 *Note:* " + notes + "\n";
  return msg + "\nOnce the material is received, kindly confirm:\n" +
    "✅ Material Received\n" +
    "✅ Quantity Verified\n" +
    "✅ Serial Numbers Matched\n\n" +
    "If you notice any shortage or discrepancy, please inform us immediately.\n\n" +
    "Thank you for your continued support. 🙏\n" +
    signOffPlain(s);
}

/* ---------------- Order Confirmation ---------------- */
export function orderConfirmation(s: Settings, transports: Transport[], o: Omit<Order, "id">) {
  const lines = o.items.map((it) => "• " + it.name + (it.qty ? " × " + it.qty : "") + (it.rate ? " @ " + inr(it.rate) : "") + (it.amount ? " = " + inr(it.amount) : "")).join("\n");
  const refund = freightRefund(o.freightTerms, o.freight);
  const balance = Math.max(0, o.total + refund - o.advance);
  const freight = freightLine(s, o.freightTerms, o.freight);
  return "🧾 *Order Confirmation*\n\n" +
    "Namaste Anna/Sir 🙏\n" +
    "Thank you for your order. Here are the details:\n\n" +
    "🧾 Order No.: " + o.orderNo + "\n" +
    "📅 Order Date: " + msgDate(o.date) + "\n" +
    (o.deliveryDate ? "🚚 Expected Delivery: " + msgDate(o.deliveryDate) + "\n" : "") +
    (o.transport ? "🚛 Transport: " + transportLine(transports, o.transport, o.transportPhone) + "\n" : "") +
    (freight ? freight + "\n" : "") +
    "📌 Status: " + o.status + "\n\n" +
    "*Items:*\n" + lines + "\n" +
    (orderPending(o).length ? "\n⏳ *Pending — will be sent when stock arrives:*\n" + orderPending(o).map((it) => "• " + it.name + " × " + pendingQty(it)).join("\n") + "\n" : "") +
    "\n💰 *Order Total: " + inr(o.total) + "*\n" +
    (refund ? "🚚 Transport Charges to Refund: " + inr(refund) + "\n" : "") +
    (o.advance ? "✅ Advance Received: " + inr(o.advance) + "\n" : "") +
    (o.advance || refund ? "🔖 *Balance Payable: " + inr(balance) + "*" + (refund ? " (incl. transport charges)" : "") + "\n" : "") +
    (o.notes ? "\n📝 " + o.notes + "\n" : "") +
    "\nPlease check the items and quantities, and let us know if anything needs to change.\n\n" +
    "Thank you for your business. 🙏\n" +
    signOffComma(s);
}

/* ---------------- Service Job (received / returned) ---------------- */
export function serviceJobMessage(s: Settings, transports: Transport[], j: Omit<ServiceJob, "id">, type: "received" | "returned") {
  const so = signOffComma(s);
  if (type === "received") {
    const lines = j.items.map((it, n) => (n + 1) + ". " + it.product + (it.qty > 1 ? " × " + it.qty : "") +
      (it.serial ? "\n   S/N: " + it.serial : "") + (it.issue ? "\n   Issue: " + it.issue : "")).join("\n");
    return "📥 *Service Material Received*\n\n" +
      "Namaste Anna/Sir 🙏\n" +
      "We have received the following products from you for service.\n\n" +
      "🧾 Service Job No.: " + j.jobNo + "\n" +
      "📅 Received On: " + msgDate(j.receivedDate) + "\n" +
      (j.inTransport ? "🚛 Received Via: " + transportLine(transports, j.inTransport) + "\n" : "") +
      "\n*Products:*\n" + lines + "\n\n" +
      (j.timeline ? "⏳ Expected service time: " + j.timeline + "\n\n" : "") +
      "We will update you once the service is completed. Please quote the Job No. for any follow-up.\n\n" +
      "Thank you for your support. 🙏\n" + so;
  }
  const out = j.items.map((it, n) => {
    let line = (n + 1) + ". " + it.product + (it.qty > 1 ? " × " + it.qty : "") + (it.serial ? " (S/N: " + it.serial + ")" : "");
    if (it.action === "Replaced") line += "\n   🔁 Replaced with: " + it.replProduct + (it.replSerial ? "\n   New S/N: " + it.replSerial : "");
    else if (it.action === "Repaired") line += "\n   ✅ Repaired";
    else if (it.action === "Not Repairable") line += "\n   ⚠️ Not repairable — returned";
    else if (it.action === "Returned As Is") line += "\n   ↩️ Returned as is";
    else line += "\n   ⏳ Still under service";
    if (it.charges) line += "\n   💰 Charges: " + inr(it.charges);
    return line;
  }).join("\n");
  return "📤 *Service Completed & Dispatched*\n\n" +
    "Namaste Anna/Sir 🙏\n" +
    "The products you sent for service have been attended to and sent back.\n\n" +
    "🧾 Service Job No.: " + j.jobNo + "\n" +
    "📅 Received On: " + msgDate(j.receivedDate) + "\n" +
    (j.sentDate ? "📦 Sent Back On: " + msgDate(j.sentDate) + "\n" : "") +
    (j.outTransport ? "🚛 Transport: " + transportLine(transports, j.outTransport) + "\n" : "") +
    "\n*Products:*\n" + out + "\n" +
    (j.totalCharges ? "\n💰 *Total Service Charges: " + inr(j.totalCharges) + "*\n" : "") +
    (j.notes ? "\n📝 " + j.notes + "\n" : "") +
    "\nKindly confirm once received and check that everything is in order.\n\n" +
    "Thank you for your support. 🙏\n" + so;
}

/* ---------------- stock: pack now / pending ---------------- */
export const packQty = (it: { qty: number; avail?: number }) => Math.max(0, Math.min(num(it.qty), it.avail === undefined || it.avail === null ? num(it.qty) : num(it.avail)));
export const pendingQty = (it: { qty: number; avail?: number }) => Math.max(0, num(it.qty) - packQty(it));
export const orderPending = <T extends { qty: number; avail?: number }>(o: { items?: T[] }): T[] => (o.items || []).filter((it) => pendingQty(it) > 0);

/* ---------------- Pick list (only what can be packed now) ---------------- */
export function buildPickList(orders: Order[]) {
  const byName: Record<string, { name: string; qty: number; orders: string[] }> = {};
  orders.forEach((o) => (o.items || []).forEach((it) => {
    const k = normalizeName(it.name);
    if (!byName[k]) byName[k] = { name: it.name, qty: 0, orders: [] };
    const q = packQty(it);
    if (!q) return;
    byName[k].qty += q;
    if (!byName[k].orders.includes(o.orderNo)) byName[k].orders.push(o.orderNo);
  }));
  Object.keys(byName).forEach((k) => { if (!byName[k].qty) delete byName[k]; });
  const products = Object.values(byName).sort((a, b) => a.name.localeCompare(b.name));
  return { products, totalQty: products.reduce((t, p) => t + p.qty, 0) };
}
export function pickListText(title: string, orders: Order[]) {
  if (!orders.length) return "";
  const { products, totalQty } = buildPickList(orders);
  const lines = ["📋 *" + title + "*",
    orders.length === 1
      ? "Order " + orders[0].orderNo + " · " + orders[0].customerName + (orders[0].transport ? " · 🚛 " + orders[0].transport : "")
      : "Orders: " + orders.map((o) => o.orderNo).join(", ") + " (" + orders.length + ")",
    "", "*Items to pick:*"];
  products.forEach((p) => lines.push("☐ " + p.name + " — *" + p.qty + "*"));
  lines.push("", "Total: " + totalQty + " pcs");
  const pend = orders.flatMap((o) => orderPending(o).map((it) => it.name + " × " + pendingQty(it) + (orders.length > 1 ? " (" + o.orderNo + ")" : "")));
  if (pend.length) lines.push("", "⏳ *Pending — no stock, not packed:*", ...pend.map((x) => "• " + x));
  if (orders.length > 1) {
    lines.push("", "*By order:*");
    orders.forEach((o) => {
      lines.push(o.orderNo + " · " + o.customerName + (o.transport ? " · 🚛 " + o.transport : ""));
      (o.items || []).filter((it) => packQty(it) > 0).forEach((it) => lines.push("   ☐ " + it.name + " × " + packQty(it)));
    });
  } else if (orders[0].notes) {
    lines.push("", "📝 " + orders[0].notes);
  }
  return lines.join("\n");
}

export function waNumber(mobile?: string) {
  const d = (mobile || "").replace(/\D/g, "");
  if (d.length === 10) return "91" + d;
  return d;
}
