// Sample data for local development only (?demo). Never part of the published build.
import type { User } from "firebase/auth";
import type { TallyVoucherSet, ActivityEntry, MessageEntry, BalanceSet, Customer, Order, Product, Receipt, ServiceJob, Transport } from "./data";

export const demoUser = { email: "demo@example.com", uid: "demo" } as unknown as User;

export const demoCustomers: Customer[] = [
  "AB Infinite", "Adeshivakeshva Rhythm House - Raichur", "Adil Mobile Center", "Amaresh - Gilesugur Camp", "Ashok Reddy - Mantralayam",
  "Badrinath Allundi - Raichur", "C Raghavendra", "Deepak", "K K Enterprise - Devadurga", "Kashi SLN", "Lokesh - Kallur",
  "Mallu Mobiles and Electronics - Pothnal", "Sri Durga Electronics - Manvi", "Vijay Radios - Lingasugur",
].map((name, i) => ({ id: "d" + i, name, mobile: i % 4 === 3 ? "" : "98" + String(45012345 + i * 7919).slice(0, 8) }));

export const demoProducts: Product[] = [
  ["Makwell - Stabilizer - Led Mini - 5 Yr.", "Makwell", 740], ["Makwell - Stabilizer - RF500VA - 5 Yr.", "Makwell", 890],
  ["Redpower - AC Stand - 2.8KG", "Redpower", 310], ["Redpower - Dual Arm Wallmount Tiltable - 26*55", "Redpower", 1450],
  ["Remote - AC", "Remote", 95], ["Remote - China - BPL Led - NVR", "Remote", 120], ["Haier - EI3V - C1 - White", "Haier", 2650],
  ["Impex - Mixer Grinder - 750 W", "Impex", 2150], ["CPPLUS - UNR - 108F (CP Plus NVR)", "CPPLUS", 0], ["Cable - Hdmi 3 mtrs 4k", "Cable", 180],
  ["Accessories - AAA Battery", "Accessories", 25], ["Goldmedal - Rapido Exhaust Fan - 225MM", "Goldmedal", 690],
].map(([name, category, price], i) => ({ id: "p" + i, name: String(name), category: String(category), price: Number(price) }));

export const demoTransports: Transport[] = [
  { id: "t1", name: "VRL Logistics", contactPerson: "Ramesh", phone: "9845012345", branch: "Raichur, Station Road" },
  { id: "t2", name: "Navata Road Transport", phone: "9123456780", branch: "Raichur" },
  { id: "t3", name: "Sri Durga Transport", phone: "9000011111", branch: "Manvi" },
];

const iso = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const no = (offset: number, k: number, pre = "") => { const [, m, d] = iso(offset).split("-"); return pre + d + "/" + m + "-" + String(k).padStart(2, "0"); };

export const demoOrders: Order[] = [
  { id: "o1", orderNo: no(0, 1), date: iso(0), customerId: "d0", customerName: "AB Infinite", mobile: "9845012345", status: "Pending", advance: 2000,
    items: [{ name: "Makwell - Stabilizer - Led Mini - 5 Yr.", qty: 4, rate: 740, amount: 2960 }, { name: "Remote - AC", qty: 10, rate: 95, amount: 950 }], total: 3910,
    transport: "VRL Logistics", transportPhone: "9845012345", freightTerms: "refund", freight: 350, notes: "Pack remotes separately" },
  { id: "o2", orderNo: no(0, 2), date: iso(0), customerId: "d4", customerName: "Ashok Reddy - Mantralayam", status: "Confirmed", advance: 0,
    items: [{ name: "Remote - AC", qty: 5, rate: 95, amount: 475 }, { name: "Impex - Mixer Grinder - 750 W", qty: 2, rate: 2150, amount: 4300, avail: 0 }], total: 4775, transport: "Navata Road Transport", freightTerms: "to-pay" },
  { id: "o3", orderNo: no(-3, 1), date: iso(-3), customerId: "d12", customerName: "Sri Durga Electronics - Manvi", status: "Delivered", advance: 0,
    items: [{ name: "Cable - Hdmi 3 mtrs 4k", qty: 20, rate: 180, amount: 3600 }], total: 3600 },
];

export const demoServices: ServiceJob[] = [
  { id: "s1", jobNo: no(-2, 1, "SV-"), receivedDate: iso(-2), customerId: "d2", customerName: "Adil Mobile Center", status: "Under Service", timeline: "7 days", inTransport: "VRL Logistics",
    items: [{ product: "Makwell - Stabilizer - RF500VA - 5 Yr.", qty: 1, serial: "MK55021", issue: "No output", action: "Replaced", replProduct: "Makwell - Stabilizer - RF500VA - 5 Yr.", replSerial: "MK60433", charges: 0 },
      { product: "Impex - Mixer Grinder - 750 W", qty: 1, serial: "IMX901", issue: "Motor noise", action: "Pending", charges: 250 }], totalCharges: 250 },
  { id: "s2", jobNo: no(-9, 1, "SV-"), receivedDate: iso(-9), customerId: "d13", customerName: "Vijay Radios - Lingasugur", status: "Sent Back", sentDate: iso(-1), outTransport: "Sri Durga Transport",
    items: [{ product: "Haier - EI3V - C1 - White", qty: 1, serial: "HR7781", issue: "Display dead", action: "Repaired", charges: 400 }], totalCharges: 400 },
];

