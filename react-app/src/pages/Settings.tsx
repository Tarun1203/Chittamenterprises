// Settings: business details, UPI IDs, bank accounts, payment modes, Tally
// balances (import + status), backup download / restore, and app details.
import { useEffect, useMemo, useRef, useState } from "react";
import { IconDeviceFloppy, IconDownload, IconPlus, IconStar, IconStarFilled, IconUpload, IconX } from "@tabler/icons-react";
import { Button, Card, Field, PageHeader, useToast } from "@/components/kit";
import { RowRemove, Text } from "@/components/forms";
import { useStore } from "@/lib/store";
import { logEvent, normalizeName, saveBalances, saveRecords, saveSettings, type Settings as S } from "@/lib/data";
import { parseTallyBalances } from "@/lib/tally";
import { decodeFileText, todayISO } from "@/lib/format";
import { msgDate } from "@/lib/messages";
import { APP_UPDATED, APP_VERSION } from "@/version";
import { cn } from "@/lib/utils";
import { firebaseProjectId } from "@/lib/firebase";

type Upi = S["upiList"][number];
type Bank = S["bankList"][number];

function Section({ title, subtitle, children, action }: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}
function DefaultToggle({ on, onClick }: { on?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex h-11 shrink-0 items-center gap-1 rounded-xl border px-3 text-xs font-bold", on ? "border-amber-300 bg-amber-50 text-amber-700" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50")}>
      {on ? <IconStarFilled size={14} /> : <IconStar size={14} />} Default
    </button>
  );
}

