// One party across Tally companies: a customer can be written differently in
// each company ("Meghana Electronics" in Cash, "Meghana Electronics & Electricals
// - Mudgal" in Chittam). Each customer keeps its ledger name per company
// (tallyNames) and a unique code (district-route-place-serial, e.g.
// RC-KLM-KVTL-01). Every page that looks up a customer in Tally goes through
// partyKey / tallyNameOf here, so the different spellings count as one party.
import { normalizeName, type BalanceSet, type Customer, type Route, type Settings, type TallyParty } from "./data";

/* ---------------- the lookup every page uses ---------------- */

let toCanon = new Map<string, string>();
// called by the store whenever the customer list changes
export function setParties(customers: Customer[]) {
  const m = new Map<string, string>();
  for (const c of customers) {
    if (c.mergedInto) continue;
    const main = normalizeName(c.name);
    for (const n of Object.values(c.tallyNames || {})) if (n) m.set(normalizeName(n), main);
  }
  toCanon = m;
}
// the key a Tally ledger name (in any company) or a customer name is matched by
export const partyKey = (name: string | undefined) => { const k = normalizeName(name); return toCanon.get(k) ?? k; };
export const sameParty = (a: string | undefined, b: string | undefined) => partyKey(a) === partyKey(b);
// the customer's ledger name in one company
export const tallyNameOf = (c: Pick<Customer, "name" | "tallyNames">, company: string) => c.tallyNames?.[company] || c.name;
// the customer's closing balance in one company (null = no ledger there)
export function balanceIn(set: BalanceSet | undefined, c: Pick<Customer, "name" | "tallyNames">, company: string) {
  const v = set?.balances?.[normalizeName(tallyNameOf(c, company))];
  return v === undefined ? null : v;
}

/* ---------------- codes ---------------- */

export const codeOf = (district: string, route: string, short: string, serial: number) =>
  [district, route, short].map((x) => x.trim().toUpperCase()).join("-") + "-" + String(serial).padStart(2, "0");
// the next free serial for a place on a route
export function nextSerial(customers: Customer[], district: string, route: string, short: string) {
  const prefix = [district, route, short].map((x) => x.trim().toUpperCase()).join("-") + "-";
  let max = 0;
  for (const c of customers) if (c.code?.toUpperCase().startsWith(prefix)) max = Math.max(max, Number(c.code.slice(prefix.length)) || 0);
  return max + 1;
}
// a code is any alias that looks like one (letters/digits joined by dashes, not a phone number)
export const looksLikeCode = (a: string) => /^[A-Z]{2,}[A-Z0-9]*(-[A-Z0-9]+)+$/i.test(a.trim()) && !/^\d[\d-]*$/.test(a.trim());

/* ---------------- suggested routes (from the codes already in Tally) ---------------- */

export function suggestedRoutes(): { districts: Settings["districts"]; routes: Route[] } {
  const p = (name: string, short: string) => ({ name, short });
  return {
    districts: [{ code: "RC", name: "Raichur" }],
    routes: [
      { code: "CTY", name: "Raichur city", district: "RC", places: [p("Raichur", "RCR")] },
      { code: "KLM", name: "Kavithal, Lingasugur, Mudgal", district: "RC", places: [p("Kavithal", "KVTL"), p("Lingasugur", "LGSR"), p("Mudgal", "MDGL"), p("Hutti", "HUTI"), p("Gugunta", "GGNT")] },
      { code: "GDS", name: "Gabbur, Devadurga, Sirwar", district: "RC", places: [p("Gabbur", "GBR"), p("Devadurga", "DVDG"), p("Sirwar", "SRWR")] },
      { code: "SNM", name: "Sindhanur, Maski", district: "RC", places: [p("Sindhanur", "SDNR"), p("Maski", "MSKI")] },
      { code: "MNP", name: "Manvi, Pothnal", district: "RC", places: [p("Manvi", "MNVI"), p("Pothnal", "PTNL")] },
      { code: "GCS", name: "Gilesugur Camp, Shaktinagar", district: "RC", places: [p("Gilesugur Camp", "GLCP"), p("Shaktinagar", "SKTN")] },
    ],
  };
}

/* ---------------- suggestions: which Tally ledgers are this customer ---------------- */

export interface CompanyParties { key: string; label: string; parties: TallyParty[] }
// every party ledger per company: the full list from the Windows app (3.5+), else the names with a balance
export function partiesByCompany(balances: Record<string, BalanceSet>, companies: { key: string; label: string }[]): CompanyParties[] {
  return companies.map((co) => {
    const b = balances[co.key];
    const list = b?.parties?.length ? b.parties : Object.keys({ ...(b?.balances || {}), ...(b?.names || {}) }).map((k) => ({ n: b?.names?.[k] || k }));
    return { key: co.key, label: co.label, parties: list };
  });
}

