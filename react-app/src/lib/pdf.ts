// PDF files to send on WhatsApp: the ledger statement and a payment receipt.
// The PDF library is loaded only when a PDF is made. Sharing:
//   phone      → the share sheet (pick WhatsApp, then the chat)
//   Windows app → saved in Documents\Chittam Enterprises, copied, and the
//                 customer's WhatsApp chat opened: press Ctrl+V there
//   browser    → downloaded, and the WhatsApp chat opened
import type { Receipt, Settings } from "./data";
import { msgDate, waNumber } from "./messages";
import { amountOf, receiptKeys, receiptTotal } from "./companies";
import { desktopRequest, inDesktopApp } from "./desktop";

// the PDF's built-in font has no ₹ sign
export const rs = (n: number) => "Rs. " + (Math.round(n * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const plain = (s: string) => s.replace(/₹\s?/g, "Rs. ").replace(/[^\x20-\x7E\n]/g, "");

export async function lib() {
  const [{ jsPDF }, at] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = (at as unknown as { autoTable?: unknown; default: unknown }).autoTable || at.default;
  return { jsPDF, autoTable: autoTable as (doc: unknown, opts: Record<string, unknown>) => void };
}
export type Doc = InstanceType<Awaited<ReturnType<typeof lib>>["jsPDF"]> & { lastAutoTable?: { finalY: number } };

const BRAND: [number, number, number] = [67, 56, 202];

// business name and address on the left, the document title on the right
function header(doc: Doc, s: Settings, title: string, sub: string) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(17);
  doc.text(plain(s.businessName || "Chittam Enterprises"), 14, 18);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90);
  const addr = doc.splitTextToSize(plain(s.address || ""), 110) as string[];
  doc.text(addr, 14, 24);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...BRAND);
  doc.text(title, w - 14, 18, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90);
  doc.text(sub, w - 14, 24, { align: "right" });
  const y = Math.max(30, 24 + addr.length * 4 + 2);
  doc.setDrawColor(...BRAND); doc.setLineWidth(0.6); doc.line(14, y, w - 14, y);
  doc.setTextColor(17);
  return y + 7;
}

function footer(doc: Doc, note: string) {
  const pages = doc.getNumberOfPages(), w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(plain(note), 14, h - 8);
    doc.text("Page " + i + " of " + pages, w - 14, h - 8, { align: "right" });
  }
}

