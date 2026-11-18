export function inr(n: number | string | undefined) {
  const v = Number(n) || 0;
  return "₹" + v.toLocaleString("en-IN");
}

// local date (toISOString would give yesterday before 5:30 am in India)
export function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export function formatDate(iso: string | undefined) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// Tally exports are often UTF-16 with a byte-order mark
export function decodeFileText(buf: ArrayBuffer) {
  const b = new Uint8Array(buf);
  let text: string;
  if (b[0] === 0xff && b[1] === 0xfe) text = new TextDecoder("utf-16le").decode(buf);
  else if (b[0] === 0xfe && b[1] === 0xff) text = new TextDecoder("utf-16be").decode(buf);
  else text = new TextDecoder("utf-8").decode(buf);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
