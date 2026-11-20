// PDFs laid out like Tally's own prints: the ledger account, a tax invoice
// (sales, purchase, credit / debit notes with items) and accounting vouchers
// (receipt, payment, journal, contra). The full voucher comes from Tally
// through the Windows app; elsewhere a voucher is printed from the synced summary.
import type { Settings, TallyVoucher } from "./data";
import type { LedgerPart } from "./ledger";
import { amountInWords, lib, plain, type Doc } from "./pdf";
import { desktopRequest, inDesktopApp } from "./desktop";

export interface VoucherItem { name: string; desc?: string[]; hsn?: string; qty: number; unit?: string; rate: number; per?: string; discount?: number; amount: number; gst?: number }
export interface VoucherLedger { name: string; amount: number; party?: boolean; itemLedger?: boolean; bills?: { name: string; type: string; amount: number }[]; bank?: { type: string; number: string; date: string; bank: string }[] }
export interface VoucherDetail {
  type: string; number: string; date: string; party: string; buyer?: string; address?: string[]; gstin?: string; state?: string; pincode?: string; placeOfSupply?: string;
  consignee?: string; consigneeGstin?: string; consigneeState?: string; consigneeAddress?: string[]; cmpGstin?: string; cmpState?: string;
  reference?: string; referenceDate?: string; orderRef?: string; terms?: string; dispatchDoc?: string; dispatchedThrough?: string; destination?: string; vehicle?: string;
  ewayBill?: string; irn?: string; narration?: string; items: VoucherItem[]; ledgers: VoucherLedger[];
  summary?: boolean;   // built from the synced summary, not from Tally
}

// Tally's date style: 11-Nov-26
const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const tdate = (iso?: string) => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return Number(d) + "-" + M[Number(m) - 1] + "-" + y.slice(2); };
const amt = (n: number) => (Math.round(Math.abs(n) * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, ""));
const STATE_CODES: Record<string, string> = { "29": "Karnataka", "36": "Telangana", "37": "Andhra Pradesh", "33": "Tamil Nadu", "32": "Kerala", "27": "Maharashtra", "30": "Goa" };
const stateCode = (gstin?: string) => (gstin && /^\d\d/.test(gstin) ? gstin.slice(0, 2) : "");

const companyName = (s: Settings) => plain(s.businessName || "Chittam Enterprises");
const companyLines = (s: Settings) => plain(s.address || "").split(/\n|,\s*(?=\S)/).map((x) => x.trim()).filter(Boolean);

export const isInvoice = (v: VoucherDetail) => v.items.length > 0;
export const voucherTitle = (v: VoucherDetail) => {
  if (isInvoice(v)) {
    if (/credit/i.test(v.type)) return "Credit Note";
    if (/debit/i.test(v.type)) return "Debit Note";
    if (/purchase/i.test(v.type)) return "Purchase Voucher";
    return v.cmpGstin ? "Tax Invoice" : "Invoice";
  }
  if (/receipt/i.test(v.type)) return "Receipt Voucher";
  if (/payment/i.test(v.type)) return "Payment Voucher";
  if (/contra/i.test(v.type)) return "Contra Voucher";
  if (/journal/i.test(v.type)) return "Journal Voucher";
  return v.type || "Voucher";
};

// ------------------------------------------------------------------ fetching

let req = 0;
// the full voucher from Tally (Windows app on the Tally PC); null elsewhere
export async function fetchVoucher(account: string, id: string, date: string): Promise<VoucherDetail | null> {
  if (!inDesktopApp() || !id) return null;
  const reqId = String(++req);
  const r = await desktopRequest<{ ok: boolean; error?: string; voucher?: VoucherDetail; reqId: string }>(
    { type: "tally-voucher", key: account, id, date, reqId }, "tally-voucher", 30000);
  if (!r.ok || !r.voucher) throw new Error(r.error || "Tally didn't return the voucher.");
  return r.voucher;
}