export function Settings() {
  const { settings, settingsLoaded, customers, products, transports, orders, services, receipts, balances, user } = useStore();
  const toast = useToast();
  const [f, setF] = useState<S>(settings);
  const [mode, setMode] = useState("");
  const restoreRef = useRef<HTMLInputElement>(null);
  const balRef = useRef<HTMLInputElement>(null);
  const [balCompany, setBalCompany] = useState<"business" | "cash">("business");
  // reload the form when the saved settings arrive / change on another device
  useEffect(() => { setF(settings); }, [settings]);

  const setUpi = (i: number, p: Partial<Upi>) => setF((x) => ({ ...x, upiList: x.upiList.map((u, j) => (j === i ? { ...u, ...p } : u)) }));
  const setBank = (i: number, p: Partial<Bank>) => setF((x) => ({ ...x, bankList: x.bankList.map((b, j) => (j === i ? { ...b, ...p } : b)) }));
  const upiRows = f.upiList.length ? f.upiList : [{ upiId: "", payeeName: "" }];
  const bankRows = f.bankList.length ? f.bankList : [{ label: "", accountNo: "", ifsc: "", bankBranch: "" }];

  async function save() {
    const next: S = {
      businessName: f.businessName.trim() || "Chittam Enterprises",
      address: f.address.trim(),
      upiList: upiRows.filter((u) => u.upiId.trim()).map((u) => ({ upiId: u.upiId.trim(), payeeName: (u.payeeName || "").trim(), isDefault: !!u.isDefault })),
      bankList: bankRows.filter((b) => b.accountNo.trim() || (b.ifsc || "").trim() || (b.bankBranch || "").trim())
        .map((b) => ({ label: (b.label || "").trim(), accountNo: b.accountNo.trim(), ifsc: (b.ifsc || "").trim(), bankBranch: (b.bankBranch || "").trim(), isDefault: !!b.isDefault })),
      paymentModes: f.paymentModes,
    };
    try { await saveSettings(next, settingsLoaded ? settings : null); toast("Settings saved."); }
    catch (e) { toast("Could not save: " + (e as Error).message); }
  }

  /* ---------- Tally balances ---------- */
  const customerKeys = useMemo(() => new Set(customers.map((c) => normalizeName(c.name))), [customers]);
  async function importBalances(file: File) {
    try {
      const rows = parseTallyBalances(decodeFileText(await file.arrayBuffer()));
      if (!rows.length) throw new Error("no balances found");
      const map: Record<string, number> = {}, names: Record<string, string> = {};
      let matched = 0;
      const unmatched: string[] = [];
      rows.forEach((r) => {
        const k = normalizeName(r.name);
        map[k] = r.amount; names[k] = r.name;
        if (customerKeys.has(k)) matched++; else unmatched.push(r.name);
      });
      const label = balCompany === "business" ? settings.businessName || "Chittam Enterprises" : "Cash Bill";
      await saveBalances(balCompany, {
        company: balCompany, label, file: file.name, importedAt: new Date().toISOString(), importedBy: user?.email || "",
        matched, unmatched: unmatched.slice(0, 300), balances: map, names,
      });
      toast(label + ": balances updated for " + matched + " customer" + (matched === 1 ? "" : "s") + (unmatched.length ? " (" + unmatched.length + " other names kept)" : "") + ".");
    } catch (e) {
      toast("Couldn't read balances from that file (" + (e as Error).message + "). Export Group Summary → Sundry Debtors, Detailed, as JSON or XML.");
    }
  }

  /* ---------- backup ---------- */
  function downloadBackup() {
    const data = { app: "chittam-message-generator", exportedAt: new Date().toISOString(), customers, products, transports, orders, services, receipts, settings };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = "chittam-backup-" + todayISO() + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    logEvent("backup-export", { customers: customers.length, products: products.length }).catch(() => {});
    toast("Backup downloaded — keep this file somewhere safe.");
  }
  // a restore only adds records that are missing and updates ones that
  // differ; nothing already in the database is removed
  async function restore(file: File) {
    try {
      const data = JSON.parse(decodeFileText(await file.arrayBuffer()));
      if (!data || (!data.customers && !data.products && !data.settings)) throw new Error("bad format");
      const current: Record<string, { id: string }[]> = { customers, products, transports, orders, services, receipts };
      const writes: Parameters<typeof saveRecords>[0] = [];
      let changed = 0;
      for (const coll of Object.keys(current)) {
        for (const item of (data[coll] || []) as { id: string }[]) {
          if (!item?.id) continue;
          const before = current[coll].find((x) => x.id === item.id) || null;
          if (before && JSON.stringify(before) === JSON.stringify({ ...before, ...item })) continue;
          writes.push({ coll, id: item.id, data: { ...(before || {}), ...item }, before }); changed++;
        }
      }
      await saveRecords(writes);
      if (data.settings) await saveSettings({ ...settings, ...data.settings }, settingsLoaded ? settings : null);
      await logEvent("backup-restore", { file: file.name, customers: (data.customers || []).length, products: (data.products || []).length });
      toast("Backup restored — " + changed + " record" + (changed === 1 ? "" : "s") + " added or updated, nothing removed.");
    } catch {
      toast("Couldn't read that file — make sure it's a backup downloaded from this app.");
    }
  }

  const standalone = typeof window !== "undefined" && (matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone);

  return (
    <div>
      <PageHeader icon="setting" eyebrow="App" title="Settings" subtitle="Used in every message. Saved to the database, so every device gets the same settings."
        actions={<Button size="sm" onClick={save}><IconDeviceFloppy size={16} /> Save settings</Button>} />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Section title="Business">
            <Field label="Business name"><Text value={f.businessName} onChange={(e) => setF((x) => ({ ...x, businessName: e.target.value }))} /></Field>
            <Field label="Address" hint="Added after the name at the end of messages"><Text value={f.address} onChange={(e) => setF((x) => ({ ...x, address: e.target.value }))} placeholder="e.g. Raichur" /></Field>
          </Section>

          <Section title="UPI IDs" subtitle="The default one goes in Payment Reminders (or all of them, if none is default)."
            action={<Button size="sm" variant="secondary" onClick={() => setF((x) => ({ ...x, upiList: [...upiRows, { upiId: "", payeeName: "" }] }))}><IconPlus size={15} /> UPI</Button>}>
            {upiRows.map((u, i) => (
              <div key={i} className="flex flex-wrap gap-2 sm:flex-nowrap">
                <Text className="min-w-0 flex-1" placeholder="UPI ID e.g. 8151835682-3@axl" value={u.upiId} onChange={(e) => (f.upiList.length ? setUpi(i, { upiId: e.target.value }) : setF((x) => ({ ...x, upiList: [{ ...u, upiId: e.target.value }] })))} />
                <Text className="min-w-0 flex-1" placeholder="Payee name" value={u.payeeName || ""} onChange={(e) => (f.upiList.length ? setUpi(i, { payeeName: e.target.value }) : setF((x) => ({ ...x, upiList: [{ ...u, payeeName: e.target.value }] })))} />
                <DefaultToggle on={u.isDefault} onClick={() => setF((x) => ({ ...x, upiList: upiRows.map((r, j) => ({ ...r, isDefault: j === i })) }))} />
                <RowRemove onClick={() => setF((x) => ({ ...x, upiList: upiRows.filter((_, j) => j !== i) }))} />
              </div>
            ))}
          </Section>

          <Section title="Bank accounts" subtitle="Shown in Payment Reminders."
            action={<Button size="sm" variant="secondary" onClick={() => setF((x) => ({ ...x, bankList: [...bankRows, { label: "", accountNo: "", ifsc: "", bankBranch: "" }] }))}><IconPlus size={15} /> Account</Button>}>
            {bankRows.map((b, i) => {
              const upd = (p: Partial<Bank>) => (f.bankList.length ? setBank(i, p) : setF((x) => ({ ...x, bankList: [{ ...b, ...p }] })));
              return (
                <div key={i} className="space-y-2 rounded-xl border border-neutral-100 bg-neutral-50/60 p-3">
                  <div className="flex gap-2">
                    <Text className="flex-1" placeholder="Label (optional, e.g. Current A/C)" value={b.label || ""} onChange={(e) => upd({ label: e.target.value })} />
                    <DefaultToggle on={b.isDefault} onClick={() => setF((x) => ({ ...x, bankList: bankRows.map((r, j) => ({ ...r, isDefault: j === i })) }))} />
                    <RowRemove onClick={() => setF((x) => ({ ...x, bankList: bankRows.filter((_, j) => j !== i) }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Text placeholder="Account No." value={b.accountNo} onChange={(e) => upd({ accountNo: e.target.value })} />
                    <Text placeholder="IFSC" value={b.ifsc || ""} onChange={(e) => upd({ ifsc: e.target.value })} />
                  </div>
                  <Text placeholder="Bank name & branch, e.g. Indian Bank, Vasavi Nagar Branch, Raichur" value={b.bankBranch || ""} onChange={(e) => upd({ bankBranch: e.target.value })} />
                </div>
              );
            })}
          </Section>

          <Section title="Payment modes" subtitle="The choices on Payment Updated and Payments Received.">
            <div className="flex flex-wrap gap-2">
              {f.paymentModes.map((m, i) => (
                <span key={m + i} className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white py-1 pr-1 pl-3 text-sm font-medium">
                  {m}
                  <button onClick={() => setF((x) => ({ ...x, paymentModes: x.paymentModes.filter((_, j) => j !== i) }))} className="rounded-full p-1 text-neutral-400 hover:bg-rose-50 hover:text-rose-600" aria-label={"Remove " + m}><IconX size={13} /></button>
                </span>
              ))}
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = mode.trim(); if (v) { setF((x) => ({ ...x, paymentModes: [...x.paymentModes, v] })); setMode(""); } }}>
              <Text className="flex-1" value={mode} onChange={(e) => setMode(e.target.value)} placeholder="Add a mode, e.g. NEFT" />
              <Button type="submit" variant="secondary"><IconPlus size={16} /> Add</Button>
            </form>
          </Section>
          <Button className="w-full lg:hidden" onClick={save}><IconDeviceFloppy size={16} /> Save settings</Button>
        </div>

        <div className="space-y-5">
          <Section title="Tally balances" subtitle="Fill in balances on Payment Updated, Payment Reminder and Balance Confirmation. The Windows app updates these by itself; you can also import a file.">
            {(["business", "cash"] as const).map((co) => {
              const e = balances[co];
              const keys = Object.keys(e?.balances || {});
              const matched = keys.filter((k) => customerKeys.has(k)).length;
              const unmatched = keys.filter((k) => !customerKeys.has(k)).map((k) => e?.names?.[k] || k).sort();
              const label = co === "business" ? settings.businessName || "Chittam Enterprises" : "Cash Bill";
              return (
                <div key={co} className="rounded-xl border border-neutral-100 bg-neutral-50/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold">{co === "business" ? "🏢 " : "💵 "}{label}</span>
                    <Button size="sm" variant="secondary" onClick={() => { setBalCompany(co); balRef.current?.click(); }}><IconUpload size={15} /> Import file</Button>
                  </div>
                  <p className="mt-1.5 text-sm text-neutral-600">
                    {!e ? "Not imported yet." : (/^Auto from Tally/.test(e.file || "") ? "🔄 Synced automatically from Tally" : "✓ Imported from file") + " · " +
                      (e.importedAt ? new Date(e.importedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "") + " · " + matched + " customers"}
                  </p>
                  {unmatched.length > 0 && (
                    <details className="mt-1 text-xs text-neutral-500">
                      <summary className="cursor-pointer">{unmatched.length} names not in Customers (includes Tally group names) — add a customer with the same name and the balance fills in</summary>
                      <p className="mt-1 max-h-40 overflow-y-auto">{unmatched.join(", ")}</p>
                    </details>
                  )}
                </div>
              );
            })}
            <input ref={balRef} type="file" accept=".json,.xml,application/json,text/xml" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) importBalances(file); e.target.value = ""; }} />
          </Section>

          <Section title="Backup" subtitle="Everything is already in the database. A backup file is an extra copy you keep yourself.">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={downloadBackup}><IconDownload size={16} /> Download backup</Button>
              <Button variant="secondary" onClick={() => restoreRef.current?.click()}><IconUpload size={16} /> Restore from backup</Button>
            </div>
            <p className="text-xs text-neutral-500">Restoring adds missing records and updates changed ones. It never removes anything.</p>
            <input ref={restoreRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) restore(file); e.target.value = ""; }} />
          </Section>

          <Section title="About this app">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-neutral-500">Version</dt><dd className="font-semibold">{APP_VERSION}</dd>
              <dt className="text-neutral-500">Last updated</dt><dd className="font-semibold">{msgDate(APP_UPDATED)}</dd>
              <dt className="text-neutral-500">Running as</dt><dd className="font-semibold">{standalone ? "Installed app" : "Website"}</dd>
              <dt className="text-neutral-500">Database</dt><dd className="font-semibold">{firebaseProjectId}</dd>
              <dt className="text-neutral-500">Signed in as</dt><dd className="truncate font-semibold">{user?.email}</dd>
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}
