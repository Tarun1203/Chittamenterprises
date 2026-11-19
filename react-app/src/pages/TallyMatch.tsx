// Tally Match: do the app's payments agree with Tally? Matches each payment
// with Tally's receipt vouchers, lists what is missing on either side, points
// out possible duplicate transactions, and shows every customer's Tally
// balance (and names that don't match between the app and Tally).
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { IconAlertTriangle, IconCheck, IconFileText, IconLink, IconLinkOff, IconPlus, IconRefresh, IconSend, IconSettings, IconUserQuestion, IconX } from "@tabler/icons-react";
import { Button, Card, Dialog, EmptyState, Field, PageHeader, useToast } from "@/components/kit";
import { CustomerPicker, Select, Text } from "@/components/forms";
import { useStore } from "@/lib/store";
import { loadLatest, loadTallyVouchers, normalizeName, saveRecord, uid, type Customer, type MessageEntry, type Receipt, type TallyVoucherSet } from "@/lib/data";
import { appDuplicates, appPayments, isReceipt, matchPayments, matchSales, type SentMessage, type SalesResult, tallyDuplicates, tallyEntries, DAY_WINDOW, viaKind, type Account, type AppPayment, type Pair, type TallyEntry } from "@/lib/tallymatch";
import { desktopPost, desktopSend, inDesktopApp, useDesktopReply, useDesktopStatus } from "@/lib/desktop";
import { msgDate } from "@/lib/messages";
import { inr, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Chip } from "./ReceiptsReport";
import { TallyFreshness } from "@/components/TallyFreshness";


const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
type Tab = "payments" | "duplicates" | "sales" | "balances";

export function TallyMatch() {
  const { receipts, balances, settings, orders } = useStore();
  const [messages, setMessages] = useState<SentMessage[] | null>(null);
  const toast = useToast();
  const [sets, setSets] = useState<Record<string, TallyVoucherSet> | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("payments");
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayISO());
  const [account, setAccount] = useState<"" | Account>("");
  const biz = settings.businessName || "Chittam Enterprises";
  const accLabel = (a: Account) => (a === "business" ? biz : "Cash");

  async function load() {
    setError("");
    try {
      // local development only (left out of the published build)
      if (import.meta.env.DEV && new URLSearchParams(location.search).has("demo")) {
        const d = await import("@/lib/demo");
        setSets(d.demoTallyVouchers);
        setMessages(toSent(d.demoMessages));
      } else {
        setSets(await loadTallyVouchers());
        // the latest messages, for Dispatch / Stock Return vs Tally
        loadLatest<MessageEntry>("messages", 500).then((m) => setMessages(toSent(m))).catch(() => setMessages([]));
      }
    } catch (e) { setError((e as Error).message); setSets({}); }
  }
  useEffect(() => { load(); }, []);

  const result = useMemo(() => {
    if (!sets) return null;
    const app = appPayments(receipts, from, to).filter((p) => !account || p.account === account);
    const tallyReceipts = tallyEntries(sets, from, to, isReceipt).filter((v) => !account || v.account === account);
    const all = tallyEntries(sets, from, to).filter((v) => !account || v.account === account);
    return {
      match: matchPayments(app, tallyReceipts),
      tallyDups: tallyDuplicates(all),
      appDups: account ? [] : appDuplicates(receipts, from, to),
      sales: messages ? matchSales(tallyEntries(sets, from, to), messages, orders.map((o) => ({ id: o.id, orderNo: o.orderNo, customerName: o.customerName, date: o.date, status: o.status, total: o.total })), from, to) : null,
    };
  }, [sets, receipts, from, to, account, messages, orders]);

  const hasVouchers = !!sets && Object.values(sets).some((s) => s.vouchers?.length);
  const dupCount = result ? result.tallyDups.length + result.appDups.length : 0;

  return (
    <div>
      <PageHeader icon="star" eyebrow="Tally" title="Tally Match" subtitle="Check that payments in the app agree with Tally, find possible duplicate entries, and see every customer's Tally balance."
        actions={<Button variant="secondary" size="sm" onClick={() => { load(); toast("Reloaded Tally transactions."); }}><IconRefresh size={16} /> Reload</Button>} />

      {inDesktopApp() && <DesktopSyncCard />}
      <TallyFreshness className="mb-3" />
      <SyncInfo sets={sets} accLabel={accLabel} balancesAt={[balances.business?.importedAt, balances.cash?.importedAt]} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-xl bg-neutral-200/60 p-1">
          {([["payments", "Payments"], ["duplicates", "Duplicates" + (dupCount ? " (" + dupCount + ")" : "")], ["sales", "Sales & returns"], ["balances", "Balances"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)} className={cn("rounded-lg px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap", tab === v ? "bg-white shadow-sm" : "text-neutral-500")}>{l}</button>
          ))}
        </div>
      </div>

      {tab !== "balances" && (
        <Card className="mb-4 grid gap-3 sm:grid-cols-3">
          <Field label="From"><Text type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Text type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Account"><Select value={account} onChange={(v) => setAccount(v as "" | Account)} options={[{ value: "", label: "Both accounts" }, { value: "business", label: biz }, { value: "cash", label: "Cash" }]} /></Field>
        </Card>
      )}

      {error && <Card className="mb-4 text-sm text-rose-700">Could not load Tally transactions: {error}</Card>}
      {tab !== "balances" && sets && !hasVouchers && !error && (
        <EmptyState icon="star" title="No Tally transactions yet" text="They come from the Windows app on the Tally PC (version 2.0): open Tally Sync and tick “Also send transactions”. Payments and duplicates in the app can still be checked." />
      )}

      {tab === "payments" && result && <PaymentsView r={result.match} accLabel={accLabel} hasVouchers={hasVouchers} />}
      {tab === "duplicates" && result && <DuplicatesView tally={result.tallyDups} app={result.appDups} accLabel={accLabel} />}
      {tab === "sales" && result && hasVouchers && (result.sales ? <SalesView r={result.sales} accLabel={accLabel} /> : <Card className="text-center text-sm text-neutral-500">Loading messages…</Card>)}
      {tab === "balances" && <BalancesView />}
      {!result && !error && <Card className="text-center text-sm text-neutral-500">Loading…</Card>}
    </div>
  );
}