// the synced one-line summary as a voucher (phones, browsers)
export function summaryVoucher(v: TallyVoucher): VoucherDetail {
  const party = { name: v.p, amount: v.dr ? -v.a : v.a, party: true };
  const others = (v.via || "").split(/,\s*/).filter(Boolean);
  return {
    type: v.t, number: v.n, date: v.d, party: v.p, narration: v.nar, items: [], summary: true,
    ledgers: [party, ...(others.length ? [{ name: others.join(", "), amount: -party.amount }] : [])],
  };
}

// ------------------------------------------------------------------ drawing helpers

type Box = { x: number; y: number; w: number; h: number };
function text(doc: Doc, s: string, x: number, y: number, o: { bold?: boolean; size?: number; align?: "left" | "right" | "center"; color?: number; maxW?: number } = {}) {
  doc.setFont("helvetica", o.bold ? "bold" : "normal"); doc.setFontSize(o.size || 8); doc.setTextColor(o.color ?? 0);
  const lines = o.maxW ? (doc.splitTextToSize(plain(s), o.maxW) as string[]) : [plain(s)];
  doc.text(lines, x, y, { align: o.align || "left" });
  return lines.length * (o.size || 8) * 0.42;
}
const rect = (doc: Doc, b: Box) => { doc.setDrawColor(0); doc.setLineWidth(0.25); doc.rect(b.x, b.y, b.w, b.h); };

// a label over a value, in one cell of the header grid
function cell(doc: Doc, b: Box, label: string, value: string) {
  rect(doc, b);
  text(doc, label, b.x + 1.5, b.y + 3.4, { size: 7, color: 60 });
  if (value) text(doc, value, b.x + 1.5, b.y + 7.4, { bold: true, size: 8, maxW: b.w - 3 });
}

// the party block: title line, name in bold, address, GSTIN, state
function partyBlock(doc: Doc, b: Box, title: string, name: string, address: string[], gstin?: string, state?: string) {
  rect(doc, b);
  let y = b.y + 3.6;
  text(doc, title, b.x + 1.5, y, { size: 7, color: 60 }); y += 4;
  y += text(doc, name, b.x + 1.5, y, { bold: true, size: 9, maxW: b.w - 3 });
  for (const l of address.slice(0, 4)) y += text(doc, l, b.x + 1.5, y, { size: 7.5, maxW: b.w - 3 });
  if (gstin) y += text(doc, "GSTIN/UIN       : " + gstin, b.x + 1.5, y + 0.6, { size: 7.5 });
  if (state || gstin) text(doc, "State Name      : " + (state || STATE_CODES[stateCode(gstin)] || "") + (stateCode(gstin) ? ", Code : " + stateCode(gstin) : ""), b.x + 1.5, y + 0.8, { size: 7.5 });
}

function companyBlock(doc: Doc, s: Settings, b: Box, v: VoucherDetail) {
  rect(doc, b);
  let y = b.y + 4.5;
  y += text(doc, companyName(s), b.x + 1.5, y, { bold: true, size: 10, maxW: b.w - 3 });
  for (const l of companyLines(s).slice(0, 4)) y += text(doc, l, b.x + 1.5, y, { size: 7.5, maxW: b.w - 3 });
  if (v.cmpGstin) y += text(doc, "GSTIN/UIN: " + v.cmpGstin, b.x + 1.5, y + 0.4, { size: 7.5 });
  if (v.cmpState) text(doc, "State Name : " + v.cmpState + (stateCode(v.cmpGstin) ? ", Code : " + stateCode(v.cmpGstin) : ""), b.x + 1.5, y + 0.6, { size: 7.5 });
}

// ------------------------------------------------------------------ tax invoice