export const demoReceipts: Receipt[] = [
  { id: "r1", date: iso(0), customerId: "d0", customerName: "AB Infinite", mode: "Advance", business: 2000, cash: 0, source: "Order advance", ref: no(0, 1) },
  { id: "r2", date: iso(-1), customerId: "d5", customerName: "Badrinath Allundi - Raichur", mode: "UPI", business: 15000, cash: 2500, source: "Payment Updated" },
  { id: "r3", date: iso(-1), customerId: "d9", customerName: "Kashi SLN", mode: "Cash", business: 0, cash: 4000, source: "Manual", note: "Paid at shop" },
  { id: "r7", date: iso(-2), customerId: "d1", customerName: "Kashi SLN", mode: "UPI", business: 1500, cash: 0, source: "Payment Updated", note: "GPay" },
  { id: "r6", date: iso(0), customerId: "d0", customerName: "AB Infinite", mode: "Cash", business: 2000, cash: 0, source: "Tally", ref: "45", tallyNo: "45" },
  { id: "r5", date: iso(-9), customerId: "d10", customerName: "Lokesh - Kallur", mode: "UPI", business: 0, cash: 3000, source: "Payment Updated", tallyNo: "11" },
  { id: "r4", date: iso(-4), customerId: "d7", customerName: "Deepak", mode: "Cheque", business: 8000, cash: 0, source: "Manual", cancelled: true, note: "Cheque bounced" },
];

export const demoBalances: Record<string, BalanceSet> = {
  business: { company: "business", label: "Chittam Enterprises - 2026", importedAt: new Date(Date.now() - 3600e3).toISOString(), balances: { "ab infinite": 48250, "kashi sln": 12900, "deepak": 0 }, names: { "ab infinite": "AB Infinite", "kashi sln": "Kashi SLN", "deepak": "Deepak" } },
  cash: { company: "cash", label: "Cash", importedAt: new Date(Date.now() - 3600e3).toISOString(), balances: { "ab infinite": 6400, "kashi sln": 1500 } },
  // the Windows app's check: a customer filed under Sundry Creditors in Tally
  status: { checkedAt: new Date(Date.now() - 600e3).toISOString(), ok: true, misfiled: [{ company: "business", label: "Chittam Enterprises - 2026", name: "Adil Mobile Center", group: "Sundry Creditors", a: 18400, dr: true }] } as unknown as BalanceSet,
};

const ts = (minsAgo: number) => ({ toDate: () => new Date(Date.now() - minsAgo * 60000) }) as unknown as ActivityEntry["at"];
export const demoMessages: MessageEntry[] = [
  { id: "m3", type: "dispatch-confirmation", customerName: "Kashi SLN", at: ts(60 * 24 * 3), by: "demo@example.com", text: "🚚 *Dispatch & Delivery Confirmation*…", inputs: { date: iso(-3), invoice: "CE/245" } },
  { id: "m4", type: "dispatch-confirmation", customerName: "Lokesh - Kallur", at: ts(60 * 24), by: "demo@example.com", text: "🚚 *Dispatch & Delivery Confirmation*…", inputs: { date: iso(-1), invoice: "999" } },
  { id: "m5", type: "stock-return", customerName: "AB Infinite", at: ts(60 * 24 * 2), by: "demo@example.com", text: "↩️ *Stock Return Acknowledgement*…", inputs: { date: iso(-2), cn: "CN-9", status: "credited" } },
  { id: "m1", type: "payment-updated", customerName: "Badrinath Allundi - Raichur", mobile: "9845020264", at: ts(50), by: "demo@example.com",
    text: "✅ *Payment Received – Chittam Enterprises*\n\nDear Badrinath Allundi - Raichur,\n\nWe have received your payment of ₹17,500 via UPI on 18 Nov 2026…" },
  { id: "m2", type: "order-confirmation", customerName: "AB Infinite", mobile: "9845012345", at: ts(180), by: "demo@example.com", text: "🧾 *Order Confirmation*\n\nNamaste Anna/Sir 🙏…" },
];
export const demoActivity: ActivityEntry[] = [
  { id: "a1", collection: "orders", action: "update", name: "19/11-01 — AB Infinite", at: ts(20), by: "demo@example.com",
    before: { status: "Pending", items: [{ name: "Remote - AC", qty: 8 }] }, after: { status: "Confirmed", items: [{ name: "Remote - AC", qty: 10 }] } },
  { id: "a2", collection: "app", action: "whatsapp-opened", name: "AB Infinite", details: { type: "order-confirmation", mobile: "9845012345" }, at: ts(25), by: "demo@example.com" },
  { id: "a3", collection: "customers", action: "create", name: "Kashi SLN", after: { name: "Kashi SLN" }, at: ts(300), by: "demo@example.com" },
  { id: "a4", collection: "app", action: "balances-synced", name: "Chittam Enterprises - 2026", details: { company: "Chittam Enterprises - 2026", names: 412 }, at: ts(60), by: "demo@example.com" },
];