/* ---------------- Windows app status ---------------- */
function DesktopSyncCard() {
  const st = useDesktopStatus();
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-4 border-brand-100 bg-gradient-to-br from-white to-brand-50/50">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold tracking-[0.14em] text-brand-600 uppercase">This PC · Tally Sync</p>
        {!st ? <p className="text-sm text-neutral-500">Checking…</p> : (
          <>
            <p className="mt-0.5 flex items-center gap-2 font-bold">
              <span className={cn("h-2 w-2 rounded-full", !st.configured || st.error ? "bg-amber-400" : "bg-emerald-500")} />
              {!st.configured ? "Not set up yet" : st.busy ? "Syncing with Tally…" : st.error ? "Last try failed: " + st.error : "Next check " + st.nextSync}
            </p>
            <div className="mt-1 space-y-0.5 text-xs text-neutral-500">
              {st.update && <div className="font-semibold text-brand-700">⬆ {st.update}</div>}
              {st.companies.map((c) => <div key={c.key}><strong className="text-neutral-700">{c.label}</strong> ({c.company}) · {c.balances || "balances not sent yet"}{st.syncVouchers && c.vouchers ? " · " + c.vouchers.replace(/^.*· /, "") : ""}</div>)}
            </div>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => desktopSend("tally-sync-now")} disabled={st?.busy}><IconRefresh size={15} className={cn(st?.busy && "animate-spin")} /> Sync now</Button>
        <Button size="sm" variant="secondary" onClick={() => desktopSend("tally-settings")}><IconSettings size={15} /> Sync settings</Button>
        <Button size="sm" variant="ghost" onClick={() => desktopSend("tally-log")}><IconFileText size={15} /> Log</Button>
      </div>
    </Card>
  );
}

function SyncInfo({ sets, accLabel, balancesAt }: { sets: Record<string, TallyVoucherSet> | null; accLabel: (a: Account) => string; balancesAt: (string | undefined)[] }) {
  if (!sets) return null;
  const parts = (["business", "cash"] as Account[]).map((a, i) => {
    const s = sets[a];
    return accLabel(a) + ": " + (s?.syncedAt ? s.count + " transactions " + msgDate(s.from) + " – " + msgDate(s.to) + " (sent " + when(s.syncedAt) + ")" : "no transactions") +
      (balancesAt[i] ? " · balances " + when(balancesAt[i]) : "");
  });
  return <p className="mb-4 text-xs text-neutral-500">{parts.join("   ·   ")}</p>;
}

