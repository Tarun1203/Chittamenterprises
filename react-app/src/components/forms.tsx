// Form pieces shared by the message pages, Orders and Service Jobs:
// customer picker, type-ahead suggestions, number fields, the message panel
// (Generate / Copy / WhatsApp) and the Tally balance fill-in.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconBrandWhatsapp, IconCheck, IconCopy, IconSparkles, IconX } from "@tabler/icons-react";
import { Button as MovingBorderButton } from "@/components/ui/moving-border";
import { Button, Card, useToast } from "@/components/kit";
import { useStore } from "@/lib/store";
import { logEvent, logMessage, normalizeName, type BalanceSet, type Customer } from "@/lib/data";
import { waNumber } from "@/lib/messages";
import { inr } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ---------------- type-ahead box (shared by the pickers) ---------------- */
interface Option { key: string; label: string; sub?: string }
function TypeAhead({ value, onChange, options, onPick, placeholder, className, emptyText }: {
  value: string; onChange: (v: string) => void; options: Option[]; onPick: (o: Option) => void;
  placeholder?: string; className?: string; emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => setActive(0), [value]);
  const shown = options.slice(0, 40);
  function pick(o: Option) { onPick(o); setOpen(false); }
  return (
    <div ref={wrap} className={cn("relative", className)}>
      <input
        className="field-input"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (!open || !shown.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(shown[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      <AnimatePresence>
        {open && (shown.length > 0 || emptyText) && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}
            className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1 shadow-xl"
          >
            {shown.length === 0 && <div className="px-3 py-2.5 text-sm text-neutral-400">{emptyText}</div>}
            {shown.map((o, n) => (
              <button
                key={o.key} type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(n)}
                onClick={() => pick(o)}
                className={cn("block w-full rounded-lg px-3 py-2 text-left", n === active ? "bg-brand-50" : "")}
              >
                <div className="text-sm font-semibold text-neutral-800">{o.label}</div>
                {o.sub && <div className="text-xs text-neutral-500">{o.sub}</div>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------- customer picker ---------------- */
export function CustomerPicker({ value, onPick, placeholder = "Search customer by name or mobile…" }: {
  value: Customer | null; onPick: (c: Customer | null) => void; placeholder?: string;
}) {
  const { customers } = useStore();
  const [q, setQ] = useState("");
  const options = useMemo(() => {
    const f = q.trim().toLowerCase();
    return customers
      .filter((c) => !f || c.name.toLowerCase().includes(f) || (c.mobile || "").includes(f))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ key: c.id, label: c.name, sub: c.mobile || "No mobile saved" }));
  }, [customers, q]);
  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold text-neutral-900">{value.name}</div>
          <div className="text-xs text-neutral-500">{value.mobile || "No mobile saved — add it in Customers"}</div>
        </div>
        <button type="button" onClick={() => onPick(null)} className="rounded-full p-1.5 text-neutral-500 hover:bg-white" aria-label="Change customer"><IconX size={16} /></button>
      </div>
    );
  }
  return (
    <TypeAhead
      value={q} onChange={setQ} placeholder={placeholder} options={options}
      emptyText={customers.length ? "No customer matches." : "No customers yet — add them in Customers."}
      onPick={(o) => { const c = customers.find((x) => x.id === o.key); if (c) { onPick(c); setQ(""); } }}
    />
  );
}

/* ---------------- free text with suggestions (products, transports) ---------------- */
export function SuggestInput({ value, onChange, suggestions, onPick, placeholder, className }: {
  value: string; onChange: (v: string) => void; suggestions: { name: string; sub?: string }[];
  onPick?: (name: string) => void; placeholder?: string; className?: string;
}) {
  const options = useMemo(() => {
    const f = value.trim().toLowerCase();
    if (!f) return suggestions.slice(0, 40).map((s) => ({ key: s.name, label: s.name, sub: s.sub }));
    const words = f.split(/\s+/);
    return suggestions
      .filter((s) => { const n = s.name.toLowerCase(); return words.every((w) => n.includes(w)) && n !== f; })
      .map((s) => ({ key: s.name, label: s.name, sub: s.sub }));
  }, [suggestions, value]);
  return <TypeAhead value={value} onChange={onChange} options={options} placeholder={placeholder} className={className} onPick={(o) => { onChange(o.label); onPick?.(o.label); }} />;
}

export function useProductSuggestions() {
  const { products } = useStore();
  return useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ name: p.name, sub: (p.category ? p.category + " · " : "") + inr(p.price) })), [products]);
}
export function useTransportSuggestions() {
  const { transports } = useStore();
  return useMemo(() => [...transports].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ name: t.name, sub: [t.contactPerson, t.phone, t.branch].filter(Boolean).join(" · ") })), [transports]);
}