export async function invoicePdf(s: Settings, v: VoucherDetail) {
  const { jsPDF, autoTable } = await lib();
  const doc = new jsPDF({ unit: "mm", format: "a4" }) as Doc;
  const W = doc.internal.pageSize.getWidth(), L = 10, R = W - 10, CW = R - L, half = CW / 2;
  text(doc, voucherTitle(v), W / 2, 11, { bold: true, size: 12, align: "center" });
  if (v.irn) text(doc, "IRN: " + v.irn, L, 15, { size: 6.5 });
  const top = 17;
  // left: seller, consignee, buyer; right: the details grid
  const cH = 26, pH = 30;
  companyBlock(doc, s, { x: L, y: top, w: half, h: cH }, v);
  const cons = v.consignee || v.buyer || v.party;
  partyBlock(doc, { x: L, y: top + cH, w: half, h: pH }, "Consignee (Ship to)", cons,
    v.consigneeAddress?.length ? v.consigneeAddress : v.address || [], v.consigneeGstin || v.gstin, v.consigneeState || v.state);
  partyBlock(doc, { x: L, y: top + cH + pH, w: half, h: pH }, "Buyer (Bill to)", v.buyer || v.party, v.address || [], v.gstin, v.state);
  const grid: [string, string][] = [
    [/credit|debit/i.test(v.type) ? "Note No." : "Invoice No.", v.number], ["Dated", tdate(v.date)],
    ["Delivery Note", ""], ["Mode/Terms of Payment", v.terms || ""],
    ["Reference No. & Date.", [v.reference, tdate(v.referenceDate)].filter(Boolean).join(" dt. ")], ["Other References", ""],
    ["Buyer's Order No.", v.orderRef || ""], ["Dated", ""],
    ["Dispatch Doc No.", v.dispatchDoc || ""], ["Delivery Note Date", ""],
    ["Dispatched through", v.dispatchedThrough || ""], ["Destination", v.destination || ""],
    ["Bill of Lading/LR-RR No.", ""], ["Motor Vehicle No.", v.vehicle || ""],
  ];
  const gh = (cH + pH * 2) / 8;
  grid.forEach(([k, val], i) => cell(doc, { x: L + half + (i % 2) * (half / 2), y: top + Math.floor(i / 2) * gh, w: half / 2, h: gh }, k, val));
  cell(doc, { x: L + half, y: top + 7 * gh, w: half, h: gh }, "Terms of Delivery", v.ewayBill ? "e-Way Bill No. " + v.ewayBill : "");
  let y = top + cH + pH * 2;

  // items, then the tax / other ledger lines, then the total
  const extras = v.ledgers.filter((l) => !l.party && !l.itemLedger && Math.abs(l.amount) > 0.004);
  const sign = v.ledgers.find((l) => l.itemLedger)?.amount ?? 1;
  const itemsTotal = v.items.reduce((t, i) => t + i.amount, 0);
  const extraTotal = extras.reduce((t, l) => t + (Math.sign(l.amount) === Math.sign(sign) ? Math.abs(l.amount) : -Math.abs(l.amount)), 0);
  const partyLine = v.ledgers.find((l) => l.party);
  const grand = partyLine ? Math.abs(partyLine.amount) : itemsTotal + extraTotal;
  const units = new Set(v.items.map((i) => i.unit || ""));
  const totalQty = v.items.reduce((t, i) => t + i.qty, 0);
  const body: unknown[][] = v.items.map((i, n) => [
    String(n + 1), { content: plain(i.name) + (i.desc?.length ? "\n" + plain(i.desc.join("\n")) : ""), styles: { fontStyle: "bold" } }, i.hsn || "",
    i.qty ? qty(i.qty) + " " + (i.unit || "") : "", i.rate ? amt(i.rate) : "", i.per || i.unit || "", i.discount ? i.discount + " %" : "", amt(i.amount)]);
  extras.forEach((l) => body.push(["", { content: plain(l.name), styles: { halign: "right", fontStyle: "bold" } }, "", "", "", "", "", (Math.sign(l.amount) === Math.sign(sign) ? "" : "(-)") + amt(l.amount)]));
  body.push(["", { content: "Total", styles: { halign: "right", fontStyle: "bold" } }, "", { content: units.size === 1 && totalQty ? qty(totalQty) + " " + [...units][0] : "", styles: { fontStyle: "bold" } }, "", "", "",
    { content: "Rs. " + amt(grand), styles: { fontStyle: "bold" } }]);
  autoTable(doc, {
    startY: y, theme: "grid", margin: { left: L, right: 10 },
    head: [["Sl\nNo.", "Description of Goods", "HSN/SAC", "Quantity", "Rate", "per", "Disc. %", "Amount"]], body,
    styles: { fontSize: 8, cellPadding: 1.4, lineColor: [0, 0, 0], lineWidth: 0.2, textColor: [0, 0, 0], valign: "top" },
    headStyles: { fillColor: [255, 255, 255], fontStyle: "normal", halign: "center", fontSize: 7.5 },
    columnStyles: { 0: { cellWidth: 9, halign: "center" }, 2: { cellWidth: 19, halign: "center" }, 3: { cellWidth: 20, halign: "right" }, 4: { cellWidth: 20, halign: "right" },
      5: { cellWidth: 11, halign: "center" }, 6: { cellWidth: 13, halign: "right" }, 7: { cellWidth: 27, halign: "right" } },
  });
  y = (doc.lastAutoTable?.finalY || y);
  const words = (label: string, value: string, right?: string) => {
    const h = 10; if (y + h > doc.internal.pageSize.getHeight() - 12) { doc.addPage(); y = 12; }
    rect(doc, { x: L, y, w: CW, h });
    text(doc, label, L + 1.5, y + 3.6, { size: 7, color: 60 });
    if (right) text(doc, right, R - 1.5, y + 3.6, { size: 7, align: "right", color: 60 });
    text(doc, value, L + 1.5, y + 7.8, { bold: true, size: 8.5, maxW: CW - 3 });
    y += h;
  };
  words("Amount Chargeable (in words)", amountInWords(Math.round(grand * 100) / 100).replace(/^Rupees/, "INR"), "E. & O.E");

  // HSN-wise tax summary
  const taxes = extras.filter((l) => /gst|cess|tax/i.test(l.name));
  if (taxes.length && v.items.some((i) => i.gst)) {
    const igst = taxes.some((l) => /igst/i.test(l.name));
    const by = new Map<string, { taxable: number; rate: number }>();
    v.items.forEach((i) => { const k = (i.hsn || "-") + "|" + (i.gst || 0); const e = by.get(k) || { taxable: 0, rate: i.gst || 0 }; e.taxable += i.amount; by.set(k, e); });
    const rows: unknown[][] = [...by.entries()].map(([k, e]) => {
      const tax = Math.round(e.taxable * e.rate) / 100;
      return igst ? [k.split("|")[0], amt(e.taxable), e.rate + "%", amt(tax), amt(tax)]
        : [k.split("|")[0], amt(e.taxable), e.rate / 2 + "%", amt(tax / 2), e.rate / 2 + "%", amt(tax / 2), amt(tax)];
    });
    const tt = [...by.values()].reduce((t, e) => t + Math.round(e.taxable * e.rate) / 100, 0), tv = [...by.values()].reduce((t, e) => t + e.taxable, 0);
    const bold = (x: string) => ({ content: x, styles: { fontStyle: "bold" } });
    rows.push(igst ? [bold("Total"), bold(amt(tv)), "", bold(amt(tt)), bold(amt(tt))] : [bold("Total"), bold(amt(tv)), "", bold(amt(tt / 2)), "", bold(amt(tt / 2)), bold(amt(tt))]);
    autoTable(doc, {
      startY: y, theme: "grid", margin: { left: L, right: 10 },
      head: igst ? [["HSN/SAC", "Taxable Value", "IGST Rate", "IGST Amount", "Total Tax Amount"]]
        : [["HSN/SAC", "Taxable Value", "CGST Rate", "CGST Amount", "SGST/UTGST Rate", "SGST/UTGST Amount", "Total Tax Amount"]],
      body: rows,
      styles: { fontSize: 7.5, cellPadding: 1.2, lineColor: [0, 0, 0], lineWidth: 0.2, textColor: [0, 0, 0], halign: "right" },
      headStyles: { fillColor: [255, 255, 255], fontStyle: "normal", halign: "center", fontSize: 7 },
      columnStyles: { 0: { halign: "left" } },
    });
    y = doc.lastAutoTable?.finalY || y;
    words("Tax Amount (in words)", amountInWords(Math.round(tt * 100) / 100).replace(/^Rupees/, "INR"));
  }
  if (v.narration) words("Remarks", v.narration);

  // declaration and signatory
  const h = 24; if (y + h > doc.internal.pageSize.getHeight() - 12) { doc.addPage(); y = 12; }
  rect(doc, { x: L, y, w: half, h }); rect(doc, { x: L + half, y, w: half, h });
  text(doc, "Declaration", L + 1.5, y + 4, { size: 7.5, bold: true });
  text(doc, "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.", L + 1.5, y + 8, { size: 7.5, maxW: half - 3 });
  text(doc, "for " + companyName(s), R - 1.5, y + 4.5, { size: 8, bold: true, align: "right" });
  text(doc, "Authorised Signatory", R - 1.5, y + h - 2.5, { size: 7.5, align: "right" });
  y += h;
  text(doc, "This is a Computer Generated " + (/invoice/i.test(voucherTitle(v)) ? "Invoice" : "Document"), W / 2, y + 5, { size: 7.5, align: "center" });
  return doc.output("blob");
}

