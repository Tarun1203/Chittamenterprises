// Pick list for the godown: one order, or every open order of a day, with
// the total of each product and the per-order breakdown. Copy or print.
import { useMemo, useState } from "react";
import { IconCopy, IconPrinter } from "@tabler/icons-react";
import { Button, Dialog, Field, useToast } from "@/components/kit";
import { Text, copyText } from "@/components/forms";
import { useStore } from "@/lib/store";
import { logEvent, type Order } from "@/lib/data";
import { buildPickList, msgDate, orderPending, packQty, pendingQty, pickListText } from "@/lib/messages";
import { todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUSES = ["Pending", "Confirmed", "Packed", "Dispatched", "Delivered", "Cancelled"];
const DEFAULT = ["Pending", "Confirmed", "Packed"];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function PickListDialog({ open, onClose, single }: { open: boolean; onClose: () => void; single?: Order | null }) {
  const { orders } = useStore();
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const [statuses, setStatuses] = useState<string[]>(DEFAULT);

  const chosen = useMemo(() => single ? [single] : orders
    .filter((o) => (!date || o.date === date) && statuses.includes(o.status || "Pending"))
    .sort((a, b) => String(a.orderNo).localeCompare(String(b.orderNo))), [single, orders, date, statuses]);
  const title = single ? "Pick List — Order " + single.orderNo : "Pick List — " + (date ? msgDate(date) : "all dates");
  const { products, totalQty } = buildPickList(chosen);
  const text = pickListText(title, chosen);

  async function copy() {
    if (!text) { toast("Nothing to copy."); return; }
    await copyText(text);
    toast("Pick list copied — paste it in WhatsApp or notes.");
    logEvent("picklist-copied", {}).catch(() => {});
  }
  function print() {
    if (!text) { toast("Nothing to print."); return; }
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) { toast("Allow pop-ups to print."); return; }
    const box = '<span style="display:inline-block;width:14px;height:14px;border:1.5px solid #333;border-radius:3px;margin-right:8px;vertical-align:-2px"></span>';
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>body{font:14px/1.5 "Segoe UI",system-ui,sans-serif;margin:28px;color:#111}h1{font-size:20px;margin:0}p.m{color:#555;margin:2px 0 16px}
      table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:7px 6px;text-align:left}th.q,td.q{text-align:right;width:60px}
      .sub{font-size:12px;color:#666}h2{font-size:15px;margin:22px 0 6px}.o{margin-bottom:12px}</style></head><body>
      <h1>${esc(title)}</h1><p class="m">${chosen.length} order${chosen.length === 1 ? "" : "s"} · ${products.length} product${products.length === 1 ? "" : "s"} · ${totalQty} pcs</p>
      <table><thead><tr><th>Product</th><th class="q">Qty</th></tr></thead><tbody>
      ${products.map((p) => `<tr><td>${box}${esc(p.name)}${chosen.length > 1 ? `<div class="sub">${esc(p.orders.join(", "))}</div>` : ""}</td><td class="q"><b>${p.qty}</b></td></tr>`).join("")}
      </tbody></table>
      ${chosen.length > 1 ? "<h2>By order</h2>" + chosen.map((o) => `<div class="o"><b>${esc(o.orderNo)}</b> · ${esc(o.customerName)}${o.transport ? " · " + esc(o.transport) : ""}<br>${(o.items || []).filter((it) => packQty(it) > 0).map((it) => `${box}${esc(it.name)} × <b>${packQty(it)}</b>`).join("<br>")}</div>`).join("") : chosen[0].notes ? `<p>📝 ${esc(chosen[0].notes)}</p>` : ""}
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
    logEvent("picklist-printed", {}).catch(() => {});
  }

  return (
    <Dialog open={open} onClose={onClose} title={title}
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="secondary" onClick={print}><IconPrinter size={16} /> Print</Button><Button onClick={copy}><IconCopy size={16} /> Copy</Button></>}>
      {!single && (
        <div className="space-y-3">
          <Field label="Order date"><Text type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <button key={s} type="button" onClick={() => setStatuses((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}
                className={cn("rounded-full border px-3 py-1 text-xs font-semibold", statuses.includes(s) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-neutral-200 text-neutral-500")}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      {chosen.length === 0 ? (
        <p className="rounded-xl bg-neutral-50 p-6 text-center text-sm text-neutral-500">No orders to pick for this selection.</p>
      ) : (
        <div>
          <p className="mb-2 text-xs font-semibold text-neutral-500">{chosen.length} order{chosen.length === 1 ? "" : "s"} · {products.length} product{products.length === 1 ? "" : "s"} · {totalQty} pcs</p>
          <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-100">
            {products.map((p) => (
              <label key={p.name} className="flex cursor-pointer items-start gap-3 px-3 py-2.5 has-[:checked]:bg-emerald-50/60">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-emerald-600" />
                <span className="flex-1 text-sm">
                  <span className="font-semibold">{p.name}</span>
                  {chosen.length > 1 && <span className="block text-xs text-neutral-500">{p.orders.join(", ")}</span>}
                </span>
                <span className="text-sm font-extrabold tabular-nums">{p.qty}</span>
              </label>
            ))}
          </div>
          {chosen.length > 1 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-bold tracking-wide text-neutral-500 uppercase">By order</p>
              {chosen.map((o) => (
                <div key={o.id} className="rounded-xl bg-neutral-50 px-3 py-2 text-sm">
                  <div className="font-semibold">{o.orderNo} · {o.customerName}{o.transport ? " · 🚛 " + o.transport : ""} <span className="text-xs text-neutral-500">({o.status})</span></div>
                  {(o.items || []).filter((it) => packQty(it) > 0).map((it, i) => <div key={i} className="text-neutral-600">☐ {it.name} × <strong>{packQty(it)}</strong></div>)}
                </div>
              ))}
            </div>
          )}
          {chosen.some((o) => orderPending(o).length > 0) && (
            <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <p className="font-bold">⏳ Pending — no stock, not packed</p>
              {chosen.flatMap((o) => orderPending(o).map((it, i) => <div key={o.id + i}>{it.name} × <strong>{pendingQty(it)}</strong>{chosen.length > 1 ? " (" + o.orderNo + ")" : ""}</div>))}
            </div>
          )}
          {chosen.length === 1 && chosen[0].notes && <p className="mt-3 text-sm text-neutral-600">📝 {chosen[0].notes}</p>}
        </div>
      )}
    </Dialog>
  );
}
