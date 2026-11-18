import { useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { IconPlus, IconUpload } from "@tabler/icons-react";
import { Button, Dialog, EmptyState, Field, PageHeader, useToast } from "@/components/kit";
import { Search } from "@/components/Search";
import { useStore } from "@/lib/store";
import { logEvent, normalizeName, saveRecord, saveRecords, uid, type Product } from "@/lib/data";
import { productsFromStockExport } from "@/lib/tally";
import { decodeFileText, inr } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Products() {
  const { products } = useStore();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", price: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    products.forEach((p) => { const c = (p.category || "").trim(); if (c) counts.set(c, (counts.get(c) || 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [products]);

  const list = useMemo(() => {
    const f = q.trim().toLowerCase();
    return products
      .filter((p) => (!cat || (p.category || "") === cat) && (!f || p.name.toLowerCase().includes(f) || (p.category || "").toLowerCase().includes(f)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, q, cat]);

  function openNew() { setIsNew(true); setEditing({ id: uid(), name: "" }); setForm({ name: "", category: cat, price: "" }); }
  function openEdit(p: Product) { setIsNew(false); setEditing(p); setForm({ name: p.name, category: p.category || "", price: p.price ? String(p.price) : "" }); }

  async function save() {
    if (!editing || !form.name.trim()) { toast("Enter the product name."); return; }
    const dup = products.find((p) => p.id !== editing.id && normalizeName(p.name) === normalizeName(form.name));
    if (dup) { toast(form.name.trim() + " is already in the list."); return; }
    const item: Product = { ...editing, name: form.name.trim(), category: form.category.trim(), price: Number(form.price) || 0 };
    try {
      await saveRecord("products", item, isNew ? null : editing);
      toast(isNew ? "Product added." : "Product saved.");
      setEditing(null);
    } catch (e) { toast("Could not save: " + (e as Error).message); }
  }

  async function importFile(file: File) {
    try {
      const obj = JSON.parse(decodeFileText(await file.arrayBuffer()));
      const { changes, summary } = productsFromStockExport(obj, products);
      await saveRecords(changes.map((c) => ({ coll: "products", id: c.item.id, data: c.item, before: c.before })));
      await logEvent("import-products", summary);
      toast(`Imported ${summary.added} new, updated ${summary.updated} prices` + (summary.noPrice ? ` (${summary.noPrice} had no price)` : "") + ".");
    } catch (e) { toast((e as Error).message); }
  }

  return (
    <div>
      <PageHeader
        icon="cube"
        eyebrow="Masters"
        title="Products"
        subtitle={`${products.length} products in ${categories.length} categories`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><IconUpload size={16} /> Import from Tally</Button>
            <Button size="sm" onClick={openNew}><IconPlus size={16} /> Add product</Button>
          </>
        }
      />
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />

      <div className="mb-4"><Search placeholders={["Search products…", "Try “Makwell”", "Try “Wallmount”"]} onChange={setQ} /></div>

      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1">
        {[["", products.length] as [string, number], ...categories].map(([c, n]) => (
          <button
            key={c || "all"}
            onClick={() => setCat(c)}
            className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition", cat === c ? "border-transparent bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-brand-200")}
          >
            {c || "All"} <span className="ml-1 opacity-60">{n}</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState icon="cube" title={products.length ? "No products match" : "No products yet"} text={products.length ? "Try another search or category." : "Add one, or import a Stock Summary from Tally."} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-sm">
          {list.map((p, i) => (
            <motion.button
              key={p.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(i, 25) * 0.01 }}
              onClick={() => openEdit(p)}
              className="flex w-full items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 text-left transition last:border-0 hover:bg-brand-50/50"
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold text-neutral-800">{p.name}</span>
                {p.category && <span className="mt-0.5 inline-block rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-500">{p.category}</span>}
              </span>
              <span className={cn("shrink-0 font-bold tabular-nums", p.price ? "text-neutral-900" : "text-neutral-300")}>{p.price ? inr(p.price) : "No price"}</span>
            </motion.button>
          ))}
        </div>
      )}

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={isNew ? "Add product" : "Edit product"}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}
      >
        <Field label="Product name"><input className="field-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
        <Field label="Category">
          <input className="field-input" list="product-categories" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <datalist id="product-categories">{categories.map(([c]) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Price (₹)"><input className="field-input tabular-nums" type="number" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
        <p className="text-xs text-neutral-400">Products can't be deleted. Every change is saved in History.</p>
      </Dialog>
    </div>
  );
}
