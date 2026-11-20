import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { IconArrowBackUp, IconCopy, IconGitMerge, IconPencil, IconPhone, IconPlus, IconTrash, IconUpload } from "@tabler/icons-react";
import { Button, Dialog, EmptyState, Field, PageHeader, useToast } from "@/components/kit";
import { Search } from "@/components/Search";
import { useStore } from "@/lib/store";
import { logEvent, normalizeName, saveRecord, saveRecords, saveSettings, uid, type Customer } from "@/lib/data";
import { customersFromLedgerExport } from "@/lib/tally";
import { decodeFileText } from "@/lib/format";
import { findDuplicates, pairKey, type DupGroup } from "@/lib/dupes";
import { cn } from "@/lib/utils";
import { companyList } from "@/lib/companies";

const COLORS = ["from-brand-500 to-indigo-500", "from-emerald-500 to-teal-500", "from-amber-500 to-orange-500", "from-pink-500 to-rose-500", "from-violet-500 to-purple-500", "from-sky-500 to-cyan-500"];
function initials(name: string) {
  return name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export function Customers() {
  const { customers, allCustomers, orders, services, receipts, balances, settings } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState({ name: "", mobile: "" });
  const [showHidden, setShowHidden] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [removing, setRemoving] = useState<Customer | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const hidden = useMemo(() => allCustomers.filter((c) => c.removed || c.mergedInto), [allCustomers]);
  const byId = useMemo(() => new Map(allCustomers.map((c) => [c.id, c])), [allCustomers]);
  const groups = useMemo(() => findDuplicates(customers, settings.notDuplicates || []), [customers, settings.notDuplicates]);

  // what each customer has: used to pick which one to keep, and shown before merging / removing
  const usage = useMemo(() => {
    const m = new Map<string, { orders: number; services: number; receipts: number }>();
    const add = (id: string, k: "orders" | "services" | "receipts") => { const u = m.get(id) || { orders: 0, services: 0, receipts: 0 }; u[k]++; m.set(id, u); };
    orders.forEach((o) => add(o.customerId, "orders"));
    services.forEach((s) => add(s.customerId, "services"));
    receipts.forEach((r) => add(r.customerId, "receipts"));
    return m;
  }, [orders, services, receipts]);
  const usageOf = (id: string) => usage.get(id) || { orders: 0, services: 0, receipts: 0 };
  const coList = companyList(balances, settings);
  // the companies (short names) whose Tally has this customer
  const inTally = (c: Customer) => coList.filter((co) => balances[co.key]?.names?.[normalizeName(c.name)] !== undefined || balances[co.key]?.balances?.[normalizeName(c.name)] !== undefined)
    .map((co) => (co.key === "business" ? "Chittam Ent." : co.label));

  const list = useMemo(() => {
    const f = q.trim().toLowerCase();
    return (showHidden ? hidden : customers)
      .filter((c) => !f || c.name.toLowerCase().includes(f) || (c.mobile || "").includes(f))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, hidden, showHidden, q]);

  function openNew() { setIsNew(true); setEditing({ id: uid(), name: "", mobile: "" }); setForm({ name: "", mobile: "" }); }
  function openEdit(c: Customer) { setIsNew(false); setEditing(c); setForm({ name: c.name, mobile: c.mobile || "" }); }

  async function save() {
    if (!editing || !form.name.trim()) { toast("Enter the customer's name."); return; }
    const dup = allCustomers.find((c) => c.id !== editing.id && normalizeName(c.name) === normalizeName(form.name));
    if (dup) { toast(form.name.trim() + (dup.removed || dup.mergedInto ? " exists but is removed — restore it under “Show removed & merged”." : " is already a customer.")); return; }
    const item: Customer = { ...editing, name: form.name.trim(), mobile: form.mobile.trim() };
    try {
      await saveRecord("customers", item, isNew ? null : editing);
      toast(isNew ? "Customer added." : "Customer saved.");
      setEditing(null);
    } catch (e) { toast("Could not save: " + (e as Error).message); }
  }

  // "delete": hidden everywhere, kept in the database (nothing is ever deleted), can be restored
  async function remove(c: Customer) {
    try {
      await saveRecord("customers", { ...c, removed: true, removedAt: new Date().toISOString() }, c);
      await logEvent("customer-removed", { name: c.name, customerId: c.id, ...usageOf(c.id) });
      toast(c.name + " removed. Restore it any time under “Show removed & merged”.");
      setRemoving(null); setEditing(null);
    } catch (e) { toast("Could not remove: " + (e as Error).message); }
  }

  async function restore(c: Customer) {
    const { removed: _r, removedAt: _ra, mergedInto: _m, mergedAt: _ma, ...rest } = c;
    const clash = customers.find((x) => normalizeName(x.name) === normalizeName(c.name));
    if (clash) { toast("An active customer is already called " + clash.name + ". Rename one first."); return; }
    try {
      await saveRecord("customers", rest as Customer, c);
      await logEvent("customer-restored", { name: c.name, customerId: c.id, wasMergedInto: c.mergedInto ? byId.get(c.mergedInto)?.name || c.mergedInto : "" });
      toast(c.name + " restored.");
    } catch (e) { toast("Could not restore: " + (e as Error).message); }
  }

  async function importFile(file: File) {
    try {
      const obj = JSON.parse(decodeFileText(await file.arrayBuffer()));
      // compared with every customer, removed and merged included, so they don't come back
      const { changes, summary } = customersFromLedgerExport(obj, allCustomers);
      await saveRecords(changes.map((c) => ({ coll: "customers", id: c.item.id, data: c.item, before: c.before })));
      await logEvent("import-customers", summary);
      toast(`Imported ${summary.added} new, updated ${summary.updated} (skipped ${summary.skippedBank} bank ledgers).`);
    } catch (e) { toast((e as Error).message); }
  }

  return (
    <div>
      <PageHeader
        icon="boy"
        eyebrow="Masters"
        title="Customers"
        subtitle={`${customers.length} customers · name and mobile are used in every message`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDupOpen(true)}><IconCopy size={16} /> Possible duplicates{groups.length ? " (" + groups.length + ")" : ""}</Button>
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><IconUpload size={16} /> Import from Tally</Button>
            <Button size="sm" onClick={openNew}><IconPlus size={16} /> Add customer</Button>
          </>
        }
      />
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />

      <div className="mb-3"><Search placeholders={["Search by name…", "Search by mobile number…", "Try “Raichur”"]} onChange={setQ} /></div>
      {(hidden.length > 0 || showHidden) && (
        <button onClick={() => setShowHidden((v) => !v)} className="mb-4 text-sm font-semibold text-brand-600 hover:underline">
          {showHidden ? "← Back to active customers" : "Show removed & merged (" + hidden.length + ")"}
        </button>
      )}

      {list.length === 0 ? (
        <EmptyState icon="boy" title={showHidden ? "Nothing removed or merged" : customers.length ? "No customers match" : "No customers yet"} text={showHidden ? "" : customers.length ? "Try another name or number." : "Add one, or import your Ledger Contact Details from Tally."} />
      ) : showHidden ? (
        <div className="divide-y divide-neutral-100 rounded-2xl border border-neutral-200/80 bg-white">
          {list.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-neutral-700">{c.name}</span>
                <span className="text-xs text-neutral-500">{c.mergedInto ? "Merged into " + (byId.get(c.mergedInto)?.name || "another customer") : "Removed"}{(c.mergedAt || c.removedAt) ? " · " + new Date(c.mergedAt || c.removedAt || "").toLocaleDateString("en-IN") : ""}{c.mobile ? " · " + c.mobile : ""}</span>
              </span>
              <Button variant="secondary" size="sm" onClick={() => restore(c)}><IconArrowBackUp size={16} /> Restore</Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((c, i) => (
            <motion.button
              key={c.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 20) * 0.015 }}
              onClick={() => openEdit(c)}
              className="group flex items-center gap-3 rounded-2xl border border-neutral-200/80 bg-white p-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
            >
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-extrabold text-white ${COLORS[c.name.length % COLORS.length]}`}>
                {initials(c.name) || "?"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold text-neutral-800">{c.name}</span>
                <span className="mt-0.5 flex items-center gap-1 text-sm text-neutral-500 tabular-nums">
                  <IconPhone size={14} /> {c.mobile || "No mobile"}
                </span>
              </span>
              <IconPencil size={18} className="text-neutral-300 transition group-hover:text-brand-600" />
            </motion.button>
          ))}
        </div>
      )}

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={isNew ? "Add customer" : "Edit customer"}
        footer={<>
          {!isNew && editing && <Button variant="ghost" className="text-rose-600" onClick={() => setRemoving(editing)}><IconTrash size={16} /> Remove</Button>}
          {!isNew && editing && <Button variant="secondary" className="mr-auto" onClick={() => navigate("/ledger?c=" + editing.id)}>Ledger statement</Button>}
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button>
        </>}
      >
        <Field label="Customer name"><input className="field-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
        <Field label="Mobile number" hint="10-digit mobile — used to open the WhatsApp chat"><input className="field-input tabular-nums" type="tel" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></Field>
        <p className="text-xs text-neutral-400">Removing hides a customer everywhere but keeps it (it can be restored). Every change is saved in History.</p>
      </Dialog>

      <Dialog open={!!removing} onClose={() => setRemoving(null)} title="Remove customer?"
        footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button><Button className="bg-rose-600 hover:bg-rose-700" onClick={() => removing && remove(removing)}><IconTrash size={16} /> Remove</Button></>}>
        {removing && (() => {
          const u = usageOf(removing.id);
          const any = u.orders + u.services + u.receipts;
          return <>
            <p className="text-sm"><b>{removing.name}</b> will be hidden from customer lists and pickers. It stays in the database and can be restored.</p>
            {any > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">It has {u.orders} order(s), {u.services} service job(s) and {u.receipts} payment(s). They stay as they are. If this is a duplicate, use <b>Possible duplicates → Merge</b> instead, so they move to the right customer.</p>}
          </>;
        })()}
      </Dialog>

      <DuplicatesDialog open={dupOpen} onClose={() => setDupOpen(false)} groups={groups} byId={byId} usageOf={usageOf} inTally={inTally} />
    </div>
  );
}

// possible duplicates: pick the one to keep, merge the others into it — or mark the group "not duplicates"
function DuplicatesDialog({ open, onClose, groups, byId, usageOf, inTally }: {
  open: boolean; onClose: () => void; groups: DupGroup[]; byId: Map<string, Customer>;
  usageOf: (id: string) => { orders: number; services: number; receipts: number }; inTally: (c: Customer) => string[];
}) {
  const { orders, services, receipts, settings } = useStore();
  const toast = useToast();
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState<DupGroup | null>(null);

  // the suggested one to keep: in Tally first, then the most records, then one with a mobile
  const suggested = (g: DupGroup) => [...g.ids].sort((a, b) => {
    const ca = byId.get(a)!, cb = byId.get(b)!;
    const score = (c: Customer) => inTally(c).length * 1000 + Object.values(usageOf(c.id)).reduce((t, n) => t + n, 0) * 10 + (c.mobile ? 1 : 0);
    return score(cb) - score(ca);
  })[0];
  const gid = (g: DupGroup) => [...g.ids].sort().join(",");
  const keeperOf = (g: DupGroup) => keep[gid(g)] || suggested(g);

  async function merge(g: DupGroup) {
    const keeperId = keeperOf(g);
    const keeper = byId.get(keeperId);
    if (!keeper) return;
    setBusy(gid(g));
    try {
      const others = g.ids.filter((id) => id !== keeperId).map((id) => byId.get(id)!).filter(Boolean);
      const now = new Date().toISOString();
      const writes: { coll: string; id: string; data: Record<string, unknown>; before: Record<string, unknown> }[] = [];
      const move = <T extends { id: string; customerId: string; customerName: string }>(coll: string, items: T[], from: string) =>
        items.filter((x) => x.customerId === from).forEach((x) => writes.push({ coll, id: x.id, data: { ...x, customerId: keeper.id, customerName: keeper.name }, before: x as unknown as Record<string, unknown> }));
      let moved = 0;
      for (const o of others) {
        const n = writes.length;
        move("orders", orders, o.id); move("services", services, o.id); move("receipts", receipts, o.id);
        moved += writes.length - n;
        writes.push({ coll: "customers", id: o.id, data: { ...o, mergedInto: keeper.id, mergedAt: now }, before: o as unknown as Record<string, unknown> });
      }
      // keep a mobile number if the kept customer has none
      const mobile = !keeper.mobile ? others.find((o) => o.mobile)?.mobile : "";
      if (mobile) writes.push({ coll: "customers", id: keeper.id, data: { ...keeper, mobile }, before: keeper as unknown as Record<string, unknown> });
      await saveRecords(writes);
      await logEvent("customers-merged", { name: keeper.name, customerId: keeper.id, merged: others.map((o) => o.name), mergedIds: others.map((o) => o.id), recordsMoved: moved, mobileTaken: mobile || "" });
      toast("Merged into " + keeper.name + (moved ? " · " + moved + " record(s) moved" : "") + ".");
      setConfirm(null);
    } catch (e) { toast("Could not merge: " + (e as Error).message); }
    finally { setBusy(""); }
  }

  async function notDuplicates(g: DupGroup) {
    const pairs = new Set(settings.notDuplicates || []);
    for (let i = 0; i < g.ids.length; i++) for (let j = i + 1; j < g.ids.length; j++) pairs.add(pairKey(g.ids[i], g.ids[j]));
    try {
      await saveSettings({ ...settings, notDuplicates: [...pairs].sort() }, settings);
      toast("Marked as not duplicates — they won't be suggested again.");
    } catch (e) { toast("Could not save: " + (e as Error).message); }
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} title={"Possible duplicates" + (groups.length ? " (" + groups.length + ")" : "")} footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
        {groups.length === 0 ? <p className="text-sm text-neutral-500">No possible duplicates found.</p> : (
          <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
            <p className="text-xs text-neutral-500">Pick the customer to keep. Merging moves the others' orders, service jobs and payments to it; the others are kept as “merged” (nothing is deleted). Messages already sent stay as they were.</p>
            {groups.map((g) => {
              const k = keeperOf(g);
              return (
                <div key={gid(g)} className="rounded-xl border border-neutral-200 p-3">
                  <p className="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">{g.reasons.join(" · ")}</p>
                  <div className="space-y-1.5">
                    {g.ids.map((id) => {
                      const c = byId.get(id)!;
                      const u = usageOf(id), t = inTally(c);
                      return (
                        <label key={id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5", k === id ? "bg-brand-50" : "hover:bg-neutral-50")}>
                          <input type="radio" className="size-4 accent-brand-600" checked={k === id} onChange={() => setKeep((x) => ({ ...x, [gid(g)]: id }))} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{c.name}{k === id && <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-700">KEEP</span>}</span>
                            <span className="text-xs text-neutral-500">{c.mobile || "no mobile"} · {u.orders} orders · {u.services} service · {u.receipts} payments{t.length ? " · in Tally (" + t.join(", ") + ")" : ""}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => notDuplicates(g)}>Not duplicates</Button>
                    <Button size="sm" onClick={() => setConfirm(g)} disabled={!!busy}><IconGitMerge size={16} /> Merge into kept</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Dialog>

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title="Merge customers?"
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button onClick={() => confirm && merge(confirm)} disabled={!!busy}><IconGitMerge size={16} /> {busy ? "Merging…" : "Merge"}</Button></>}>
        {confirm && (() => {
          const keeper = byId.get(keeperOf(confirm))!;
          const others = confirm.ids.filter((id) => id !== keeper.id).map((id) => byId.get(id)!);
          return <>
            <p className="text-sm">Keep <b>{keeper.name}</b>. Merge into it:</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {others.map((o) => { const u = usageOf(o.id); return <li key={o.id}><b>{o.name}</b> — {u.orders} order(s), {u.services} service job(s), {u.receipts} payment(s) move to {keeper.name}</li>; })}
            </ul>
            <p className="text-xs text-neutral-500">The merged customers are kept (marked “merged”) and can be restored, but moved records stay with {keeper.name}. Saved in History.</p>
          </>;
        })()}
      </Dialog>
    </>
  );
}
