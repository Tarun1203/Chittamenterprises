import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { IconMapPin, IconPhone, IconPlus, IconUser } from "@tabler/icons-react";
import { Button, Dialog, EmptyState, Field, Icon3D, PageHeader, useToast } from "@/components/kit";
import { Search } from "@/components/Search";
import { useStore } from "@/lib/store";
import { normalizeName, saveRecord, uid, type Transport } from "@/lib/data";

const empty = { name: "", contactPerson: "", phone: "", branch: "" };

export function Transports() {
  const { transports } = useStore();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Transport | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState(empty);

  const list = useMemo(() => {
    const f = q.trim().toLowerCase();
    return transports
      .filter((t) => !f || [t.name, t.contactPerson, t.phone, t.branch].join(" ").toLowerCase().includes(f))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [transports, q]);

  function openNew() { setIsNew(true); setEditing({ id: uid("t_"), name: "" }); setForm(empty); }
  function openEdit(t: Transport) { setIsNew(false); setEditing(t); setForm({ name: t.name, contactPerson: t.contactPerson || "", phone: t.phone || "", branch: t.branch || "" }); }

  async function save() {
    if (!editing || !form.name.trim()) { toast("Enter the transport name."); return; }
    const dup = transports.find((t) => t.id !== editing.id && normalizeName(t.name) === normalizeName(form.name));
    if (dup) { toast(form.name.trim() + " is already in the list — edit that one instead."); return; }
    const item: Transport = { ...editing, name: form.name.trim(), contactPerson: form.contactPerson.trim(), phone: form.phone.trim(), branch: form.branch.trim() };
    try {
      await saveRecord("transports", item, isNew ? null : editing);
      toast(isNew ? "Transport added." : "Transport saved.");
      setEditing(null);
    } catch (e) { toast("Could not save: " + (e as Error).message); }
  }

  return (
    <div>
      <PageHeader icon="location" eyebrow="Masters" title="Transports" subtitle="Transporters and their contact numbers — used on orders and dispatch messages"
        actions={<Button size="sm" onClick={openNew}><IconPlus size={16} /> Add transport</Button>} />

      <div className="mb-5"><Search placeholders={["Search transports…", "Try “VRL”", "Search by phone or branch…"]} onChange={setQ} /></div>

      {list.length === 0 ? (
        <EmptyState icon="location" title={transports.length ? "No transports match" : "No transports yet"} text="Add the transporters you use, with their booking-office number." action={!transports.length && <Button onClick={openNew}><IconPlus size={16} /> Add transport</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((t, i) => (
            <motion.button key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} onClick={() => openEdit(t)}
              className="group rounded-2xl border border-neutral-200/80 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md">
              <div className="flex items-center gap-3">
                <Icon3D name="rocket" className="h-10 w-10 drop-shadow transition group-hover:-rotate-12" />
                <span className="font-bold text-neutral-800">{t.name}</span>
              </div>
              <div className="mt-3 space-y-1 text-sm text-neutral-500">
                {t.phone && <div className="flex items-center gap-1.5 tabular-nums"><IconPhone size={14} /> {t.phone}</div>}
                {t.contactPerson && <div className="flex items-center gap-1.5"><IconUser size={14} /> {t.contactPerson}</div>}
                {t.branch && <div className="flex items-center gap-1.5"><IconMapPin size={14} /> {t.branch}</div>}
              </div>
            </motion.button>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={isNew ? "Add transport" : "Edit transport"}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        <Field label="Transport name"><input className="field-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus placeholder="e.g. VRL Logistics" /></Field>
        <Field label="Contact person"><input className="field-input" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} /></Field>
        <Field label="Phone"><input className="field-input tabular-nums" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Branch / area"><input className="field-input" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} placeholder="e.g. Raichur, Station Road" /></Field>
      </Dialog>
    </div>
  );
}
