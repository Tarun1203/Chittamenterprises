// Parties & codes — everything about a party in one place: add a customer,
// edit its name and mobile, give it a code, set up routes and places.
// One unique code per party (district-route-place-serial, e.g.
// RC-KLM-KVTL-01) and its ledger name in each Tally company, so a party written
// differently in Chittam, Cash and Vamana counts as one everywhere. Saved in the
// app; "Push to Tally" (Windows app) then adds the code as the ledger's alias in
// every company, after a confirmation there.
import { useMemo, useState } from "react";
import { IconDeviceFloppy, IconPlus, IconSparkles, IconUpload, IconUserPlus } from "@tabler/icons-react";
import { Button, Card, Field, PageHeader, useToast } from "@/components/kit";
import { RowRemove, Select, Text } from "@/components/forms";
import { useStore } from "@/lib/store";
import { logEvent, normalizeName, PARTY_KINDS, saveRecords, saveSettings, uid, type Customer, type District, type PartyKind, type Route, type TallyParty } from "@/lib/data";
import { useCompanies } from "@/lib/companies";
import { classify, codeOf, looksLikeCode, nextOffRouteSerial, nextSerial, offRouteCode, oldCodes, partiesByCompany, routesFromTally, similarNames, suggestedRoutes, suggestLedgers } from "@/lib/parties";
import { desktopRequest, inDesktopApp } from "@/lib/desktop";
import { cn } from "@/lib/utils";

type Draft = { kind: PartyKind; name: string; mobile: string; code: string; district: string; route: string; place: string; tallyNames: Record<string, string> };
const mobileOk = (m: string) => !m.trim() || m.replace(/\D/g, "").length === 10;
const NONE = "__none__";

export function PartyCodes() {
  const { settings } = useStore();
  const [routesOpen, setRoutesOpen] = useState(false);
  return (
    <div className="space-y-4">
      <PageHeader icon="location" eyebrow="Masters" title="Parties & codes"
        subtitle="Customers and suppliers: add them, edit their details, give each a unique code (district – route – place – serial, e.g. RC-KLM-KVTL-01) and link its ledger in every Tally company — all here." />
      <details open={routesOpen || !(settings.routes || []).length} onToggle={(e) => setRoutesOpen((e.target as HTMLDetailsElement).open)}
        className="rounded-3xl border border-neutral-200 bg-white/70 p-4">
        <summary className="cursor-pointer text-base font-extrabold">🗺️ Routes & places <span className="text-sm font-semibold text-neutral-500">· {(settings.routes || []).length} routes</span></summary>
        <div className="mt-4"><Routes /></div>
      </details>
      <Parties onRoutes={() => setRoutesOpen(true)} />
    </div>
  );
}

/* ---------------------------------------------------------------- parties */