// Indian number words, for "Rupees ... only"
function words(n: number): string {
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number) => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? " " + a[x % 10] : ""));
  const three = (x: number) => (x >= 100 ? a[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " + two(x % 100) : "") : two(x));
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const cr = Math.floor(n / 1e7), lk = Math.floor((n % 1e7) / 1e5), th = Math.floor((n % 1e5) / 1000), rest = n % 1000;
  if (cr) parts.push(words(cr) + " Crore");
  if (lk) parts.push(two(lk) + " Lakh");
  if (th) parts.push(two(th) + " Thousand");
  if (rest) parts.push(three(rest));
  return parts.join(" ");
}
export const amountInWords = (n: number) => {
  const r = Math.floor(n), p = Math.round((n - r) * 100);
  return "Rupees " + words(r) + (p ? " and " + words(p) + " Paise" : "") + " Only";
};

export const receiptNo = (r: Receipt) => r.ref || "R-" + r.date.replace(/-/g, "").slice(2) + "-" + r.id.replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase();

// labels: company key -> name (for companies beyond Chittam Enterprises and Cash)
export async function receiptPdf(s: Settings, r: Receipt, mobile?: string, balances?: Record<string, [number, number] | undefined>, labels: Record<string, string> = {}) {
  const { jsPDF, autoTable } = await lib();
  const doc = new jsPDF({ unit: "mm", format: "a5" }) as Doc;
  const w = doc.internal.pageSize.getWidth();
  let y = header(doc, s, "PAYMENT RECEIPT", "No. " + receiptNo(r) + "  ·  " + msgDate(r.date));
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90); doc.text("Received with thanks from", 14, y);
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(17); doc.text(plain(r.customerName), 14, y + 6);
  if (mobile) { doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90); doc.text(mobile, 14, y + 11); doc.setTextColor(17); }
  y += mobile ? 16 : 12;
  const total = receiptTotal(r);
  const biz = plain(s.businessName || "Chittam Enterprises");
  const rows: (string | { content: string; styles: Record<string, unknown> })[][] = [];
  const line = (label: string, amt: number, bal?: [number, number]) =>
    rows.push([label, rs(amt), bal ? rs(bal[0]) : "", bal ? rs(bal[1]) : ""]);
  for (const k of receiptKeys(r)) line(k === "business" ? biz : k === "cash" ? "Cash" : plain(labels[k] || k), amountOf(r, k), balances?.[k]);
  const showBal = Object.values(balances || {}).some(Boolean);
  autoTable(doc, {
    startY: y, theme: "plain", margin: { left: 14, right: 14 },
    head: [showBal ? ["Account", "Received", "Previous bal.", "Balance now"] : ["Account", "Received"]],
    body: [...rows.map((x) => (showBal ? x : x.slice(0, 2))),
      showBal ? [{ content: "Total", styles: { fontStyle: "bold" } }, { content: rs(total), styles: { fontStyle: "bold" } }, "", ""] : [{ content: "Total", styles: { fontStyle: "bold" } }, { content: rs(total), styles: { fontStyle: "bold" } }]],
    styles: { fontSize: 9, cellPadding: 2, lineColor: [229, 231, 235], lineWidth: { bottom: 0.2 } },
    headStyles: { fontStyle: "bold", textColor: [90, 90, 90], lineWidth: { bottom: 0.5 }, lineColor: [60, 60, 60] },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    didParseCell: (d: { section: string; column: { index: number }; cell: { styles: { halign: string } } }) => { if (d.section === "head" && d.column.index >= 1) d.cell.styles.halign = "right"; },
  });
  y = (doc.lastAutoTable?.finalY || y) + 7;
  doc.setFont("helvetica", "italic"); doc.setFontSize(9);
  const aw = doc.splitTextToSize(amountInWords(total), w - 28) as string[];
  doc.text(aw, 14, y); y += aw.length * 4.5 + 3;
  doc.setFont("helvetica", "normal");
  const info: [string, string][] = [["Payment mode", plain(r.mode || "-")]];
  if (r.txnRef) info.push([/cheque/i.test(r.mode) ? "Cheque no." : "Transaction ID / UTR", plain(r.txnRef)]);
  if (r.receivedBy) info.push(["Received by", plain(r.receivedBy)]);
  if (r.tallyNo) info.push(["Tally voucher no.", plain(r.tallyNo)]);
  if (r.note) info.push(["Note", plain(r.note)]);
  for (const [k, v] of info) { doc.setTextColor(90); doc.text(k, 14, y); doc.setTextColor(17); doc.text(v, 52, y); y += 5.5; }
  const h = doc.internal.pageSize.getHeight();
  const sy = Math.max(y + 14, h - 30);
  doc.setFontSize(9); doc.text("For " + biz, w - 14, sy, { align: "right" });
  doc.setDrawColor(150); doc.setLineWidth(0.2); doc.line(w - 64, sy + 12, w - 14, sy + 12);
  doc.setTextColor(90); doc.text("Authorised signatory", w - 14, sy + 16, { align: "right" });
  footer(doc, "Computer-generated receipt. Generated " + new Date().toLocaleString("en-IN"));
  return doc.output("blob");
}

const toBase64 = (blob: Blob) => new Promise<string>((ok, fail) => {
  const fr = new FileReader();
  fr.onload = () => ok(String(fr.result).replace(/^data:[^,]*,/, ""));
  fr.onerror = () => fail(fr.error);
  fr.readAsDataURL(blob);
});

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

// Returns what happened, for a toast. kind picks the Windows app's folder.
export async function sharePdf(blob: Blob, fileName: string, opts: { mobile?: string; text?: string; kind: "Ledgers" | "Receipts" | "Vouchers" }): Promise<{ message: string; path?: string }> {
  const phone = waNumber(opts.mobile);
  if (inDesktopApp()) {
    const r = await desktopRequest<{ ok: boolean; path?: string; error?: string; whatsapp?: boolean }>(
      { type: "share-file", name: fileName, folder: opts.kind, data: await toBase64(blob), phone }, "share-file-result", 20000);
    if (!r.ok) throw new Error(r.error || "Could not save the PDF.");
    return { path: r.path, message: r.whatsapp ? "PDF saved and copied. In the WhatsApp chat, press Ctrl+V, then Send." : "PDF saved and copied — paste it (Ctrl+V) in WhatsApp." };
  }
  const file = new File([blob], fileName, { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: fileName, text: opts.text }); return { message: "Shared." }; }
    catch (e) { if ((e as Error).name === "AbortError") return { message: "" }; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  if (phone) window.open("https://wa.me/" + phone, "_blank");
  return { message: "PDF downloaded. Attach it in the WhatsApp chat (📎 → Document)." };
}