/* ---------------- payments vs Tally ---------------- */
function Row({ left, right, sub, tone, note, actions }: { left: React.ReactNode; right: React.ReactNode; sub?: React.ReactNode; tone?: "ok" | "warn" | "bad"; note?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", tone === "ok" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-400" : tone === "bad" ? "bg-rose-500" : "bg-neutral-300")} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{left}</div>
        {sub && <div className="text-xs text-neutral-500">{sub}</div>}
        {note && <div className="mt-1 text-xs font-semibold text-amber-700">{note}</div>}
        {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="text-right font-bold tabular-nums">{right}</div>
    </div>
  );
}
function Section({ title, hint, count, tone, children }: { title: string; hint: string; count: number; tone: "ok" | "warn" | "bad"; children: React.ReactNode }) {
  const [open, setOpen] = useState(tone !== "ok");
  return (
    <Card className="mb-4 p-0">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div>
          <div className="flex items-center gap-2 font-extrabold">
            {tone === "ok" || count === 0 ? <IconCheck size={18} className="text-emerald-600" /> : <IconAlertTriangle size={18} className={tone === "warn" ? "text-amber-500" : "text-rose-500"} />}
            {title} <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">{count}</span>
          </div>
          <p className="mt-0.5 text-xs text-neutral-500">{count === 0 && tone !== "ok" ? "None — all clear." : hint}</p>
        </div>
        {count > 0 && <span className="text-xs font-semibold text-brand-600">{open ? "Hide" : "Show"}</span>}
      </button>
      {open && count > 0 && <div className="divide-y divide-neutral-100 border-t border-neutral-100">{children}</div>}
    </Card>
  );
}
const appSub = (p: AppPayment, accLabel: (a: Account) => string) => msgDate(p.date) + " · " + accLabel(p.account) + " · " + p.mode + " · " + p.source + (p.ref ? " " + p.ref : "") + (p.tallyNo ? " · linked to Tally #" + p.tallyNo : "");
const tallySub = (t: TallyEntry, accLabel: (a: Account) => string) => msgDate(t.d) + " · " + accLabel(t.account) + " · " + t.t + (t.n ? " #" + t.n : "") + (t.via ? " · booked to " + t.via : "") + (t.nar ? " · " + t.nar : "");
const tallyRef = (t: TallyEntry) => "Tally " + t.t + (t.n ? " #" + t.n : "") + " on " + msgDate(t.d) + (t.via ? " (" + t.via + ")" : "");
const ActionBtn = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick} className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700 hover:bg-brand-100">{children}</button>
);