function Parties({ onRoutes }: { onRoutes: () => void }) {
  const { allCustomers, balances, settings } = useStore();
  // every party: customers, suppliers and both (not removed or merged)
  const customers = useMemo(() => allCustomers.filter((c) => !c.removed && !c.mergedInto), [allCustomers]);
  const [kindFilter, setKindFilter] = useState<"all" | PartyKind>("all");
  const companies = useCompanies();
  const toast = useToast();
  const routes = settings.routes || [];
  const cos = useMemo(() => partiesByCompany(balances, companies), [balances, companies]);
  const fullLists = companies.every((c) => balances[c.key]?.parties?.length);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [why, setWhy] = useState<Record<string, Record<string, string>>>({});
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"todo" | "all" | "done">("todo");
  const [busy, setBusy] = useState("");
  // parties added here, not saved yet
  const [added, setAdded] = useState<Customer[]>([]);

  const saved = (c: Customer): Draft => ({ kind: c.kind || "customer", name: c.name, mobile: c.mobile || "", code: c.code || "", district: c.district || "", route: c.route || "", place: c.place || "", tallyNames: c.tallyNames || {} });
  const draftOf = (c: Customer): Draft => drafts[c.id] || saved(c);
  const setDraft = (c: Customer, p: Partial<Draft>) => setDrafts((d) => ({ ...d, [c.id]: { ...draftOf(c), ...p } }));
  const isNew = (c: Customer) => added.some((x) => x.id === c.id);
  const changed = [...added, ...customers.filter((c) => drafts[c.id] && JSON.stringify(drafts[c.id]) !== JSON.stringify(saved(c)))];
  function addParty() {
    const c: Customer = { id: uid(), name: "", mobile: "", kind: kindFilter === "all" ? "customer" : kindFilter };
    setAdded((a) => [c, ...a]);
    setDrafts((d) => ({ ...d, [c.id]: saved(c) }));
    setFilter("all"); setQ("");
  }

  // codes as they'd be after saving (to find the next serial and duplicates)
  const pending = (): Customer[] => [...added, ...allCustomers].map((c) => (drafts[c.id] ? { ...c, code: drafts[c.id].code } : c));
  const dupCodes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const c of pending()) if (c.code && !c.mergedInto) seen.set(c.code.toUpperCase(), (seen.get(c.code.toUpperCase()) || 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }, [drafts, allCustomers, added]);   // eslint-disable-line react-hooks/exhaustive-deps

  // a Tally ledger already linked to another customer can't be picked twice
  const taken = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of customers) for (const co of companies) {
      const n = draftOf(c).tallyNames[co.key];
      if (n) { if (!m.has(co.key)) m.set(co.key, new Set()); m.get(co.key)!.add(n.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()); }
    }
    return m;
  }, [drafts, customers, companies]);   // eslint-disable-line react-hooks/exhaustive-deps

  function placeCode(c: Customer, routeCode: string, placeShort: string, base: Draft) {
    const r = routes.find((x) => x.code === routeCode);
    if (!r || !placeShort) return { ...base, route: routeCode, place: placeShort };
    const others = pending().filter((x) => x.id !== c.id);
    const code = codeOf(r.district, r.code, placeShort, nextSerial(others, r.district, r.code, placeShort));
    return { ...base, district: r.district, route: r.code, place: placeShort, code };
  }

  const district0 = settings.districts?.[0]?.code || routes[0]?.district || "RC";
  // a party's ledgers in every company (for its kind): its links, else its own name
  const ledgersOf = (name: string, names: Record<string, string>): TallyParty[] =>
    cos.flatMap((co) => co.parties.filter((p) => normalizeName(p.n) === normalizeName(names[co.key] || name)));
  // kind, route, place and code from Tally's groups (route groups, Technician, Customer, Transport, Sundry Creditors…)
  function typed(d: Draft, keepKind: boolean, work: Customer[], id: string): Draft {
    const g = classify(ledgersOf(d.name, d.tallyNames), routes);
    const kind = keepKind ? d.kind : g.kind;
    let next: Draft = { ...d, kind };
    if (!next.route && g.route && (kind === "customer" || kind === "both")) next = { ...next, district: g.route.district, route: g.route.code, place: g.place?.short || next.place };
    if (!next.code) {
      const r = routes.find((x) => x.code === next.route);
      if (r && next.place) next.code = codeOf(r.district, r.code, next.place, nextSerial(work, r.district, r.code, next.place));
      else if (!next.route) next.code = offRouteCode(district0, kind, nextOffRouteSerial(work, district0, kind));
      const i = work.findIndex((x) => x.id === id);
      if (next.code) { if (i >= 0) work[i] = { ...work[i], code: next.code }; else work.push({ id, name: next.name, code: next.code }); }
    }
    return next;
  }

  // fills in every party's Tally ledgers, its kind (from Tally's groups), route, place and code
  function suggestAll() {
    const next: Record<string, Draft> = { ...drafts };
    const whyAll: Record<string, Record<string, string>> = {};
    const takenNow = new Map(taken);
    const work = pending();
    for (const c of [...customers, ...added]) {
      const base = next[c.id] || draftOf(c);
      const s = suggestLedgers({ ...c, name: base.name, tallyNames: base.tallyNames }, cos, takenNow);
      const tallyNames: Record<string, string> = {};
      whyAll[c.id] = {};
      for (const [k, v] of Object.entries(s)) {
        if (normalizeName(v.name) !== normalizeName(base.name)) tallyNames[k] = v.name;   // only a different spelling needs saving
        whyAll[c.id][k] = v.why;
        if (!takenNow.has(k)) takenNow.set(k, new Set());
        takenNow.get(k)!.add(v.name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim());
      }
      const d: Draft = { ...base, tallyNames: { ...base.tallyNames, ...tallyNames } };
      // a kind already saved (or chosen here) is kept; otherwise it comes from Tally
      const g = classify(ledgersOf(d.name, d.tallyNames), routes);
      whyAll[c.id].kind = g.why;
      next[c.id] = typed(d, !!c.kind || !!drafts[c.id], work, c.id);
    }
    setDrafts(next);
    setWhy(whyAll);
    toast("Suggestions filled in — type, route, place, code and Tally links. Check them, then Save parties. Nothing is saved yet.");
  }

  // a draft party for every Tally ledger not linked to anyone yet (the same party in several
  // companies becomes one), typed from Tally's groups; nothing is saved until "Save parties"
  function addMissingFromTally() {
    const used = new Map(cos.map((co) => [co.key, new Set([...customers, ...added].map((c) => normalizeName(draftOf(c).tallyNames[co.key] || draftOf(c).name)))]));
    const groups: { name: string; mobile: string; names: Record<string, string> }[] = [];
    for (const co of cos) for (const p of co.parties) {
      if (used.get(co.key)!.has(normalizeName(p.n))) continue;
      const g = groups.find((x) => !x.names[co.key] && Object.values(x.names).some((n) => similarNames(n, p.n)));
      if (g) { g.names[co.key] = p.n; if (!g.mobile && p.m) g.mobile = p.m; }
      else groups.push({ name: p.n, mobile: p.m || "", names: { [co.key]: p.n } });
    }
    if (!groups.length) { toast("Every Tally party ledger is already linked to a party."); return; }
    const work = pending();
    const fresh = groups.map((g) => {
      const c = { id: uid(), name: "", mobile: "" } as Customer;
      const d = typed({ kind: "customer", name: g.name, mobile: g.mobile, code: "", district: "", route: "", place: "",
        tallyNames: Object.fromEntries(Object.entries(g.names).filter(([, n]) => normalizeName(n) !== normalizeName(g.name))) }, false, work, c.id);
      return { c: { ...c, kind: d.kind }, d, why: classify(ledgersOf(g.name, g.names), routes).why };
    });
    setAdded((a) => [...fresh.map((x) => x.c), ...a]);
    setDrafts((x) => ({ ...x, ...Object.fromEntries(fresh.map(({ c, d }) => [c.id, d])) }));
    setWhy((w) => ({ ...w, ...Object.fromEntries(fresh.map(({ c, why }) => [c.id, { kind: why }])) }));
    setFilter("all");
    const n = (k: PartyKind) => fresh.filter((x) => x.d.kind === k).length;
    toast(groups.length + " parties added below from Tally (" + PARTY_KINDS.filter((k) => n(k.value)).map((k) => n(k.value) + " " + k.label.toLowerCase()).join(", ") + ") — check them, then Save parties.");
  }

  async function save() {
    if (dupCodes.size) { toast("Two parties have the same code: " + [...dupCodes].join(", ")); return; }
    if (!changed.length) { toast("Nothing changed."); return; }
    for (const c of changed) {
      const d = draftOf(c);
      if (!d.name.trim()) { toast("Enter a name for every party (" + (isNew(c) ? "new party" : c.name) + ")."); return; }
      if (!mobileOk(d.mobile)) { toast(d.name + ": the mobile number should have 10 digits."); return; }
      const clash = [...allCustomers, ...added].find((x) => x.id !== c.id && normalizeName(drafts[x.id]?.name ?? x.name) === normalizeName(d.name));
      if (clash) { toast(d.name.trim() + (clash.removed || clash.mergedInto ? " exists but is removed — restore it in Customers (Show removed & merged)." : " is already a party.")); return; }
    }
    setBusy("Saving…");
    try {
      await saveRecords(changed.map((c) => {
        const d = draftOf(c);
        const name = d.name.trim();
        const tallyNames = Object.fromEntries(Object.entries(d.tallyNames).filter(([, v]) => v && normalizeName(v) !== normalizeName(name)));
        return { coll: "customers", id: c.id, data: { ...c, kind: d.kind, name, mobile: d.mobile.trim(), code: d.code.trim().toUpperCase(), district: d.district, route: d.route, place: d.place, tallyNames }, before: isNew(c) ? null : c };
      }));
      const nAdded = changed.filter(isNew).length;
      await logEvent("party-codes-saved", { name: "Parties & codes", added: nAdded, edited: changed.length - nAdded });
      toast((nAdded ? nAdded + " added, " : "") + (changed.length - nAdded) + " saved.");
      setDrafts({}); setAdded([]);
    } catch (e) { toast("Could not save: " + (e as Error).message); }
    finally { setBusy(""); }
  }

  // every coded party's ledger in each company gets the code as its alias (phone-number aliases kept; old codes replaced)
  function pushItems() {
    const items: { key: string; ledger: string; aliases: string[] }[] = [];
    for (const c of customers) {
      if (!c.code) continue;
      for (const co of cos) {
        const ledgerName = c.tallyNames?.[co.key] || c.name;
        const p = co.parties.find((x) => normalizeName(x.n) === normalizeName(ledgerName));
        if (!p) continue;
        const keep = (p.al || []).filter((a) => !looksLikeCode(a));
        const aliases = [c.code, ...keep];
        if ((p.al || []).length === aliases.length && aliases.every((a) => (p.al || []).includes(a))) continue;   // already right
        items.push({ key: co.key, ledger: p.n, aliases });
      }
    }
    return items;
  }
  async function push() {
    if (changed.length) { toast("Save your changes first."); return; }
    const items = pushItems();
    if (!items.length) { toast("Every coded party already has its code in Tally."); return; }
    setBusy("Waiting for the Windows app…");
    try {
      const r = await desktopRequest<{ ok: boolean; error?: string; results: { ok: boolean; ledger: string; error: string }[] }>(
        { type: "tally-set-aliases", reqId: Date.now().toString(36), items }, "tally-aliases-result", 15 * 60 * 1000);
      if (!r.ok) toast(r.error || "Not sent.");
      else {
        const bad = r.results.filter((x) => !x.ok);
        toast((r.results.length - bad.length) + " ledgers updated in Tally" + (bad.length ? "; " + bad.length + " failed: " + bad.slice(0, 3).map((x) => x.ledger + " (" + x.error + ")").join(", ") : "."));
      }
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(""); }
  }

  const status = (c: Customer) => {
    const d = draftOf(c);
    const linked = cos.filter((co) => co.parties.some((p) => normalizeName(p.n) === normalizeName(d.tallyNames[co.key] || d.name))).length;
    return { d, linked, done: !!d.code && linked > 0 };
  };
  const list = [...added, ...customers]
    .filter((c) => isNew(c) || !q.trim() || (draftOf(c).name + " " + draftOf(c).mobile + " " + (draftOf(c).code || "") + " " + Object.values(draftOf(c).tallyNames).join(" ")).toLowerCase().includes(q.trim().toLowerCase()))
    .filter((c) => isNew(c) || filter === "all" || (filter === "done") === status(c).done)
    .filter((c) => isNew(c) || kindFilter === "all" || draftOf(c).kind === kindFilter || ((kindFilter === "customer" || kindFilter === "supplier") && draftOf(c).kind === "both"))
    .sort((a, b) => Number(isNew(b)) - Number(isNew(a)) || (draftOf(a).code || "~").localeCompare(draftOf(b).code || "~") || a.name.localeCompare(b.name));
  const counts = { done: customers.filter((c) => status(c).done).length, total: customers.length };
  const unlinked = cos.map((co) => {
    const used = new Set(customers.map((c) => normalizeName(draftOf(c).tallyNames[co.key] || draftOf(c).name)));
    return { ...co, free: co.parties.filter((p) => !used.has(normalizeName(p.n))) };
  });

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={addParty} disabled={!!busy}><IconUserPlus size={16} /> Add party</Button>
          <Button variant="secondary" onClick={suggestAll} disabled={!!busy}><IconSparkles size={16} /> Suggest for all</Button>
          <Button variant="secondary" onClick={addMissingFromTally} disabled={!!busy || !fullLists}><IconUserPlus size={16} /> Add missing parties from Tally</Button>
          <Button variant="secondary" onClick={save} disabled={!!busy || !changed.length}><IconDeviceFloppy size={16} /> {busy === "Saving…" ? busy : "Save parties" + (changed.length ? " (" + changed.length + ")" : "")}</Button>
          {inDesktopApp() && <Button variant="secondary" onClick={push} disabled={!!busy || !fullLists}><IconUpload size={16} /> {busy.startsWith("Waiting") ? busy : "Push codes to Tally"}</Button>}
          <span className="ml-auto text-sm text-neutral-500">{counts.done} of {counts.total} parties coded and linked</span>
        </div>
        {!routes.length && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Set up routes and places first, so codes can be made. <button className="font-bold underline" onClick={onRoutes}>Routes & places →</button></p>}
        {!fullLists && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Only Tally ledgers with a balance are known yet. Update the Windows app to 3.5 (tray → Check for updates): it sends every party ledger with its aliases, which also makes "Push codes to Tally" possible.</p>}
        {dupCodes.size > 0 && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">The same code on two parties: {[...dupCodes].join(", ")}</p>}
        <div className="flex flex-wrap gap-2">
          <Text className="min-w-0 flex-1" placeholder="Search name, code or Tally name…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="w-auto" value={kindFilter} onChange={(v) => setKindFilter(v as typeof kindFilter)} options={[{ value: "all", label: "Every type" }, ...PARTY_KINDS.map((k) => ({ value: k.value, label: k.label }))]} />
          <Select className="w-auto" value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[{ value: "todo", label: "Still to do" }, { value: "done", label: "Done" }, { value: "all", label: "All" }]} />
        </div>
      </Card>

      {list.slice(0, 150).map((c) => {
        const { d, done } = status(c);
        const r = routes.find((x) => x.code === d.route);
        const olds = oldCodes(c, cos);
        return (
          <Card key={c.id} className={cn("space-y-3", drafts[c.id] && "ring-2 ring-brand-200", d.code && dupCodes.has(d.code.toUpperCase()) && "ring-2 ring-rose-300")}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-xs text-neutral-500">{isNew(c) ? "New party — not saved yet" : olds.length ? "Old code in Tally: " + olds.join(", ") : "\u00a0"}</p>
              <div className="flex items-center gap-1">
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", isNew(c) ? "bg-brand-50 text-brand-700" : done ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>{isNew(c) ? "New" : done ? "Done" : "To do"}</span>
                {isNew(c) && <RowRemove onClick={() => { setAdded((a) => a.filter((x) => x.id !== c.id)); setDrafts((x) => { const n = { ...x }; delete n[c.id]; return n; }); }} />}
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
              <Field label="Name"><Text value={d.name} onChange={(e) => setDraft(c, { name: e.target.value })} placeholder="e.g. Meghana Electronics And Electricals - Mudgal" className="font-semibold" /></Field>
              <Field label="Mobile"><Text type="tel" inputMode="tel" value={d.mobile} onChange={(e) => setDraft(c, { mobile: e.target.value })} placeholder="10-digit mobile"
                className={cn(!mobileOk(d.mobile) && "border-rose-300 bg-rose-50/40")} /></Field>
              <Field label={"Type" + (why[c.id]?.kind ? " · " + why[c.id].kind : "")}><Select value={d.kind} onChange={(v) => {
                  const kind = v as PartyKind;
                  // off a route: the code follows the type (RC-SUP-01…)
                  const off = !d.route && (!d.code || /^[A-Z]+-[A-Z]{3}-\d+$/.test(d.code));
                  setDraft(c, off ? { kind, code: offRouteCode(district0, kind, nextOffRouteSerial(pending().filter((x) => x.id !== c.id), district0, kind)) } : { kind });
                }} options={PARTY_KINDS.map((k) => ({ value: k.value, label: k.label }))} /></Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.2fr]">
              <Field label="Route">
                <Select value={d.route} onChange={(v) => setDraft(c, placeCode(c, v, "", { ...d, code: "" }))}
                  options={[{ value: "", label: "—" }, ...routes.map((x) => ({ value: x.code, label: x.district + "-" + x.code + " · " + x.name }))]} />
              </Field>
              <Field label="Place">
                <Select value={d.place} onChange={(v) => setDraft(c, placeCode(c, d.route, v, d))}
                  options={[{ value: "", label: "—" }, ...(r?.places || []).map((p) => ({ value: p.short, label: p.short + " · " + p.name }))]} />
              </Field>
              <Field label="Code">
                <Text value={d.code} onChange={(e) => setDraft(c, { code: e.target.value.toUpperCase() })} placeholder="RC-KLM-KVTL-01" className="font-mono" />
              </Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {cos.map((co) => {
                const cur = d.tallyNames[co.key] || (co.parties.find((p) => normalizeName(p.n) === normalizeName(d.name))?.n || "");
                const w = why[c.id]?.[co.key];
                return (
                  <Field key={co.key} label={co.label + (w && w !== "same name" && w !== "saved" ? " · " + w : "")}>
                    <Select value={cur || NONE} onChange={(v) => setDraft(c, { tallyNames: { ...d.tallyNames, [co.key]: v === NONE ? "" : v } })}
                      className={cn(!cur && "text-neutral-400", w === "similar name" && "border-amber-300 bg-amber-50/40")}
                      options={[{ value: NONE, label: "— not in " + co.label + " —" }, ...co.parties.map((p) => p.n).sort().map((n) => ({ value: n, label: n }))]} />
                  </Field>
                );
              })}
            </div>
          </Card>
        );
      })}
      {list.length > 150 && <p className="text-center text-sm text-neutral-500">Showing 150 of {list.length} — search to find others.</p>}

      <Card className="space-y-2">
        <h2 className="font-extrabold">Tally ledgers not linked to any customer</h2>
        <p className="text-sm text-neutral-500">Pick them on the right party above, add a party, or use “Add suppliers from Tally” for Sundry Creditors. (Includes Tally group and adjustment ledgers.)</p>
        {unlinked.map((co) => (
          <details key={co.key} className="text-sm">
            <summary className="cursor-pointer font-semibold">{co.label}: {co.free.length}</summary>
            <p className="mt-1 text-neutral-600">{co.free.map((p) => p.n).sort().join(" · ") || "None"}</p>
          </details>
        ))}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- routes & places */