/* ---------------- small inputs ---------------- */
export function Text(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("field-input", props.className)} />;
}
export function Money({ value, onChange, placeholder = "0", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return <input type="number" inputMode="decimal" className={cn("field-input tabular-nums", className)} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}
export function Select({ value, onChange, options, className }: { value: string; onChange: (v: string) => void; options: (string | { value: string; label: string })[]; className?: string }) {
  return (
    <select className={cn("field-input", className)} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => typeof o === "string" ? <option key={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
export function TotalLine({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between py-1 text-sm", strong && "mt-1 border-t border-neutral-100 pt-2 text-base font-extrabold")}>
      <span className="text-neutral-500">{label}</span><span className="tabular-nums">{value}</span>
    </div>
  );
}
export const n = (v: string | number | undefined) => Number(v) || 0;

/* ---------------- copy ---------------- */
export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch { /* nothing else to try */ }
    ta.remove();
  }
}

/* ---------------- the message panel ---------------- */
// build() returns the text, or a string starting with "!" to show as a warning
export function MessagePanel({ type, customer, build, inputs, onGenerated, title = "Message" }: {
  type: string; customer: Customer | null; build: () => string; inputs: Record<string, unknown>;
  onGenerated?: (text: string) => void; title?: string;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  function generate() {
    const t = build();
    if (t.startsWith("!")) { toast(t.slice(1)); return; }
    setText(t);
    onGenerated?.(t);
    logMessage(type, customer, t, inputs).catch((e) => toast("Message not saved to history: " + (e as Error).message));
  }
  async function copy() {
    if (!text) { toast("Click Generate first to build the message."); return; }
    await copyText(text);
    logEvent("message-copied", { type, customerName: customer?.name || "", mobile: customer?.mobile || "" }).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  }
  async function whatsapp() {
    if (!customer) { toast("Please select a customer first."); return; }
    if (!text) { toast("Click Generate first to build the message."); return; }
    if (!customer.mobile) { toast("This customer has no mobile number saved. Add one from the Customers page."); return; }
    // copy + open a plain chat: wa.me's ?text= can spoil emoji on some phones
    await copyText(text);
    logEvent("whatsapp-opened", { type, customerName: customer.name, mobile: customer.mobile }).catch(() => {});
    window.open("https://wa.me/" + waNumber(customer.mobile), "_blank");
    toast("Message copied — paste it (long-press → Paste) into the chat that just opened.");
  }

  return (
    <Card className="flex flex-col gap-4 lg:sticky lg:top-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold tracking-wide text-neutral-500 uppercase">{title}</h3>
        <MovingBorderButton
          borderRadius="0.85rem" duration={3200} onClick={generate}
          containerClassName="h-10 w-auto"
          borderClassName="bg-[radial-gradient(#6366f1_40%,transparent_60%)] opacity-90"
          className="gap-1.5 border-neutral-200 bg-white px-4 text-sm font-bold text-brand-700"
        >
          <IconSparkles size={16} /> Generate
        </MovingBorderButton>
      </div>
      <div className="min-h-48 rounded-2xl bg-[#e7ddd3] bg-[radial-gradient(rgba(0,0,0,0.04)_1px,transparent_1px)] [background-size:12px_12px] p-3">
        {text ? (
          <motion.div key={text} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className="ml-auto max-w-[95%] rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-neutral-900 shadow-sm">
            {text}
          </motion.div>
        ) : (
          <div className="flex h-44 items-center justify-center text-center text-sm text-neutral-500">Fill in the details, then press Generate.</div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={copy}>{copied ? <><IconCheck size={18} /> Copied</> : <><IconCopy size={18} /> Copy</>}</Button>
        <Button variant="whatsapp" onClick={whatsapp}><IconBrandWhatsapp size={18} /> WhatsApp</Button>
      </div>
    </Card>
  );
}

/* ---------------- Tally balances ---------------- */
function balanceOf(set: BalanceSet | undefined, c: Customer) {
  const v = set?.balances?.[normalizeName(c.name)];
  return v === undefined ? null : v;
}
// what to fill in for this customer from the last Tally import
export function useTallyFill() {
  const { balances } = useStore();
  return (c: Customer | null) => {
    const others: Record<string, number | null> = {};
    if (!c) return { business: null, cash: null, others, note: "" };
    const business = balanceOf(balances.business, c), cash = balanceOf(balances.cash, c);
    // companies added in the Windows app (every balances document except business, cash and the status note)
    for (const k of Object.keys(balances)) if (k !== "business" && k !== "cash" && k !== "status") others[k] = balanceOf(balances[k], c);
    if (business === null && cash === null && Object.values(others).every((v) => v === null)) {
      return { business, cash, others, note: Object.keys(balances).length ? "No Tally balance on file for this customer — enter it manually." : "" };
    }
    const times = Object.keys(balances).filter((k) => k !== "status").map((k) => balances[k]?.importedAt).filter(Boolean).sort() as string[];
    const age = times.length ? new Date(times[0]).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    return { business, cash, others, note: "📒 Balances filled in from Tally (imported " + age + "). Check before sending." };
  };
}
export function BalanceNote({ note }: { note: string }) {
  if (!note) return null;
  return <p className={cn("mt-2 rounded-lg px-3 py-2 text-xs font-medium", note.startsWith("📒") ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800")}>{note}</p>;
}

/* ---------------- page layout: form on the left, message on the right ---------------- */
export function TwoColumn({ form, message }: { form: ReactNode; message: ReactNode }) {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="space-y-5">{form}</div>
      <div>{message}</div>
    </div>
  );
}

export function RowRemove({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-rose-50 hover:text-rose-600" title="Remove">
      <IconX size={16} />
    </button>
  );
}