// ------------------------------------------------------------------ accounting voucher

export async function accountingVoucherPdf(s: Settings, v: VoucherDetail) {
  const { jsPDF, autoTable } = await lib();
  const doc = new jsPDF({ unit: "mm", format: "a5", orientation: "landscape" }) as Doc;
  const W = doc.internal.pageSize.getWidth(), L = 10, R = W - 10;
  let y = 11;
  text(doc, companyName(s), W / 2, y, { bold: true, size: 11, align: "center" }); y += 4;
  for (const l of companyLines(s).slice(0, 3)) { text(doc, l, W / 2, y, { size: 7.5, align: "center" }); y += 3.4; }
  if (v.cmpGstin) { text(doc, "GSTIN/UIN: " + v.cmpGstin, W / 2, y, { size: 7.5, align: "center" }); y += 3.4; }
  y += 2;
  text(doc, voucherTitle(v), W / 2, y, { bold: true, size: 10.5, align: "center" }); y += 6;
  text(doc, "No. : " + v.number, L, y, { size: 8.5 }); text(doc, "Dated : " + tdate(v.date), R, y, { size: 8.5, align: "right" }); y += 2;

  const two = /receipt|payment|contra/i.test(v.type) || v.summary;
  const party = v.ledgers.find((l) => l.party) || v.ledgers[0];
  const body: unknown[][] = [];
  let total = 0;
  if (two && party) {
    // Account: the party (with bills); Through: the cash / bank ledger(s)
    const acct = v.ledgers.filter((l) => Math.sign(l.amount) === Math.sign(party.amount));
    const through = v.ledgers.filter((l) => Math.sign(l.amount) !== Math.sign(party.amount));
    acct.forEach((l, i) => {
      body.push([{ content: (i === 0 ? "Account :\n" : "") + plain(l.name), styles: { fontStyle: "bold" } }, amt(l.amount)]);
      (l.bills || []).forEach((b) => body.push([{ content: "      " + b.type + "  " + plain(b.name) + "    " + amt(b.amount) + (b.amount < 0 ? " Dr" : " Cr"), styles: { fontSize: 7.5, textColor: [70, 70, 70] } }, ""]));
      total += Math.abs(l.amount);
    });
    through.forEach((l, i) => {
      body.push([{ content: (i === 0 ? "Through :\n" : "") + plain(l.name), styles: { fontStyle: "bold" } }, ""]);
      (l.bank || []).forEach((b) => body.push([{ content: "      " + [b.type, b.number ? "No. " + b.number : "", tdate(b.date), b.bank].filter(Boolean).join("   "), styles: { fontSize: 7.5, textColor: [70, 70, 70] } }, ""]));
    });
  } else {
    v.ledgers.forEach((l) => body.push([{ content: plain(l.name) + (l.amount < 0 ? "  Dr" : "  Cr"), styles: { fontStyle: "bold" } }, l.amount < 0 ? amt(l.amount) : "", l.amount > 0 ? amt(l.amount) : ""]));
    total = v.ledgers.filter((l) => l.amount < 0).reduce((t, l) => t + Math.abs(l.amount), 0);
  }
  if (v.narration) body.push([{ content: "On Account of :\n" + plain(v.narration), styles: { fontSize: 8 } }, ...(two ? [""] : ["", ""])]);
  body.push([{ content: "Amount (in words) :\n" + amountInWords(Math.round(total * 100) / 100).replace(/^Rupees/, "INR"), styles: { fontSize: 8 } }, ...(two ? [""] : ["", ""])]);
  const foot = two ? [["", "Rs. " + amt(total)]] : [["", "Rs. " + amt(total), "Rs. " + amt(total)]];
  autoTable(doc, {
    startY: y + 2, theme: "plain", margin: { left: L, right: 10 },
    head: [two ? ["Particulars", "Amount"] : ["Particulars", "Debit", "Credit"]], body, foot,
    styles: { fontSize: 8.5, cellPadding: 1.5, textColor: [0, 0, 0] },
    headStyles: { fontStyle: "bold", lineWidth: { top: 0.3, bottom: 0.3 }, lineColor: [0, 0, 0] },
    footStyles: { fontStyle: "bold", lineWidth: { top: 0.3, bottom: 0.3 }, lineColor: [0, 0, 0], halign: "right" },
    columnStyles: two ? { 1: { halign: "right", cellWidth: 35 } } : { 1: { halign: "right", cellWidth: 32 }, 2: { halign: "right", cellWidth: 32 } },
    didParseCell: (d: { section: string; column: { index: number }; cell: { styles: { halign: string } } }) => { if (d.section === "head" && d.column.index >= 1) d.cell.styles.halign = "right"; },
  });
  y = (doc.lastAutoTable?.finalY || y) + 16;
  if (/receipt|payment/i.test(v.type)) text(doc, /receipt/i.test(v.type) ? "Receiver's Signature :" : "Receiver's Signature :", L, y, { size: 8 });
  text(doc, "Authorised Signatory", R, y, { size: 8, align: "right" });
  if (v.summary) text(doc, "Summary from the synced Tally data. Open on the Tally PC (Windows app) for the full voucher.", W / 2, doc.internal.pageSize.getHeight() - 6, { size: 6.5, align: "center", color: 110 });
  return doc.output("blob");
}

