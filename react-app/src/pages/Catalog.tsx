// Product Catalog: pick products, preview, then share to WhatsApp (with
// photos where the phone allows) or copy the text. Photos stay on this
// device only (never in the database) — the same storage the current app
// uses, so photos added there show here too.
import { useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { IconBrandWhatsapp, IconCamera, IconCheck, IconCopy, IconEye, IconPackage } from "@tabler/icons-react";
import { Button, Dialog, EmptyState, PageHeader, useToast } from "@/components/kit";
import { Select, Text, copyText } from "@/components/forms";
import { useStore } from "@/lib/store";
import { logEvent, type Product } from "@/lib/data";
import { cn } from "@/lib/utils";

const PHOTO_KEY = "ce_catalog_photos_v2";
function readPhotos(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(PHOTO_KEY) || "{}"); } catch { return {}; }
}
const money = (x: unknown) => {
  if (x === "" || x == null) return "Price on request";
  const n = Number(x);
  return Number.isFinite(n) ? "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : String(x);
};
// the current app sends "\n" as text here by mistake; real line breaks are right
function catalogText(list: Product[]) {
  return "*CHITTAM ENTERPRISES — PRODUCT CATALOG*\n\n" +
    list.map((p) => "📦 *" + p.name + "*\nCategory: " + (p.category || "General") + "\n💰 " + money(p.price)).join("\n\n") +
    "\n\n📲 Contact us for availability and order details.";
}
// shrink a photo so it fits in the phone's storage
function compress(file: File, max = 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader(), img = new Image();
    r.onload = () => {
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = reject; img.src = String(r.result);
    };
    r.onerror = reject; r.readAsDataURL(file);
  });
}

export function Catalog() {
  const { products } = useStore();
  const toast = useToast();
  const [photos, setPhotos] = useState(readPhotos);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoFor, setPhotoFor] = useState("");

  const cats = useMemo(() => [...new Set(products.map((p) => p.category || "General"))].sort(), [products]);
  const list = useMemo(() => {
    const f = q.trim().toLowerCase();
    return [...products].sort((a, b) => a.name.localeCompare(b.name))
      .filter((p) => (!f || (p.name + " " + (p.category || "")).toLowerCase().includes(f)) && (!cat || (p.category || "General") === cat));
  }, [products, q, cat]);
  const selected = products.filter((p) => picked.has(p.id));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function addPhoto(file: File) {
    try {
      const next = { ...readPhotos(), [photoFor]: await compress(file) };
      localStorage.setItem(PHOTO_KEY, JSON.stringify(next));
      setPhotos(next);
      logEvent("catalog-photo", { name: products.find((p) => p.id === photoFor)?.name || "" }).catch(() => {});
    } catch { toast("Could not use that photo — this device may be out of space."); }
  }

  async function share(items: Product[]) {
    const text = catalogText(items);
    logEvent("catalog-share", { name: items.length === 1 ? items[0].name : "", products: items.map((p) => p.name) }).catch(() => {});
    // phones: share text + photos together through the share sheet
    if (navigator.share && navigator.canShare) {
      try {
        const files: File[] = [];
        for (let i = 0; i < items.length; i++) {
          const ph = photos[items[i].id];
          if (!ph) continue;
          files.push(new File([await (await fetch(ph)).blob()], "chittam-product-" + (i + 1) + ".jpg", { type: "image/jpeg" }));
        }
        if (files.length && navigator.canShare({ files })) { await navigator.share({ title: "Chittam Enterprises Product Catalog", text, files }); return; }
      } catch (e) { if ((e as Error)?.name === "AbortError") return; }
    }
    await copyText(text);
    window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank");
  }
  async function copy() {
    await copyText(catalogText(selected));
    logEvent("catalog-copy", { products: selected.map((p) => p.name) }).catch(() => {});
    toast("Catalog message copied.");
  }

  return (
    <div>
      <PageHeader icon="picture" eyebrow="Messages" title="Product Catalog" subtitle="Pick products and share a catalog on WhatsApp. Photos are kept on this device only."
        actions={<Button size="sm" variant="whatsapp" onClick={() => (selected.length ? setPreview(true) : toast("Select at least one product first."))}><IconEye size={16} /> Preview & share ({selected.length})</Button>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Text className="w-full sm:w-auto sm:max-w-md sm:flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search product or category…" />
        <Select className="w-auto" value={cat} onChange={setCat} options={[{ value: "", label: "All categories" }, ...cats.map((c) => ({ value: c, label: c }))]} />
        <Button variant="secondary" size="sm" className="h-11" onClick={() => setPicked(new Set([...picked, ...list.map((p) => p.id)]))}>Select all</Button>
        <Button variant="ghost" size="sm" className="h-11" onClick={() => setPicked(new Set())}>Clear</Button>
      </div>
      {list.length === 0 ? (
        <EmptyState icon="picture" title={products.length ? "No products match" : "No products yet"} text={products.length ? "Try another search or category." : "Add products in Products first."} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((p, i) => {
            const on = picked.has(p.id);
            return (
              <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 16) * 0.015 }}
                className={cn("overflow-hidden rounded-2xl border bg-white shadow-sm transition", on ? "border-brand-500 ring-2 ring-brand-200" : "border-neutral-200/80")}>
                <button onClick={() => toggle(p.id)} className="relative flex h-36 w-full items-center justify-center bg-neutral-50 sm:h-44">
                  {photos[p.id] ? <img src={photos[p.id]} alt="" className="h-full w-full object-contain" /> : <IconPackage size={44} className="text-neutral-300" />}
                  <span className={cn("absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-md border-2", on ? "border-brand-600 bg-brand-600 text-white" : "border-neutral-300 bg-white")}>
                    {on && <IconCheck size={15} stroke={3} />}
                  </span>
                </button>
                <div className="p-3">
                  <div className="text-[11px] font-bold tracking-wide text-brand-600 uppercase">{p.category || "General"}</div>
                  <div className="line-clamp-2 min-h-10 text-sm leading-tight font-bold">{p.name}</div>
                  <div className="mt-1 text-base font-extrabold">{money(p.price)}</div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <button onClick={() => { setPhotoFor(p.id); fileRef.current?.click(); }} className="flex items-center justify-center gap-1 rounded-lg bg-neutral-100 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-200">
                      <IconCamera size={14} /> {photos[p.id] ? "Change" : "Photo"}
                    </button>
                    <button onClick={() => share([p])} className="flex items-center justify-center gap-1 rounded-lg bg-emerald-500 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600">
                      <IconBrandWhatsapp size={14} /> Share
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) addPhoto(f); e.target.value = ""; }} />

      <Dialog open={preview} onClose={() => setPreview(false)} title={"Catalog preview · " + selected.length + " product" + (selected.length === 1 ? "" : "s")}
        footer={<><Button variant="secondary" onClick={copy}><IconCopy size={16} /> Copy</Button><Button variant="whatsapp" onClick={() => { share(selected); setPreview(false); }}><IconBrandWhatsapp size={16} /> Share</Button></>}>
        <div className="divide-y divide-neutral-100">
          {selected.map((p) => (
            <div key={p.id} className="flex items-center gap-3 py-2.5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-neutral-100">
                {photos[p.id] ? <img src={photos[p.id]} alt="" className="h-full w-full object-contain" /> : <IconPackage size={22} className="text-neutral-300" />}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{p.name}</div>
                <div className="text-xs text-neutral-500">{p.category || "General"} · <strong className="text-neutral-800">{money(p.price)}</strong></div>
              </div>
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
