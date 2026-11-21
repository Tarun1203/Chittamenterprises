// Party codes: one unique code per party (district-route-place-serial, e.g.
// RC-KLM-KVTL-01) and its ledger name in each Tally company, so a party written
// differently in Chittam, Cash and Vamana counts as one everywhere. Saved in the
// app; "Push to Tally" (Windows app) then adds the code as the ledger's alias in
// every company, after a confirmation there.
import { useMemo, useState } from "react";
import { IconDeviceFloppy, IconPlus, IconSparkles, IconUpload } from "@tabler/icons-react";
import { Button, Card, Field, PageHeader, useToast } from "@/components/kit";
import { RowRemove, Select, Text } from "@/components/forms";
import { useStore } from "@/lib/store";
import { logEvent, normalizeName, saveRecords, saveSettings, type Customer, type District, type Route } from "@/lib/data";
import { useCompanies } from "@/lib/companies";
import { codeOf, guessPlace, looksLikeCode, nextSerial, oldCodes, partiesByCompany, suggestedRoutes, suggestLedgers } from "@/lib/parties";
import { desktopRequest, inDesktopApp } from "@/lib/desktop";
import { cn } from "@/lib/utils";

type Draft = { code: string; district: string; route: string; place: string; tallyNames: Record<string, string> };
const NONE = "__none__";

export function PartyCodes() {
  const [tab, setTab] = useState<"parties" | "routes">("parties");
  return (
    <div>
      <PageHeader icon="location" eyebrow="Masters" title="Party codes"
        subtitle="One unique code for each party (district – route – place – serial, e.g. RC-KLM-KVTL-01) and its ledger name in every Tally company." />
      <div className="mb-4 flex gap-2">
        {(["parties", "routes"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("rounded-full border px-4 py-1.5 text-sm font-bold", tab === t ? "border-brand-600 bg-brand-600 text-white" : "border-neutral-200 bg-white text-neutral-600")}>
            {t === "parties" ? "Parties" : "Routes & places"}
          </button>
        ))}
      </div>
      {tab === "parties" ? <Parties onRoutes={() => setTab("routes")} /> : <Routes />}
    </div>
  );
}

/* ---------------------------------------------------------------- parties */