function Routes() {
  const { settings, settingsLoaded, balances } = useStore();
  const companies = useCompanies();
  const cos = useMemo(() => partiesByCompany(balances, companies), [balances, companies]);
  // the routes as Tally groups them (Windows app 3.7+), else the usual ones
  function suggest() {
    const fromTally = routesFromTally(cos);
    if (fromTally.length) { setDistricts([{ code: "RC", name: "Raichur" }]); setRoutes(fromTally); toast(fromTally.length + " routes filled in from your Tally groups — check the codes and short forms, then Save routes."); }
    else { const s = suggestedRoutes(); setDistricts(s.districts || []); setRoutes(s.routes); toast("Usual routes filled in (update the Windows app to 3.7 to use your Tally groups) — check, then Save routes."); }
  }
  const toast = useToast();
  const [districts, setDistricts] = useState<District[]>(settings.districts || []);
  const [routes, setRoutes] = useState<Route[]>(settings.routes || []);
  const setRoute = (i: number, p: Partial<Route>) => setRoutes((x) => x.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const up = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

  async function save() {
    const d = districts.filter((x) => x.code.trim()).map((x) => ({ code: up(x.code), name: x.name.trim() }));
    const r = routes.filter((x) => x.code.trim()).map((x) => ({ ...x, code: up(x.code), district: up(x.district), name: x.name.trim(),
      places: x.places.filter((p) => p.short.trim() || p.name.trim()).map((p) => ({ name: p.name.trim(), short: up(p.short) })) }));
    const codes = r.map((x) => x.district + "-" + x.code);
    if (new Set(codes).size !== codes.length) { toast("Two routes have the same code."); return; }
    for (const x of r) { const s = x.places.map((p) => p.short); if (new Set(s).size !== s.length) { toast("Two places on " + x.code + " have the same short form."); return; } }
    try { await saveSettings({ ...settings, districts: d, routes: r }, settingsLoaded ? settings : null); toast("Routes saved."); }
    catch (e) { toast("Could not save: " + (e as Error).message); }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save}><IconDeviceFloppy size={16} /> Save routes</Button>
          {!routes.length && <Button variant="secondary" onClick={suggest}><IconSparkles size={16} /> Fill in routes from Tally</Button>}
        </div>
        <p className="text-sm text-neutral-500">A code is <b>District – Route – Place – Serial</b>, e.g. <span className="font-mono">RC-KLM-KVTL-01</span>; the serial counts up per place. A party not on a route gets <b>District – Type – Serial</b>: <span className="font-mono">RC-SUP-01</span> supplier, <span className="font-mono">RC-TEC-01</span> technician, <span className="font-mono">RC-CON-01</span> consumer, <span className="font-mono">RC-TRN-01</span> transporter, <span className="font-mono">RC-EXP-01</span> expense, <span className="font-mono">RC-OUT-01</span> customer outside the routes. Changing a short form later doesn't change codes already given.</p>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-extrabold">Districts</h2>
          <Button size="sm" variant="secondary" onClick={() => setDistricts((x) => [...x, { code: "", name: "" }])}><IconPlus size={15} /> District</Button></div>
        {districts.map((d, i) => (
          <div key={i} className="flex gap-2">
            <Text className="w-24 font-mono" placeholder="RC" value={d.code} onChange={(e) => setDistricts((x) => x.map((y, j) => (j === i ? { ...y, code: e.target.value.toUpperCase() } : y)))} />
            <Text className="flex-1" placeholder="Raichur" value={d.name} onChange={(e) => setDistricts((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
            <RowRemove onClick={() => setDistricts((x) => x.filter((_, j) => j !== i))} />
          </div>
        ))}
      </Card>

      {routes.map((r, i) => (
        <Card key={i} className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[6rem_6rem_1fr_auto]">
            <Field label="District"><Select value={r.district} onChange={(v) => setRoute(i, { district: v })} options={[{ value: "", label: "—" }, ...districts.map((d) => ({ value: d.code, label: d.code }))]} /></Field>
            <Field label="Route code"><Text className="font-mono" placeholder="KLM" value={r.code} onChange={(e) => setRoute(i, { code: e.target.value.toUpperCase() })} /></Field>
            <Field label="Route name"><Text placeholder="Kavithal, Lingasugur, Mudgal" value={r.name} onChange={(e) => setRoute(i, { name: e.target.value })} /></Field>
            <div className="flex items-end"><RowRemove onClick={() => setRoutes((x) => x.filter((_, j) => j !== i))} /></div>
          </div>
          <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Places</p>
          {r.places.map((p, k) => (
            <div key={k} className="flex gap-2">
              <Text className="flex-1" placeholder="Kavithal" value={p.name} onChange={(e) => setRoute(i, { places: r.places.map((y, j) => (j === k ? { ...y, name: e.target.value } : y)) })} />
              <Text className="w-28 font-mono" placeholder="KVTL" value={p.short} onChange={(e) => setRoute(i, { places: r.places.map((y, j) => (j === k ? { ...y, short: e.target.value.toUpperCase() } : y)) })} />
              <RowRemove onClick={() => setRoute(i, { places: r.places.filter((_, j) => j !== k) })} />
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setRoute(i, { places: [...r.places, { name: "", short: "" }] })}><IconPlus size={15} /> Place</Button>
        </Card>
      ))}
      <Button variant="secondary" onClick={() => setRoutes((x) => [...x, { code: "", name: "", district: districts[0]?.code || "", places: [{ name: "", short: "" }] }])}><IconPlus size={16} /> Route</Button>
    </div>
  );
}