// Tally transactions: matches demoReceipts r1 (AB Infinite advance) and r2 (Badrinath), plus
// one Tally-only receipt, a name that differs, and a duplicate sale
export const demoTallyVouchers: Record<string, TallyVoucherSet> = {
  business: { company: "business", label: "Chittam Enterprises", tallyCompany: "Chittam Enterprises - 2026", from: iso(-90), to: iso(0), syncedAt: new Date(Date.now() - 1800e3).toISOString(), count: 6, vouchers: [
    { d: iso(0), t: "Receipt", n: "45", p: "AB Infinite", a: 2000, dr: false, nar: "Advance against order", via: "Axis Bank", id: "v1" },
    { d: iso(-1), t: "Receipt", n: "44", p: "Badrinath Allundi Raichur", a: 15000, dr: false, nar: "UPI", via: "Axis Bank", id: "v2" },
    { d: iso(-2), t: "Receipt", n: "43", p: "Mallu Mobiles and Electronics - Pothnal", a: 9000, dr: false, nar: "Cheque 004512", via: "Indian Bank", id: "v3" },
    { d: iso(-3), t: "Sales", n: "CE/245", p: "Kashi SLN", a: 12900, dr: true, id: "v4" },
    { d: iso(-2), t: "Sales", n: "CE/247", p: "Kashi SLN", a: 12900, dr: true, id: "v5" },
    { d: iso(-6), t: "Sales", n: "CE/240", p: "Deepak", a: 4300, dr: true, id: "v6" },
  ] },
  cash: { company: "cash", label: "Cash Bill", tallyCompany: "Cash", from: iso(-90), to: iso(0), syncedAt: new Date(Date.now() - 1800e3).toISOString(), count: 2, vouchers: [
    { d: iso(-1), t: "Receipt", n: "12", p: "Badrinath Allundi - Raichur", a: 2500, dr: false, via: "Cash", id: "c1" },
    { d: iso(-3), t: "Receipt", n: "11", p: "Lokesh - Kallur", a: 3000, dr: false, via: "Cash", id: "c0" },
    { d: iso(-1), t: "Receipt", n: "13", p: "Kashi SLN", a: 4000, dr: false, via: "Cash", id: "c2" },
  ] },
};

// Tally stock (both companies) and open invoices
const synced = new Date(Date.now() - 900e3).toISOString();
export const demoTallyStock = {
  business: { company: "business", label: "Chittam Enterprises", syncedAt: synced, items: {
    "remote - ac": { n: "Remote - AC", q: 40, u: "Pcs" },
    "impex - mixer grinder - 750 w": { n: "Impex - Mixer Grinder - 750 W", q: 1, u: "Pcs" },
    "makwell - stabilizer - led mini - 5 yr.": { n: "Makwell - Stabilizer - Led Mini - 5 Yr.", q: 6, u: "Pcs" },
    "cable - hdmi 3 mtrs 4k": { n: "Cable - Hdmi 3 mtrs 4k", q: 0, u: "Pcs" },
  } },
  cash: { company: "cash", label: "Cash Bill", syncedAt: synced, items: {
    "remote - ac": { n: "Remote - AC", q: -5, u: "Pcs" },
    "makwell - stabilizer - led mini - 5 yr.": { n: "Makwell - Stabilizer - Led Mini - 5 Yr.", q: -2, u: "Pcs" },
  } },
};
export const demoTallyBills = {
  business: { company: "business", label: "Chittam Enterprises", syncedAt: synced, asOn: iso(0), bills: [
    { p: "Kashi SLN", n: "2026-27/MKWL/12", d: iso(-52), due: iso(-37), a: 8400, od: 37 },
    { p: "Kashi SLN", n: "2026-27/HR/31", d: iso(-12), due: iso(3), a: 4500, od: 0 },
    { p: "AB Infinite", n: "2026-27/MKWL/40", d: iso(-20), due: iso(-5), a: 48250, od: 5 },
  ] },
  cash: { company: "cash", label: "Cash Bill", syncedAt: synced, asOn: iso(0), bills: [
    { p: "Kashi SLN", n: "C/88", d: iso(-18), due: iso(-18), a: 1500, od: 18 },
  ] },
};
