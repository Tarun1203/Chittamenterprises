// One party across Tally companies: a customer can be written differently in
// each company ("Meghana Electronics" in Cash, "Meghana Electronics & Electricals
// - Mudgal" in Chittam). Each customer keeps its ledger name per company
// (tallyNames) and a unique code (district-route-place-serial, e.g.
// RC-KLM-KVTL-01). Every page that looks up a customer in Tally goes through
// partyKey / tallyNameOf here, so the different spellings count as one party.
import { normalizeName, PARTY_KINDS, type BalanceSet, type Customer, type PartyKind, type Route, type Settings, type SubLedger, type TallyParty } from "./data";

/* ---------------- the lookup every page uses ---------------- */

let toCanon = new Map<string, string>();
// called by the store whenever the customer list changes
export function setParties(customers: Customer[]) {
  const m = new Map<string, string>();
  for (const c of customers) {
    if (c.mergedInto) continue;
    const main = normalizeName(c.name);
    for (const n of Object.values(c.tallyNames || {})) if (n) m.set(normalizeName(n), main);
    for (const s of c.subLedgers || []) if (s.ledger) m.set(normalizeName(s.ledger), main);
  }
  toCanon = m;
}
// the key a Tally ledger name (in any company) or a customer name is matched by
export const partyKey = (name: string | undefined) => { const k = normalizeName(name); return toCanon.get(k) ?? k; };
export const sameParty = (a: string | undefined, b: string | undefined) => partyKey(a) === partyKey(b);
// the customer's ledger name in one company
export const tallyNameOf = (c: Pick<Customer, "name" | "tallyNames">, company: string) => c.tallyNames?.[company] || c.name;
// the customer's closing balance in one company (null = no ledger there)
// with brand ledgers, the balances of all of them in that company added up
export function balanceIn(set: BalanceSet | undefined, c: Pick<Customer, "name" | "tallyNames" | "subLedgers">, company: string) {
  const vals = ledgersIn(c, company).map((l) => set?.balances?.[normalizeName(l.ledger)]).filter((v): v is number => v !== undefined);
  return vals.length ? Math.round(vals.reduce((t, v) => t + v, 0) * 100) / 100 : null;
}
// the party's ledgers in one company: its main ledger, then its brand ledgers there
export const ledgersIn = (c: Pick<Customer, "name" | "tallyNames" | "subLedgers">, company: string): { ledger: string; brand: string }[] =>
  [{ ledger: tallyNameOf(c, company), brand: "" }, ...(c.subLedgers || []).filter((s: SubLedger) => s.company === company && s.ledger).map((s) => ({ ledger: s.ledger, brand: s.brand }))];