function PaymentsView({ r, accLabel, hasVouchers }: { r: ReturnType<typeof matchPayments>; accLabel: (a: Account) => string; hasVouchers: boolean }) {
  const { receipts, settings } = useStore();
  const toast = useToast();
  const [record, setRecord] = useState<TallyEntry | null>(null);
  const [link, setLink] = useState<AppPayment | null>(null);
  const [post, setPost] = useState<AppPayment | null>(null);
  if (!hasVouchers) return null;
  const sum = (xs: { amount?: number; a?: number }[]) => xs.reduce((t, x) => t + (x.amount ?? x.a ?? 0), 0);
  const modes = settings.paymentModes.length ? settings.paymentModes : ["Cash", "UPI", "Bank Transfer", "Cheque"];
  const cashMode = modes.find((m) => /cash/i.test(m)) || "Cash";
  const bankMode = modes.find((m) => /upi/i.test(m)) || modes.find((m) => !/cash/i.test(m)) || "UPI";

  // change the app's payment to the way Tally booked it
  async function useTallyMode(p: Pair) {
    const before = receipts.find((x) => x.id === p.app.receiptId);
    if (!before) return;
    const mode = viaKind(p.tally.via) === "cash" ? cashMode : bankMode;
    try { await saveRecord("receipts", { ...before, mode, tallyNo: p.tally.n || before.tallyNo || "", tallyId: p.tally.id || before.tallyId || "" }, before); toast("Payment changed to " + mode + "."); }
    catch (e) { toast("Could not save: " + (e as Error).message); }
  }
  // a payment entered twice: cancel the extra one (never deleted; it can be un-cancelled in Payments Received)
  async function cancelPayment(p: AppPayment) {
    const before = receipts.find((x) => x.id === p.receiptId);
    if (!before) return;
    if (!window.confirm("Cancel this " + inr(p.amount) + " payment of " + p.name + " (" + msgDate(p.date) + ")? It stays in Payments Received, marked cancelled.")) return;
    try { await saveRecord("receipts", { ...before, cancelled: true }, before); toast("Payment cancelled. It's kept in Payments Received, left out of totals."); }
    catch (e) { toast("Could not save: " + (e as Error).message); }
  }
  async function unlink(p: AppPayment) {
    const before = receipts.find((x) => x.id === p.receiptId);
    if (!before) return;
    try { await saveRecord("receipts", { ...before, tallyNo: "", tallyId: "" }, before); toast("Unlinked from the Tally voucher."); }
    catch (e) { toast("Could not save: " + (e as Error).message); }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Chip strong label="Matched" value={r.matched.length + " · " + inr(sum(r.matched.map((m) => m.app)))} />
        <Chip label="Details differ" value={String(r.detailsDiffer.length)} />
        <Chip label="Name differs" value={String(r.nameDiffers.length)} />
        {r.recordedTwice.length > 0 && <Chip label="Recorded twice" value={r.recordedTwice.length + " · " + inr(sum(r.recordedTwice.map((d) => d.app)))} />}
        <Chip label="Not in Tally" value={r.onlyApp.length + " · " + inr(sum(r.onlyApp))} />
        <Chip label="Not in app" value={r.onlyTally.length + " · " + inr(sum(r.onlyTally))} />
      </div>
      {r.recordedTwice.length > 0 && (
        <Section title="Recorded twice in the app" hint="The Tally receipt for these is already matched to another payment of the same customer, so each is most likely the same payment entered twice. Cancel the extra one (it stays in the records, left out of totals)." count={r.recordedTwice.length} tone="bad">
          {r.recordedTwice.map(({ app: p, other }) => <Row key={p.key} tone="bad" left={p.name} sub={appSub(p, accLabel)} right={inr(p.amount)}
            note={"Same as the payment of " + msgDate(other.app.date) + " (" + other.app.mode + " · " + other.app.source + (other.app.ref ? " " + other.app.ref : "") + "), already matched to " + tallyRef(other.tally) + "."}
            actions={<>
              <ActionBtn onClick={() => cancelPayment(p)}><IconX size={13} /> Cancel this payment</ActionBtn>
              <ActionBtn onClick={() => setLink(p)}><IconLink size={13} /> Link to another voucher</ActionBtn>
            </>} />)}
        </Section>
      )}
      <Section title="Recorded in the app, not found in Tally" hint={"No receipt in Tally for the same customer and amount within " + DAY_WINDOW + " days. Enter it in Tally, or link it to the right voucher by its number."} count={r.onlyApp.length} tone="bad">
        {r.onlyApp.map((p) => <Row key={p.key} tone="bad" left={p.name} sub={appSub(p, accLabel)} right={inr(p.amount)}
          actions={<>
            <ActionBtn onClick={() => setLink(p)}><IconLink size={13} /> Link to Tally voucher</ActionBtn>
            {inDesktopApp() && <ActionBtn onClick={() => setPost(p)}><IconSend size={13} /> Post to Tally</ActionBtn>}
          </>} />)}
      </Section>
      <Section title="In Tally, not recorded in the app" hint="A Tally receipt with no payment in the app. Record it in the app (the voucher number is saved with it), or link an existing payment to it." count={r.onlyTally.length} tone="warn">
        {r.onlyTally.map((t) => <Row key={t.key} tone="warn" left={t.p} sub={tallySub(t, accLabel)} right={inr(t.a)}
          actions={<ActionBtn onClick={() => setRecord(t)}><IconPlus size={13} /> Record in app</ActionBtn>} />)}
      </Section>
      <Section title="Matched, but details differ" hint="The same payment in both, but paid differently (UPI vs Cash), another amount, or dates far apart. Correct the voucher in Tally, or change the app to match." count={r.detailsDiffer.length} tone="warn">
        {r.detailsDiffer.map((m) => <Row key={m.app.key} tone="warn" left={m.app.name} sub={appSub(m.app, accLabel) + "  ·  " + tallyRef(m.tally)} right={inr(m.app.amount)}
          note={m.differs.join(" · ")}
          actions={<>
            {m.differs.some((d) => d.startsWith("Paid by")) && <ActionBtn onClick={() => useTallyMode(m)}><IconCheck size={13} /> Change app to {viaKind(m.tally.via) === "cash" ? cashMode : bankMode}</ActionBtn>}
            {m.byVoucher && <ActionBtn onClick={() => unlink(m.app)}><IconLinkOff size={13} /> Unlink</ActionBtn>}
          </>} />)}
      </Section>
      <Section title="Same amount and date, but the name differs" hint="Probably the same payment, with the customer named differently in the app and in Tally. Make the names match so balances fill in too." count={r.nameDiffers.length} tone="warn">
        {r.nameDiffers.map((m) => <Row key={m.app.key} tone="warn" left={<>{m.app.name} <span className="font-normal text-neutral-400">↔</span> {m.tally.p}</>} sub={appSub(m.app, accLabel) + "  ·  " + tallyRef(m.tally)} right={inr(m.app.amount)} />)}
      </Section>
      <Section title="Matched" hint="Same payment in the app and in Tally (linked by voucher number, or same customer and amount)." count={r.matched.length} tone="ok">
        {r.matched.map((m) => <Row key={m.app.key} tone="ok" left={m.app.name} sub={appSub(m.app, accLabel) + "  ·  " + tallyRef(m.tally)} right={inr(m.app.amount)}
          actions={m.byVoucher ? <ActionBtn onClick={() => unlink(m.app)}><IconLinkOff size={13} /> Unlink</ActionBtn> : undefined} />)}
      </Section>

      <RecordDialog entry={record} onClose={() => setRecord(null)} accLabel={accLabel} modes={modes} cashMode={cashMode} bankMode={bankMode} />
      <LinkDialog payment={link} onClose={() => setLink(null)} candidates={r.onlyTally} accLabel={accLabel} />
      <PostDialog payment={post} onClose={() => setPost(null)} accLabel={accLabel} />
    </div>
  );
}