function Parties({ onRoutes }: { onRoutes: () => void }) {
  const { customers, allCustomers, balances, settings } = useStore();
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

  const draftOf = (c: Customer): Draft => drafts[c.id] || { code: c.code || "", district: c.district || "", route: c.route || "", place: c.place || "", tallyNames: c.tallyNames || {} };
  const setDraft = (c: Customer, p: Partial<Draft>) => setDrafts((d) => ({ ...d, [c.id]: { ...draftOf(c), ...p } }));
  const changed = customers.filter((c) => drafts[c.id] && JSON.stringify(drafts[c.id]) !== JSON.stringify({ code: c.code || "", district: c.district || "", route: c.route || "", place: c.place || "", tallyNames: c.tallyNames || {} }));

  // codes as they'd be after saving (to find the next serial and duplicates)
  const pending = (): Customer[] => allCustomers.map((c) => (drafts[c.id] ? { ...c, code: drafts[c.id].code } : c));
  const dupCodes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const c of pending()) if (c.code && !c.mergedInto) seen.set(c.code.toUpperCase(), (seen.get(c.code.toUpperCase()) || 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }, [drafts, allCustomers]);   // eslint-disable-line react-hooks/exhaustive-deps

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

  // fills in every customer's Tally ledgers, and a route / place / code where the town is known
  function suggestAll() {
    const next: Record<string, Draft> = { ...drafts };
    const whyAll: Record<string, Record<string, string>> = {};
    const takenNow = new Map(taken);
    const work = pending();
    for (const c of customers) {
      const base = next[c.id] || draftOf(c);
      const s = suggestLedgers({ ...c, tallyNames: base.tallyNames }, cos, takenNow);
      const tallyNames: Record<string, string> = {};
      whyAll[c.id] = {};
      for (const [k, v] of Object.entries(s)) {
        if (normalizeName(v.name) !== normalizeName(c.name)) tallyNames[k] = v.name;   // only a different spelling needs saving
        whyAll[c.id][k] = v.why;
        if (!takenNow.has(k)) takenNow.set(k, new Set());
        takenNow.get(k)!.add(v.name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim());
      }
      let d: Draft = { ...base, tallyNames: { ...base.tallyNames, ...tallyNames } };
      if (!d.code && routes.length) {
        const g = guessPlace([c.name, ...Object.values(s).map((v) => v.name)], routes);
        if (g) {
          const code = codeOf(g.route.district, g.route.code, g.place.short, nextSerial(work, g.route.district, g.route.code, g.place.short));
          d = { ...d, district: g.route.district, route: g.route.code, place: g.place.short, code };
          const i = work.findIndex((x) => x.id === c.id);
          if (i >= 0) work[i] = { ...work[i], code };
        }
      }
      next[c.id] = d;
    }
    setDrafts(next);
    setWhy(whyAll);
    toast("Suggestions filled in — check them, then Save. Nothing is saved yet.");
  }

  async function save() {
    if (dupCodes.size) { toast("Two parties have the same code: " + [...dupCodes].join(", ")); return; }
    if (!changed.length) { toast("Nothing changed."); return; }
    setBusy("Saving…");
    try {
      await saveRecords(changed.map((c) => {
        const d = drafts[c.id];
        const tallyNames = Object.fromEntries(Object.entries(d.tallyNames).filter(([, v]) => v && normalizeName(v) !== normalizeName(c.name)));
        return { coll: "customers", id: c.id, data: { ...c, code: d.code.trim().toUpperCase(), district: d.district, route: d.route, place: d.place, tallyNames }, before: c };
      }));
      await logEvent("party-codes-saved", { name: "Party codes", customers: changed.length });
      toast(changed.length + " parties saved.");
      setDrafts({});
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
    const linked = cos.filter((co) => co.parties.some((p) => normalizeName(p.n) === normalizeName(d.tallyNames[co.key] || c.name))).length;
    return { d, linked, done: !!d.code && linked > 0 };
  };
  const list = customers
    .filter((c) => !q.trim() || (c.name + " " + (draftOf(c).code || "") + " " + Object.values(draftOf(c).tallyNames).join(" ")).toLowerCase().includes(q.trim().toLowerCase()))
    .filter((c) => filter === "all" || (filter === "done") === status(c).done)
    .sort((a, b) => (draftOf(a).code || "~").localeCompare(draftOf(b).code || "~") || a.name.localeCompare(b.name));
  const counts = { done: customers.filter((c) => status(c).done).length, total: customers.length };
  const unlinked = cos.map((co) => {
    const used = new Set(customers.map((c) => normalizeName(draftOf(c).tallyNames[co.key] || c.name)));
    return { ...co, free: co.parties.filter((p) => !used.has(normalizeName(p.n))) };
  });

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={suggestAll} disabled={!!busy}><IconSparkles size={16} /> Suggest for all</Button>
          <Button variant="secondary" onClick={save} disabled={!!busy || !changed.length}><IconDeviceFloppy size={16} /> {busy === "Saving…" ? busy : "Save" + (changed.length ? " (" + changed.length + ")" : "")}</Button>
          {inDesktopApp() && <Button variant="secondary" onClick={push} disabled={!!busy || !fullLists}><IconUpload size={16} /> {busy.startsWith("Waiting") ? busy : "Push codes to Tally"}</Button>}
          <span className="ml-auto text-sm text-neutral-500">{counts.done} of {counts.total} parties coded and linked</span>
        </div>
        {!routes.length && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Set up routes and places first, so codes can be made. <button className="font-bold underline" onClick={onRoutes}>Routes & places →</button></p>}
        {!fullLists && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Only Tally ledgers with a balance are known yet. Update the Windows app to 3.5 (tray → Check for updates): it sends every party ledger with its aliases, which also makes "Push codes to Tally" possible.</p>}
        {dupCodes.size > 0 && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">The same code on two parties: {[...dupCodes].join(", ")}</p>}
        <div className="flex flex-wrap gap-2">
          <Text className="min-w-0 flex-1" placeholder="Search name, code or Tally name…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="w-auto" value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[{ value: "todo", label: "Still to do" }, { value: "done", label: "Done" }, { value: "all", label: "All parties" }]} />
        </div>
      </Card>

      {list.slice(0, 150).map((c) => {
        const { d, done } = status(c);
        const r = routes.find((x) => x.code === d.route);
        const olds = oldCodes(c, cos);
        return (
          <Card key={c.id} className={cn("space-y-3", drafts[c.id] && "ring-2 ring-brand-200", d.code && dupCodes.has(d.code.toUpperCase()) && "ring-2 ring-rose-300")}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-extrabold">{c.name}</p>
                <p className="text-xs text-neutral-500">{c.mobile || "No mobile"}{olds.length ? " · old code in Tally: " + olds.join(", ") : ""}</p>
              </div>
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", done ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>{done ? "Done" : "To do"}</span>
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
                const cur = d.tallyNames[co.key] || (co.parties.some((p) => normalizeName(p.n) === normalizeName(c.name)) ? c.name : "");
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
        <p className="text-sm text-neutral-500">Pick them on the right customer above, or add them as customers. (Includes Tally group and adjustment ledgers.)</p>
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
  const { settings, settingsLoaded } = useStore();
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
          {!routes.length && <Button variant="secondary" onClick={() => { const s = suggestedRoutes(); setDistricts(s.districts || []); setRoutes(s.routes); }}><IconSparkles size={16} /> Fill in suggested routes</Button>}
        </div>
        <p className="text-sm text-neutral-500">A code is <b>District – Route – Place – Serial</b>, e.g. <span className="font-mono">RC-KLM-KVTL-01</span>. The serial counts up per place. Changing a short form later doesn't change codes already given.</p>
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