// the brand ending of a brand ledger's code: Makwell MKW, Flyvision FLY, Haier HAI
export const brandShort = (brand: string) => {
  const u = brand.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const c = (u[0] || "") + u.slice(1).replace(/[AEIOU]/g, "");
  return (c.length >= 3 ? c : u).slice(0, 3);
};
// "Mallu Mobiles - Pothnal - Makwell" next to "Mallu Mobiles - Pothnal": the brand ("Makwell")
export function brandOf(mainLedger: string, other: string) {
  const a = normalizeName(mainLedger), b = normalizeName(other);
  if (!a || b === a || !b.startsWith(a)) return "";
  const rest = other.trim().slice(mainLedger.trim().length).replace(/^[\s\-–(,]+|[\s)]+$/g, "");
  return rest.length >= 2 ? rest.replace(/\b\w/g, (x) => x.toUpperCase()) : "";
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

// what each type asks for: dealers a route and a place, technicians a place, the rest nothing
export const needsRoute = (k: PartyKind) => k === "customer" || k === "both";
export const needsPlace = (k: PartyKind) => needsRoute(k) || k === "technician";
export const kindShort = (k: PartyKind) => PARTY_KINDS.find((x) => x.value === k)?.short || "OTH";
const nextAfter = (others: Customer[], prefix: string) => {
  let max = 0;
  for (const c of others) { const code = c.code?.toUpperCase() || ""; if (code.startsWith(prefix) && /^\d+$/.test(code.slice(prefix.length))) max = Math.max(max, Number(code.slice(prefix.length))); }
  return max + 1;
};
// the next code for a party of this type ("" while a route / place it needs is missing):
//   dealer RC-KLM-KVTL-01 · technician TEC-RCR-01 · supplier VEN-001 · consumer CUS-001 · TRN-001 · EXP-001 · OTH-001
export function makeCode(kind: PartyKind, route: string, place: string, routes: Route[], others: Customer[]) {
  if (needsRoute(kind)) {
    const r = routes.find((x) => x.code === route);
    return r && place ? codeOf(r.district, r.code, place, nextSerial(others, r.district, r.code, place)) : "";
  }
  if (kind === "technician") {
    if (!place) return "";
    const prefix = "TEC-" + place.toUpperCase() + "-";
    return prefix + String(nextAfter(others, prefix)).padStart(2, "0");
  }
  const prefix = kindShort(kind) + "-";
  return prefix + String(nextAfter(others, prefix)).padStart(3, "0");
}
// a code the app made (so it may be replaced when the type, route or place changes)
export const isMadeCode = (code: string) => !code || /^(VEN|CUS|TRN|EXP|OTH)-\d+$|^TEC-[A-Z0-9]+-\d+$|^[A-Z]+-[A-Z0-9]+-[A-Z0-9]+-\d+$|^[A-Z]+-[A-Z]{3}-\d+$/.test(code);
// every place on every route (technicians are coded by place alone)
export const allPlaces = (routes: Route[]) => {
  const seen = new Map<string, { short: string; name: string }>();
  for (const r of routes) for (const p of r.places) if (p.short && !seen.has(p.short)) seen.set(p.short, { short: p.short, name: p.name });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
};

/* ---------------- routes from Tally's own groups ---------------- */

// "Kavithal & Lingasugur & Mudgal" -> places; KVTL-style short forms (consonants, no "h" after
// a consonant: Kavithal KVTL, Pothnal PTNL, Raichur RCR), KLM-style route codes (initials)
const consonants = (w: string) => {
  const u = w.toUpperCase().replace(/[^A-Z]/g, "");
  return (u[0] + u.slice(1).replace(/[AEIOU]/g, "").replace(/([^AEIOU])H/g, "$1")).replace(/(.)\1+/g, "$1");
};
const shortOf = (place: string) => { const ws = place.split(/\s+/).filter(Boolean); return ws.length > 1 ? (consonants(ws[0]).slice(0, 2) + ws.slice(1).map((w) => w[0]).join("")).toUpperCase().slice(0, 4) : consonants(ws[0]).slice(0, 4); };
const routeCodeOf = (places: string[]) => places.length > 1
  ? (places.length === 2 ? consonants(places[0]).slice(0, 2) + places[1][0] : places.map((p) => p[0]).join("")).toUpperCase().slice(0, 4)
  : consonants(places[0]).slice(0, 3);
const NOT_ROUTE = /^(sundry debtors|sundry creditors|customer.*|outer coverage|technician.*|transport.*|billing solution.*|staff.*|rent.*|.*expenses?)$/i;
const splitPlaces = (g: string) => g.split(/\s*(?:&|,|-|\band\b)\s*/i).map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/\b\w/g, (c) => c.toUpperCase()));
export function routesFromTally(cos: CompanyParties[], district = "RC"): Route[] {
  // each route group as written (with how many parties are in it), the business company first
  const seen: { places: string[]; n: number }[] = [];
  for (const co of cos) for (const p of co.parties) if (p.g === "D" && p.p && !NOT_ROUTE.test(p.p.trim())) {
    const places = splitPlaces(p.p.trim());
    const hit = seen.find((x) => x.places.length === places.length && x.places.every((y, i) => y === places[i]));
    if (hit) hit.n++; else seen.push({ places, n: 1 });
  }
  // "Gabbur Devadurga Sirwar" (no separators): split on spaces when each word is a known place
  const known = seen.filter((x) => x.places.length > 1).flatMap((x) => x.places);
  const groups = seen.map((x) => {
    const words = x.places.length === 1 ? x.places[0].split(/\s+/) : [];
    return words.length > 1 && words.every((w) => known.some((k) => similarWord(k, w))) ? { ...x, places: words } : x;
  });
  const has = (r: string[], place: string) => r.some((x) => similarWord(x, place));
  // the same places in another order, or a part of a bigger route: joined into it
  const routes: { places: string[]; n: number; src: string[] }[] = [];
  for (const g of [...groups].sort((a, b) => b.places.length - a.places.length || b.n - a.n)) {
    const into = routes.find((r) => g.places.every((x) => has(r.places, x)) || r.places.every((x) => has(g.places, x)));
    if (into) { for (const x of g.places) if (!has(into.places, x)) into.places.push(x); into.n += g.n; if (g.n > into.n - g.n) into.src = g.places; continue; }
    routes.push({ places: [...g.places], n: g.n, src: g.places });
  }
  // a group whose places are all on other routes ("Sindhanur & Pothnal") isn't a route of its own —
  // the smallest such group goes first, so the real routes stay
  let list = [...routes];
  for (const r of [...routes].sort((a, b) => a.n - b.n)) {
    const others = list.filter((o) => o !== r);
    if (r.places.length > 1 && r.places.every((x) => others.some((o) => has(o.places, x)))) list = others;
  }
  const out: Route[] = [];
  for (const r of list) {
    // the most used spelling and order first; its code (KLM even when another company adds Gugunta)
    const places = [...r.src, ...r.places.filter((x) => !has(r.src, x))];
    const base = routeCodeOf(r.src);
    let code = base, n = 2;
    while (out.some((x) => x.code === code)) code = base + n++;
    out.push({ code, name: places.join(", "), district, places: places.map((pl) => ({ name: pl, short: shortOf(pl) })) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
const similarWord = (a: string, b: string) => { const x = a.toLowerCase().replace(/[^a-z]/g, ""), y = b.toLowerCase().replace(/[^a-z]/g, ""); return x === y || (x.length >= 5 && y.length >= 5 && lev(x, y) <= 2); };

/* ---------------- what kind of party: from its Tally groups and name ---------------- */

export interface KindGuess { kind: PartyKind; route?: Route; place?: Route["places"][number]; why: string }
const TRANSPORT = /\b(transports?|travels|logistics|cargo|parcels?|roadlines|carriers?|movers|couriers?|lorry|tempo)\b/i;
const TECH = /\b(technician|mechanic)\b/i;
const EXPENSE = /\b(rent|salary|salaries|staff|wages|electricity bill|landlord|building owner|telephone bill|internet bill|advance to)\b/i;
const OTHER = /account\s*adj|adjust|suspense|chittam enterprises|vamana enterprises|cash bill|^customer$/i;
const BUSINESS = /\b(electronics?|electricals?|enterprises?|traders?|agenc(y|ies)|stores?|cent(er|re)|mobiles?|appliances?|hardware|steel|furniture|distributors?|marketing|industries|company|co|pvt|ltd|limited|hotels?|computers?|telecoms?|lights|agro|textiles|associates|groups?|world|solutions?|needs|home|shop|mart|bazaa?r|seeds|xerox|digital|residency|inn|clinic|hospital|school|college|sales|services?|systems?|technologies|retail|ventures)\b/i;

// one party's ledgers in every company -> its kind, and its route / place when it's on one
export function classify(ledgers: TallyParty[], routes: Route[]): KindGuess {
  const groups = ledgers.map((l) => (l.p || "").trim());
  const names = ledgers.map((l) => l.n);
  const all = [...names, ...groups].join(" | ");
  const debtor = ledgers.some((l) => l.g === "D"), creditor = ledgers.some((l) => l.g === "C");
  if (OTHER.test(names.join(" | "))) return { kind: "other", why: "own company / adjustment ledger" };
  if (groups.some((g) => /transport/i.test(g)) || TRANSPORT.test(names.join(" "))) return { kind: "transporter", why: groups.find((g) => /transport/i.test(g)) ? "Tally group “" + groups.find((g) => /transport/i.test(g)) + "”" : "name says transport" };
  if (groups.some((g) => /^technician/i.test(g)) || (TECH.test(names.join(" ")) && !ledgers.every((l) => l.g === "C"))) return { kind: "technician", why: groups.some((g) => /^technician/i.test(g)) ? "Tally group “Technician”" : "name says technician" };
  if (groups.some((g) => /staff|rent|salar|expense/i.test(g)) || EXPENSE.test(names.join(" "))) return { kind: "expense", why: "rent / staff / expense" };
  // on a route: its Tally group is one of the routes (or its town is a place on one)
  for (const g of groups) {
    const r = routes.find((x) => x.places.length && g.split(/\s*(?:&|,|-|\band\b)\s*/i).filter(Boolean).every((w) => x.places.some((p) => similarWord(p.name, w))) );
    if (r) {
      const gp = guessPlace(names, [r]);
      return { kind: creditor ? "both" : "customer", route: r, place: gp?.place || (r.places.length === 1 ? r.places[0] : undefined), why: "Tally group “" + g + "”" + (creditor ? ", also under Sundry Creditors" : "") };
    }
  }
  const town = guessPlace(names, routes);
  if (debtor && town) return { kind: creditor ? "both" : "customer", route: town.route, place: town.place, why: "town on route " + town.route.code };
  if (debtor && creditor) return { kind: "both", why: "under Sundry Debtors and Sundry Creditors" };
  if (creditor) return { kind: "supplier", why: "under Sundry Creditors" };
  if (groups.some((g) => /^customer/i.test(g))) return { kind: "consumer", why: "Tally group “" + groups.find((g) => /^customer/i.test(g)) + "”" };
  if (groups.some((g) => /outer coverage/i.test(g))) return { kind: "customer", why: "Outer Coverage (not on a route)" };
  // a person's name, no GSTIN and no business words -> a consumer
  if (!ledgers.some((l) => l.gst) && !BUSINESS.test(names.join(" "))) return { kind: "consumer", why: "a person's name, no GSTIN" };
  return { kind: "customer", why: "under Sundry Debtors" };
}

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