// a Tally receipt that isn't in the app → a payment in Payments Received, linked to the voucher
function RecordDialog({ entry, onClose, accLabel, modes, cashMode, bankMode }: { entry: TallyEntry | null; onClose: () => void; accLabel: (a: Account) => string; modes: string[]; cashMode: string; bankMode: string }) {
  const { customers } = useStore();
  const toast = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [mode, setMode] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!entry) return;
    setCustomer(customers.find((c) => normalizeName(c.name) === normalizeName(entry.p)) || null);
    setMode(viaKind(entry.via) === "cash" ? cashMode : viaKind(entry.via) === "bank" ? bankMode : modes[0]);
    setNote(entry.nar || "");
    // only when another voucher is opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);
  async function save() {
    if (!entry) return;
    if (!customer) { toast("Pick the customer first."); return; }
    const rec: Receipt = {
      id: "rc_" + uid().slice(2), date: entry.d, customerId: customer.id, customerName: customer.name, mode,
      business: entry.account === "business" ? entry.a : 0, cash: entry.account === "cash" ? entry.a : 0,
      source: "Tally", ref: entry.n || "", note: note.trim(), cancelled: false, tallyNo: entry.n || "", tallyId: entry.id || "",
    };
    try { await saveRecord("receipts", rec, null); toast("Recorded in Payments Received and linked to Tally #" + (entry.n || "") + "."); onClose(); }
    catch (e) { toast("Could not save: " + (e as Error).message); }
  }
  return (
    <Dialog open={!!entry} onClose={onClose} title="Record Tally receipt in the app"
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button onClick={save}>Save payment</Button></>}>
      {entry && <>
        <div className="rounded-xl bg-neutral-50 p-3 text-sm">
          <div className="font-bold">{entry.p} · {inr(entry.a)}</div>
          <div className="text-xs text-neutral-500">{tallySub(entry, accLabel)}</div>
        </div>
        <Field label="Customer in the app"><CustomerPicker value={customer} onPick={setCustomer} /></Field>
        <Field label="Paid by" hint={entry.via ? "Tally has it booked to " + entry.via + ". If the customer paid another way, pick that here and correct the voucher in Tally." : undefined}>
          <Select value={mode} onChange={setMode} options={modes} />
        </Field>
        <Field label="Note"><Text value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>
        <p className="text-xs text-neutral-500">Saved as a {inr(entry.a)} payment to the {accLabel(entry.account)} account on {msgDate(entry.d)}, with voucher number {entry.n || "—"}.</p>
      </>}
    </Dialog>
  );
}

// an app payment -> a Receipt voucher in Tally (Windows app on the Tally PC only).
// The Windows app shows its own confirmation with the whole voucher before creating it.
function PostDialog({ payment, onClose, accLabel }: { payment: AppPayment | null; onClose: () => void; accLabel: (a: Account) => string }) {
  const { balances, receipts } = useStore();
  const toast = useToast();
  const [ledgers, setLedgers] = useState<string[] | null>(null);
  const [into, setInto] = useState("");
  const [narration, setNarration] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const receipt = payment ? receipts.find((x) => x.id === payment.receiptId) : undefined;
  // the customer's ledger as spelled in Tally (from the balance sync)
  const tallyName = payment ? balances[payment.account]?.names?.[normalizeName(payment.name)] || "" : "";
  useEffect(() => {
    if (!payment) return;
    setLedgers(null); setErr(""); setBusy(false);
    setNarration((payment.mode || "") + (payment.ref ? " " + payment.ref : "") + " — recorded in Chittam app" + (receipt?.note ? ": " + receipt.note : ""));
    desktopPost({ type: "tally-cashbank", key: payment.account });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment]);
  useDesktopReply<{ key: string; ledgers: string[]; error?: string }>("tally-cashbank", (d) => {
    if (!payment || d.key !== payment.account) return;
    setLedgers(d.ledgers || []);
    if (d.error) setErr("Couldn't read Tally's cash / bank ledgers: " + d.error);
    const cash = /cash/i.test(payment.mode || "");
    setInto((d.ledgers || []).find((l) => (cash ? /^cash$/i.test(l) : /bank|phone\s*pe|upi|gpay/i.test(l))) || (d.ledgers || [])[0] || "");
  });
  useDesktopReply<{ receiptId: string; ok: boolean; error: string }>("tally-post-result", (d) => {
    if (!payment || d.receiptId !== payment.receiptId) return;
    setBusy(false);
    if (d.ok) { toast("Posted to Tally. It shows as matched after the sync finishes (a few seconds)."); onClose(); }
    else if (d.error !== "Not posted.") setErr(d.error);
  });
  function send() {
    if (!payment || !tallyName || !into) return;
    setBusy(true); setErr("");
    desktopPost({ type: "tally-post-receipt", key: payment.account, date: payment.date, party: tallyName, into, amount: payment.amount, narration, receiptId: payment.receiptId });
  }
  return (
    <Dialog open={!!payment} onClose={onClose} title="Post to Tally"
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button onClick={send} disabled={busy || !tallyName || !into}><IconSend size={16} /> {busy ? "Waiting for confirmation…" : "Post receipt"}</Button></>}>
      {payment && <>
        <div className="rounded-xl bg-neutral-50 p-3 text-sm">
          <div className="font-bold">{payment.name} · {inr(payment.amount)}</div>
          <div className="text-xs text-neutral-500">{appSub(payment, accLabel)}</div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-neutral-500">Company</dt><dd className="font-semibold">{accLabel(payment.account)}</dd>
          <dt className="text-neutral-500">Voucher</dt><dd className="font-semibold">Receipt · {msgDate(payment.date)}</dd>
          <dt className="text-neutral-500">Received from</dt>
          <dd className="font-semibold">{tallyName || <span className="text-rose-600">No ledger named “{payment.name}” in Tally — create it in Tally (or fix the spelling) first.</span>}</dd>
          <dt className="text-neutral-500">Amount</dt><dd className="font-semibold">{inr(payment.amount)}</dd>
        </dl>
        <Field label="Received into (Tally ledger)">
          {ledgers === null ? <p className="text-sm text-neutral-500">Reading Tally's cash and bank ledgers…</p>
            : <Select value={into} onChange={setInto} options={ledgers.length ? ledgers : [{ value: "", label: "No cash / bank ledgers found" }]} />}
        </Field>
        <Field label="Narration"><Text value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
        {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{err}</p>}
        <p className="text-xs text-neutral-500">The Windows app asks you to confirm the whole voucher before it's created. The customer is credited “On Account”; bills can be adjusted in Tally afterwards.</p>
      </>}
    </Dialog>
  );
}