const GENERIC = new Set(("and the m s ms mrs mr shri sri shree sree new co company pvt ltd private limited electronics electronic electricals electrical electric elec elecro " +
  "enterprises enterprise ent traders trader trading agencies agency stores store shop center centre home appliances appliance mobiles mobile hardware hardwares steel steels " +
  "furniture furnitures sons brothers bros world house point gallery mart sales service services servies marketing distributors distributor dealers dealer plywood ply paints " +
  "sanitary glass agro industries works emporium bazaar bazar technician technologies telecoms telecom computers computer lights general residency textiles").split(/\s+/));
const words = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function parse(name: string) {
  const parts = name.split(/\s*[-–]\s+|\s+[-–]\s*|\s*\(\s*|\s*\)\s*/).filter(Boolean);
  const w = words(parts[0] || name).split(" ").filter(Boolean);
  return { core: w.filter((x) => !GENERIC.has(x) && x.length > 1), place: words(parts.slice(1).join(" ")) };
}
function lev(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const weq = (a: string, b: string) => a === b || (a.length >= 6 && b.length >= 6 && lev(a, b) <= 1) || (a.length >= 8 && b.length >= 8 && lev(a, b) <= 2);
// the same party by name: the same distinctive words (trade words like "Electronics" don't count) and no two different towns
export function similarNames(x: string, y: string) {
  if (words(x) === words(y)) return true;
  const a = parse(x), b = parse(y);
  if (!a.core.length || !b.core.length || a.core.join("").length < 5) return false;
  const cover = (s: typeof a, l: typeof a) => s.core.every((w) => l.core.some((v) => weq(w, v)) || l.place.split(" ").some((v) => weq(w, v)));
  if (!cover(a, b) || !cover(b, a)) return false;
  if (a.place && b.place && !a.place.split(" ").some((w) => b.place.split(" ").some((v) => weq(w, v)))) return false;
  return true;
}
const mob = (s?: string) => { const d = (s || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const normCode = (a: string) => a.toUpperCase().replace(/\bLING\b/g, "LNG").replace(/-0+(\d)/g, "-$1");

// for one customer: the best ledger in each company — its saved one, else the same name,
// else the same mobile or old code, else a similar name (only when exactly one fits)
export function suggestLedgers(c: Customer, cos: CompanyParties[], taken: Map<string, Set<string>>) {
  const out: Record<string, { name: string; why: string }> = {};
  const own = cos.flatMap((co) => co.parties.filter((p) => words(p.n) === words(c.name)));
  const myMobiles = new Set([mob(c.mobile), ...own.flatMap((p) => [mob(p.m), ...(p.al || []).map(mob)])].filter(Boolean));
  const myCodes = new Set(own.flatMap((p) => (p.al || []).filter(looksLikeCode).map(normCode)));
  for (const co of cos) {
    const saved = c.tallyNames?.[co.key];
    if (saved) { out[co.key] = { name: saved, why: "saved" }; continue; }
    const free = co.parties.filter((p) => !taken.get(co.key)?.has(words(p.n)));
    const exact = free.find((p) => words(p.n) === words(c.name));
    if (exact) { out[co.key] = { name: exact.n, why: "same name" }; continue; }
    const byCode = free.filter((p) => (p.al || []).some((a) => looksLikeCode(a) && myCodes.has(normCode(a))));
    if (byCode.length === 1) { out[co.key] = { name: byCode[0].n, why: "same code" }; continue; }
    const byMobile = free.filter((p) => [mob(p.m), ...(p.al || []).map(mob)].some((m) => m && myMobiles.has(m)));
    if (byMobile.length === 1) { out[co.key] = { name: byMobile[0].n, why: "same mobile" }; continue; }
    const byName = free.filter((p) => similarNames(p.n, c.name));
    if (byName.length === 1) out[co.key] = { name: byName[0].n, why: "similar name" };
  }
  return out;
}
// the old route codes (aliases) a customer's ledgers already carry in Tally
export function oldCodes(c: Customer, cos: CompanyParties[]) {
  const set = new Set<string>();
  for (const co of cos) {
    const n = words(tallyNameOf(c, co.key));
    for (const p of co.parties) if (words(p.n) === n) for (const a of p.al || []) if (looksLikeCode(a)) set.add(a);
  }
  return [...set];
}
// a place on one of the routes from a Tally name's town ("… - Mudgal")
export function guessPlace(names: string[], routes: Route[]) {
  for (const n of names) {
    const town = words(n.split(/\s*[-–]\s+/).slice(1).join(" "));
    if (!town) continue;
    for (const r of routes) for (const pl of r.places) if (town.split(" ").some((w) => weq(w, words(pl.name).split(" ")[0]))) return { route: r, place: pl };
  }
  return null;
}