export const voucherPdf = (s: Settings, v: VoucherDetail) => (isInvoice(v) ? invoicePdf(s, v) : accountingVoucherPdf(s, v));

// ------------------------------------------------------------------ ledger account

export interface PendingBill { n: string; d: string; due?: string; a: number; od?: number }
const daysSince = (iso: string) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86400e3)) : 0);
const drcrAmt = (n: number) => (Math.abs(n) < 0.005 ? "Nil" : amt(n) + (n > 0 ? " Dr" : " Cr"));

// Tally's Ledger Account, one section per company. Particulars show the voucher
// type; each section ends with its closing balance, then a highlighted summary
// of both companies and the grand total. With bills, the pending bills of each
// company follow, with their age in days. If it runs past one page, each
// company starts on its own page.
export async function tallyLedgerPdf(s: Settings, customer: { name: string; mobile?: string }, from: string, to: string, parts: LedgerPart[],
  opts: { bills?: Partial<Record<string, PendingBill[]>> } = {}) {
  const { jsPDF, autoTable } = await lib();
  const draw = (split: boolean) => {
    const doc = new jsPDF({ unit: "mm", format: "a4" }) as Doc;
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), L = 12, R = W - 12;
    const head = (sub?: string) => {
      let y = 13;
      text(doc, companyName(s), W / 2, y, { bold: true, size: 12, align: "center" }); y += 4.5;
      for (const l of companyLines(s).slice(0, 3)) { text(doc, l, W / 2, y, { size: 8, align: "center" }); y += 3.6; }
      y += 3;
      text(doc, plain(customer.name), W / 2, y, { bold: true, size: 11, align: "center" }); y += 4.5;
      text(doc, "Ledger Account" + (sub ? " - " + sub : ""), W / 2, y, { size: 8.5, align: "center" }); y += 4;
      if (customer.mobile) { text(doc, "Mobile: " + customer.mobile, W / 2, y, { size: 8, align: "center" }); y += 4; }
      text(doc, tdate(from) + " to " + tdate(to), W / 2, y, { size: 8.5, bold: true, align: "center" });
      return y + 3;
    };
    let y = head(split && parts.length > 1 ? parts[0].label : undefined);
    parts.forEach((p, idx) => {
      if (idx > 0 && split) { doc.addPage(); y = head(p.label); }
      if (parts.length > 1 && !split) { y += 4; text(doc, p.label, L, y, { bold: true, size: 9.5 }); }
      const bold = (x: string) => ({ content: x, styles: { fontStyle: "bold" } });
      const dr = p.rows.reduce((t, r) => t + r.dr, 0) + (p.opening > 0 ? p.opening : 0);
      const cr = p.rows.reduce((t, r) => t + r.cr, 0) + (p.opening < 0 ? -p.opening : 0);
      const body: unknown[][] = [
        [tdate(from), bold((p.opening >= 0 ? "To " : "By ") + "Opening Balance"), "", p.opening > 0.004 ? bold(amt(p.opening)) : "", p.opening < -0.004 ? bold(amt(p.opening)) : ""],
        ...p.rows.map((r) => [tdate(r.d), (r.dr ? "To " : "By ") + plain(r.t || r.via || ""), plain(r.n || ""), r.dr ? amt(r.dr) : "", r.cr ? amt(r.cr) : ""]),
      ];
      const hi = { fillColor: [238, 242, 255], fontStyle: "bold", textColor: [30, 27, 120] };
      const foot = [
        ["", "", "Current Total :", amt(dr), amt(cr)],
        [{ content: "", styles: hi }, { content: "", styles: hi }, { content: "Closing Balance :", styles: hi },
          { content: p.closing > 0.004 ? amt(p.closing) + " Dr" : "", styles: hi }, { content: p.closing < -0.004 ? amt(p.closing) + " Cr" : Math.abs(p.closing) <= 0.004 ? "Nil" : "", styles: hi }],
      ];
      autoTable(doc, {
        startY: y + 2, theme: "plain", margin: { left: L, right: 12 }, showFoot: "lastPage",
        head: [["Date", "Particulars", "Vch No.", "Debit", "Credit"]], body, foot,
        styles: { fontSize: 8.5, cellPadding: 1.4, textColor: [0, 0, 0], valign: "top" },
        headStyles: { fontStyle: "bold", lineWidth: { top: 0.3, bottom: 0.3 }, lineColor: [0, 0, 0] },
        footStyles: { fontStyle: "bold", halign: "right", lineWidth: { top: 0.2 }, lineColor: [0, 0, 0] },
        columnStyles: { 0: { cellWidth: 20 }, 2: { cellWidth: 38 }, 3: { cellWidth: 28, halign: "right" }, 4: { cellWidth: 28, halign: "right" } },
        didParseCell: (d: { section: string; column: { index: number }; cell: { styles: { halign: string } } }) => { if (d.section === "head" && d.column.index >= 3) d.cell.styles.halign = "right"; },
      });
      y = doc.lastAutoTable?.finalY || y;
      // pending bills of this company, oldest first, with their age
      const bills = opts.bills?.[p.account];
      if (bills) {
        y += 5;
        if (y > H - 30) { doc.addPage(); y = 14; }
        text(doc, "Pending bills - " + p.label, L, y, { bold: true, size: 9 });
        const total = bills.reduce((t, b) => t + b.a, 0);
        autoTable(doc, {
          startY: y + 1.5, theme: "grid", margin: { left: L, right: 12 },
          head: [["Bill Date", "Bill No.", "Due on", "Days", "Overdue by", "Pending Amount"]],
          body: bills.length ? bills.map((b) => [tdate(b.d), plain(b.n), tdate(b.due), String(daysSince(b.d)), b.od ? b.od + " days" : "-", amt(b.a) + " Dr"])
            : [[{ content: "No pending bills", colSpan: 6, styles: { halign: "center", textColor: [110, 110, 110] } }]],
          foot: bills.length ? [["", "", "", "", "Total", amt(total) + " Dr"]] : undefined,
          styles: { fontSize: 8, cellPadding: 1.2, lineColor: [180, 180, 180], lineWidth: 0.15, textColor: [0, 0, 0] },
          headStyles: { fillColor: [245, 245, 245], fontStyle: "bold" },
          footStyles: { fillColor: [255, 255, 255], fontStyle: "bold", halign: "right" },
          columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
        });
        y = doc.lastAutoTable?.finalY || y;
      }
      if (!split && y > H - 30 && idx < parts.length - 1) { doc.addPage(); y = 14; }
    });
    // highlighted summary: each company's closing balance and the grand total
    const total = parts.reduce((t, p) => t + p.closing, 0);
    // exactly what's drawn below: title (7.5), a row per company (6 each), the
    // grand-total rule and row (7), and room under the last line (5)
    const boxH = 7.5 + parts.length * 6 + (parts.length > 1 ? 7 : 0) + 5;
    y += 7;
    if (y + boxH > H - 12) { doc.addPage(); y = 16; }
    doc.setFillColor(238, 242, 255); doc.setDrawColor(67, 56, 202); doc.setLineWidth(0.4);
    doc.roundedRect(L, y, R - L, boxH, 2, 2, "FD");
    let yy = y + 6.5;
    text(doc, "Balance summary", L + 4, yy, { bold: true, size: 9, color: 60 }); yy += 1;
    parts.forEach((p) => {
      yy += 6;
      text(doc, p.label + " - Closing Balance", L + 4, yy, { size: 9.5 });
      text(doc, drcrAmt(p.closing), R - 4, yy, { bold: true, size: 10, align: "right" });
    });
    if (parts.length > 1) {
      yy += 2; doc.setDrawColor(67, 56, 202); doc.setLineWidth(0.3); doc.line(L + 4, yy, R - 4, yy); yy += 5;
      text(doc, "Grand Total (" + (parts.length > 2 ? "all" : "both") + " companies)", L + 4, yy, { bold: true, size: 11 });
      text(doc, drcrAmt(total), R - 4, yy, { bold: true, size: 12, align: "right" });
    }
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) { doc.setPage(i); text(doc, "Page " + i + " of " + pages, R, H - 7, { size: 7, align: "right", color: 110 }); }
    return doc;
  };
  let doc = draw(false);
  if (doc.getNumberOfPages() > 1 && parts.length > 1) doc = draw(true);
  return doc.output("blob");
}