// an app payment → the Tally voucher it belongs to (pick one, or type its number)
function LinkDialog({ payment, onClose, candidates, accLabel }: { payment: AppPayment | null; onClose: () => void; candidates: TallyEntry[]; accLabel: (a: Account) => string }) {
  const { receipts } = useStore();
  const toast = useToast();
  const [no, setNo] = useState("");
  useEffect(() => { setNo(payment?.tallyNo || ""); }, [payment]);
  const list = useMemo(() => !payment ? [] : candidates.filter((t) => t.account === payment.account)
    .map((t) => ({ t, score: (normalizeName(t.p) === normalizeName(payment.name) ? 0 : 10) + Math.min(9, Math.abs(t.a - payment.amount) / Math.max(1, payment.amount) * 10) }))
    .sort((a, b) => a.score - b.score).slice(0, 12).map((x) => x.t), [payment, candidates]);
  async function save(voucherNo: string, tallyId: string) {
    if (!payment) return;
    const before = receipts.find((x) => x.id === payment.receiptId);
    if (!before) return;
    if (!voucherNo.trim()) { toast("Enter the voucher number."); return; }
    try { await saveRecord("receipts", { ...before, tallyNo: voucherNo.trim(), tallyId }, before); toast("Linked to Tally #" + voucherNo.trim() + "."); onClose(); }
    catch (e) { toast("Could not save: " + (e as Error).message); }
  }
  return (
    <Dialog open={!!payment} onClose={onClose} title="Link to a Tally voucher"
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button onClick={() => save(no, "")}>Link by number</Button></>}>
      {payment && <>
        <div className="rounded-xl bg-neutral-50 p-3 text-sm">
          <div className="font-bold">{payment.name} · {inr(payment.amount)}</div>
          <div className="text-xs text-neutral-500">{appSub(payment, accLabel)}</div>
        </div>
        {list.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase">Unmatched Tally receipts ({accLabel(payment.account)})</p>
            <div className="max-h-64 divide-y divide-neutral-100 overflow-y-auto rounded-xl border border-neutral-100">
              {list.map((t) => (
                <button key={t.key} onClick={() => save(t.n || "", t.id || "")} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-brand-50">
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{t.p}</span><span className="block text-xs text-neutral-500">{tallySub(t, accLabel)}</span></span>
                  <span className="text-sm font-bold tabular-nums">{inr(t.a)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Or type the Tally voucher number" hint="Used when the voucher is outside the dates shown, or the number is all you have.">
          <Text value={no} onChange={(e) => setNo(e.target.value)} placeholder="e.g. RCPT/80-2026/27" />
        </Field>
      </>}
    </Dialog>
  );
}

/* ---------------- sales invoices and returns ---------------- */
// a sent message with the date it's about (the form's date, else when it was sent)
function toSent(list: MessageEntry[]): SentMessage[] {
  return list.map((m) => {
    const typed = String((m.inputs as Record<string, unknown> | undefined)?.date || "");
    const at = m.at && typeof m.at.toDate === "function" ? m.at.toDate() : null;
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(typed) ? typed : at ? at.getFullYear() + "-" + String(at.getMonth() + 1).padStart(2, "0") + "-" + String(at.getDate()).padStart(2, "0") : "";
    return { id: m.id, type: m.type, customerName: m.customerName, date: iso, inputs: m.inputs as Record<string, unknown> | undefined };
  }).filter((m) => m.date);
}

function SalesView({ r, accLabel }: { r: SalesResult; accLabel: (a: Account) => string }) {
  const msgSub = (m: SentMessage, key: string, label: string) => msgDate(m.date) + (m.inputs?.[key] ? " · " + label + " " + String(m.inputs[key]) : "");
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Chip label="Tally sales" value={String(r.counts.sales)} />
        <Chip label="Dispatch messages" value={String(r.counts.dispatches)} />
        <Chip label="Tally credit notes" value={String(r.counts.creditNotes)} />
        <Chip label="Stock return messages" value={String(r.counts.returns)} />
      </div>
      <Section title="Invoiced in Tally, no dispatch message sent" hint="A Tally sales invoice with no Dispatch Confirmation to that customer naming it, or within 7 days after it. Send one if the goods have gone." count={r.salesNoDispatch.length} tone="warn">
        {r.salesNoDispatch.map((t) => <Row key={t.key} tone="warn" left={t.p} sub={tallySub(t, accLabel)} right={inr(t.a)} />)}
      </Section>
      <Section title="Orders not invoiced in Tally" hint="Orders marked Packed, Dispatched or Delivered with no Tally sales invoice for that customer from 2 days before to 10 days after the order." count={r.ordersNotInvoiced.length} tone="bad">
        {r.ordersNotInvoiced.map((o) => <Row key={o.id} tone="bad" left={o.customerName} sub={"Order " + o.orderNo + " · " + msgDate(o.date) + " · " + o.status} right={inr(o.total)} />)}
      </Section>
      <Section title="Dispatch message, invoice not found in Tally" hint="A Dispatch Confirmation was sent, but there's no Tally sales invoice for that customer naming it or from just before it. Check the invoice number, or enter the invoice in Tally." count={r.dispatchNotInTally.length} tone="bad">
        {r.dispatchNotInTally.map((m) => <Row key={m.id} tone="bad" left={m.customerName || "—"} sub={msgSub(m, "invoice", "Invoice")} right="" />)}
      </Section>
      <Section title="Credit note in Tally, no stock return message" hint="A Tally credit note with no Stock Return acknowledgement to that customer naming it or within 7 days. Send one so the customer knows it's credited." count={r.creditNoReturnMsg.length} tone="warn">
        {r.creditNoReturnMsg.map((t) => <Row key={t.key} tone="warn" left={t.p} sub={tallySub(t, accLabel)} right={inr(t.a)} />)}
      </Section>
      <Section title="Stock return credited in the app, no credit note in Tally" hint="A Stock Return message said the amount was credited, but there's no Tally credit note for that customer naming it or within 7 days. Enter the credit note in Tally." count={r.returnMsgNoCredit.length} tone="bad">
        {r.returnMsgNoCredit.map((m) => <Row key={m.id} tone="bad" left={m.customerName || "—"} sub={msgSub(m, "cn", "Credit note")} right="" />)}
      </Section>
    </div>
  );
}

/* ---------------- duplicates ---------------- */
function DuplicatesView({ tally, app, accLabel }: { tally: ReturnType<typeof tallyDuplicates>; app: ReturnType<typeof appDuplicates>; accLabel: (a: Account) => string }) {
  if (!tally.length && !app.length) return <EmptyState icon="star" title="No possible duplicates" text={"Nothing with the same customer and amount within " + DAY_WINDOW + " days, in the app or in Tally."} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-500">These look alike — they may be real separate transactions. Check each one before changing anything in Tally.</p>
      {tally.map((g, i) => (
        <Card key={"t" + i} className="p-0">
          <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2.5 text-sm font-bold"><IconAlertTriangle size={16} className="text-amber-500" /> In Tally · {g.why}</div>
          <div className="divide-y divide-neutral-100">{g.items.map((t) => <Row key={t.key} tone="warn" left={t.p} sub={tallySub(t, accLabel) + (t.dr ? " · debit" : " · credit")} right={inr(t.a)} />)}</div>
        </Card>
      ))}
      {app.map((g, i) => (
        <Card key={"a" + i} className="p-0">
          <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2.5 text-sm font-bold"><IconAlertTriangle size={16} className="text-amber-500" /> In the app (Payments Received) · {g.why}</div>
          <div className="divide-y divide-neutral-100">{g.items.map((r: Receipt) => (
            <Row key={r.id} tone="warn" left={r.customerName} right={inr((Number(r.business) || 0) + (Number(r.cash) || 0))}
              sub={msgDate(r.date) + " · " + r.mode + " · " + r.source + (r.ref ? " " + r.ref : "") + (r.note ? " · " + r.note : "") + " — cancel the extra one on Payment Updated → Payments Received"} />
          ))}</div>
        </Card>
      ))}
    </div>
  );
}

/* ---------------- balances ---------------- */
function BalancesView() {
  const { customers, balances, settings } = useStore();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "owes" | "missing">("all");
  const biz = settings.businessName || "Chittam Enterprises";
  const bmap = balances.business?.balances || {}, cmap = balances.cash?.balances || {};
  const names = { ...(balances.cash?.names || {}), ...(balances.business?.names || {}) };

  const rows = useMemo(() => customers.map((c) => {
    const k = normalizeName(c.name);
    const b = bmap[k], cash = cmap[k];
    return { c, b, cash, total: (b || 0) + (cash || 0), inTally: b !== undefined || cash !== undefined };
  }), [customers, bmap, cmap]);
  const customerKeys = useMemo(() => new Set(customers.map((c) => normalizeName(c.name))), [customers]);
  const tallyOnly = useMemo(() => Object.keys({ ...bmap, ...cmap }).filter((k) => !customerKeys.has(k)).map((k) => ({ k, name: names[k] || k, total: (bmap[k] || 0) + (cmap[k] || 0) }))
    .sort((a, b) => b.total - a.total), [bmap, cmap, customerKeys, names]);
  const shown = rows.filter((r) => (filter === "all" || (filter === "owes" ? r.total > 0 : !r.inTally)) && (!q.trim() || r.c.name.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => b.total - a.total || a.c.name.localeCompare(b.c.name));
  const sums = rows.reduce((t, r) => ({ b: t.b + (r.b || 0), c: t.c + (r.cash || 0) }), { b: 0, c: 0 });
  const missing = rows.filter((r) => !r.inTally).length;

  async function addCustomer(name: string) {
    try { await saveRecord("customers", { id: uid(), name, mobile: "" }, null); toast(name + " added to Customers — add the mobile number there."); }
    catch (e) { toast("Could not add: " + (e as Error).message); }
  }

  if (!balances.business && !balances.cash) return <EmptyState icon="star" title="No Tally balances yet" text="They come from the Windows app's Tally Sync, or from Settings → Tally balances → Import file." />;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div>
        <div className="mb-3 flex flex-wrap gap-2">
          <Chip strong label="Total receivable" value={inr(Math.round(sums.b + sums.c))} />
          <Chip label={biz} value={inr(Math.round(sums.b))} />
          <Chip label="Cash" value={inr(Math.round(sums.c))} />
          <Chip label="Customers not in Tally" value={String(missing)} />
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          <Text className="w-full sm:w-auto sm:max-w-xs sm:flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search customer…" />
          <Select className="w-auto" value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[{ value: "all", label: "All customers" }, { value: "owes", label: "Owes money" }, { value: "missing", label: "Not found in Tally" }]} />
        </div>
        <Card className="p-0">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b border-neutral-100 px-4 py-2 text-[11px] font-bold tracking-wide text-neutral-500 uppercase">
            <span>Customer</span><span className="w-20 text-right sm:w-24">{biz.split(" ")[0]}</span><span className="w-20 text-right sm:w-24">Cash</span><span className="w-20 text-right sm:w-24">Total</span>
          </div>
          <div className="max-h-[60vh] divide-y divide-neutral-100 overflow-y-auto">
            {shown.map((r, i) => (
              <motion.div key={r.c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 20) * 0.01 }} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate font-semibold">{r.c.name}{!r.inTally && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">not in Tally</span>}</span>
                <span className="w-20 text-right tabular-nums sm:w-24">{r.b === undefined ? "—" : inr(r.b)}</span>
                <span className="w-20 text-right tabular-nums sm:w-24">{r.cash === undefined ? "—" : inr(r.cash)}</span>
                <span className={cn("w-20 text-right font-bold tabular-nums sm:w-24", r.total < 0 && "text-emerald-700")}>{r.inTally ? inr(r.total) : "—"}</span>
              </motion.div>
            ))}
            {shown.length === 0 && <p className="p-6 text-center text-sm text-neutral-500">No customers match.</p>}
          </div>
        </Card>
        <p className="mt-2 text-xs text-neutral-500">A negative total means the customer has paid in advance. “Not in Tally” usually means the name is spelled differently in Tally.</p>
      </div>
      <Card className="p-0">
        <div className="border-b border-neutral-100 px-4 py-3">
          <div className="flex items-center gap-2 font-extrabold"><IconUserQuestion size={18} className="text-amber-500" /> In Tally, not in Customers <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">{tallyOnly.length}</span></div>
          <p className="mt-0.5 text-xs text-neutral-500">Tally ledgers with no customer of the same name (may include Tally group names). Add one, or rename the customer to match.</p>
        </div>
        <div className="max-h-[60vh] divide-y divide-neutral-100 overflow-y-auto">
          {tallyOnly.map((t) => (
            <div key={t.k} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
              <span className="tabular-nums text-neutral-600">{inr(t.total)}</span>
              <button onClick={() => addCustomer(t.name)} className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2 py-1 text-xs font-bold text-brand-700 hover:bg-brand-100"><IconPlus size={13} /> Add</button>
            </div>
          ))}
          {tallyOnly.length === 0 && <p className="p-6 text-center text-sm text-neutral-500">Every Tally ledger has a customer.</p>}
        </div>
      </Card>
    </div>
  );
}
