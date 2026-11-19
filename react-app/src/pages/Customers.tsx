import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { IconPencil, IconPhone, IconPlus, IconUpload } from "@tabler/icons-react";
import { Button, Dialog, EmptyState, Field, PageHeader, useToast } from "@/components/kit";
import { Search } from "@/components/Search";
import { useStore } from "@/lib/store";
import { logEvent, normalizeName, saveRecord, saveRecords, uid, type Customer } from "@/lib/data";
import { customersFromLedgerExport } from "@/lib/tally";
import { decodeFileText } from "@/lib/format";

const COLORS = ["from-brand-500 to-indigo-500", "from-emerald-500 to-teal-500", "from-amber-500 to-orange-500", "from-pink-500 to-rose-500", "from-violet-500 to-purple-500", "from-sky-500 to-cyan-500"];
function initials(name: string) {
  return name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export function Customers() {
  const { customers } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState({ name: "", mobile: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const f = q.trim().toLowerCase();
    return customers
      .filter((c) => !f || c.name.toLowerCase().includes(f) || (c.mobile || "").includes(f))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, q]);

  function openNew() { setIsNew(true); setEditing({ id: uid(), name: "", mobile: "" }); setForm({ name: "", mobile: "" }); }
  function openEdit(c: Customer) { setIsNew(false); setEditing(c); setForm({ name: c.name, mobile: c.mobile || "" }); }

  async function save() {
    if (!editing || !form.name.trim()) { toast("Enter the customer's name."); return; }
    const dup = customers.find((c) => c.id !== editing.id && normalizeName(c.name) === normalizeName(form.name));
    if (dup) { toast(form.name.trim() + " is already a customer."); return; }
    const item: Customer = { ...editing, name: form.name.trim(), mobile: form.mobile.trim() };
    try {
      await saveRecord("customers", item, isNew ? null : editing);
      toast(isNew ? "Customer added." : "Customer saved.");
      setEditing(null);
    } catch (e) { toast("Could not save: " + (e as Error).message); }
  }

  async function importFile(file: File) {
    try {
      const obj = JSON.parse(decodeFileText(await file.arrayBuffer()));
      const { changes, summary } = customersFromLedgerExport(obj, customers);
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
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><IconUpload size={16} /> Import from Tally</Button>
            <Button size="sm" onClick={openNew}><IconPlus size={16} /> Add customer</Button>
          </>
        }
      />
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />

      <div className="mb-5"><Search placeholders={["Search by name…", "Search by mobile number…", "Try “Raichur”"]} onChange={setQ} /></div>

      {list.length === 0 ? (
        <EmptyState icon="boy" title={customers.length ? "No customers match" : "No customers yet"} text={customers.length ? "Try another name or number." : "Add one, or import your Ledger Contact Details from Tally."} />
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
        footer={<>{!isNew && editing && <Button variant="secondary" className="mr-auto" onClick={() => navigate("/ledger?c=" + editing.id)}>Ledger statement</Button>}<Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}
      >
        <Field label="Customer name"><input className="field-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
        <Field label="Mobile number" hint="10-digit mobile — used to open the WhatsApp chat"><input className="field-input tabular-nums" type="tel" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></Field>
        <p className="text-xs text-neutral-400">Customers can't be deleted. Every change is saved in History.</p>
      </Dialog>
    </div>
  );
}
