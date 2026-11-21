// The app's data: the same Firestore collections and fields as the current
// app, so both can be used side by side. Rules that never change:
//   - nothing is ever deleted (there is no delete function here, and the
//     database rules refuse deletes);
//   - every add / edit also writes an entry to the activity log (History).
import { collection, doc, onSnapshot, serverTimestamp, writeBatch, addDoc, getDocs, query, orderBy, limit, setDoc, runTransaction, type DocumentData, type Timestamp } from "firebase/firestore";
import { db, auth } from "./firebase";
import { newConfig, openDoc, sealDoc, setCryptoConfig, type CryptoConfig } from "./crypto";

// removed: hidden from lists (kept, never deleted); mergedInto: the customer it was merged into
// code: the party's unique code (district-route-place-serial, e.g. RC-KLM-KVTL-01);
// tallyNames: its ledger name in each Tally company when written differently there
export interface Customer {
  id: string; name: string; mobile?: string; removed?: boolean; removedAt?: string; mergedInto?: string; mergedAt?: string;
  code?: string; district?: string; route?: string; place?: string; tallyNames?: Record<string, string>;
}
export interface Product { id: string; name: string; category?: string; price?: number }
export interface Transport { id: string; name: string; contactPerson?: string; phone?: string; branch?: string }
export interface Settings {
  businessName: string;
  address: string;
  upiList: { upiId: string; payeeName?: string; isDefault?: boolean }[];
  bankList: { label?: string; accountNo: string; ifsc?: string; bankBranch?: string; isDefault?: boolean }[];
  paymentModes: string[];
  notDuplicates?: string[];   // customer pairs marked "not duplicates" ("idA|idB")
  districts?: District[];     // for party codes
  routes?: Route[];
}
export interface District { code: string; name: string }
export interface Place { name: string; short: string }
export interface Route { code: string; name: string; district: string; places: Place[] }

// avail: how many can be packed now (no stock for the rest, which stays pending in
// the order); missing = all of it
export interface OrderItem { name: string; qty: number; rate: number; amount: number; avail?: number }
export interface Order {
  id: string; orderNo: string; date: string; deliveryDate?: string;
  customerId: string; customerName: string; mobile?: string;
  status: string; advance: number; items: OrderItem[]; total: number; notes?: string;
  transport?: string; transportPhone?: string; freightTerms?: string; freight?: number;
}
export interface ServiceItem {
  product: string; qty: number; serial?: string; issue?: string;
  action: string; replProduct?: string; replSerial?: string; charges: number;
}
export interface ServiceJob {
  id: string; jobNo: string; receivedDate: string; inTransport?: string;
  customerId: string; customerName: string; mobile?: string;
  status: string; timeline?: string; items: ServiceItem[]; totalCharges: number;
  sentDate?: string; outTransport?: string; notes?: string;
}
export interface Receipt {
  id: string; date: string; customerId: string; customerName: string; mode: string;
  business: number; cash: number; source: string; ref?: string; note?: string; cancelled?: boolean;
  tallyNo?: string; tallyId?: string;   // the Tally voucher this payment is linked to
  receivedBy?: string;   // cash: who collected it
  txnRef?: string;       // other modes: transaction ID / UTR / cheque no.
  extra?: Record<string, number>;   // amounts for companies beyond Chittam Enterprises and Cash (by company key)
}
export interface BalanceSet {
  company: string; label?: string; file?: string; importedAt?: string; importedBy?: string;
  balances: Record<string, number>; names?: Record<string, string>;
  // every party ledger in the company (Windows app 3.5+): n name, g D/C (Sundry Debtors / Creditors), m mobile, al aliases
  parties?: TallyParty[];
}
export interface TallyParty { n: string; g?: string; m?: string; al?: string[] }

export const defaultSettings: Settings = {
  businessName: "Chittam Enterprises",
  address: "",
  upiList: [],
  bankList: [],
  paymentModes: ["Cash", "UPI", "Bank Transfer", "Cheque"],
};

const META = ["createdAt", "createdBy", "updatedAt", "updatedBy"];

// a record as the app uses it: without the database bookkeeping fields
export function strip<T extends object>(data: T): T {
  const o: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  META.forEach((k) => delete o[k]);
  return o as T;
}

// stable JSON (sorted keys, no undefined) — Firestore rejects undefined, and
// key order must not count as a change
export function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    Object.keys(v as object).sort().forEach((k) => {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) o[k] = stable(val);
    });
    return o;
  }
  return v;
}
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

// same id style as the current app
export function uid(prefix = "c_") {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function normalizeName(s: string | undefined) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/* ---------------- reading (live) ---------------- */

// records are opened (decrypted) before they reach the page; a slower, older
// update never replaces a newer one
export function listenCollection<T>(name: string, cb: (items: T[], fromCache: boolean) => void, onError?: (e: Error) => void) {
  let seq = 0;
  return onSnapshot(
    collection(db, name),
    { includeMetadataChanges: true },
    (snap) => {
      const mine = ++seq;
      Promise.all(snap.docs.map(async (d) => ({ id: d.id, ...strip(await openDoc(d.data(), name + "/" + d.id)) }) as T))
        .then((items) => { if (mine === seq) cb(items, snap.metadata.fromCache); })
        .catch((e) => onError?.(e));
    },
    onError,
  );
}

export function listenDoc<T>(path: string, id: string, cb: (data: T | null) => void, onError?: (e: Error) => void) {
  let seq = 0;
  return onSnapshot(doc(db, path, id), (d) => {
    const mine = ++seq;
    (d.exists() ? openDoc(d.data(), path + "/" + id).then((x) => strip(x) as T) : Promise.resolve(null))
      .then((x) => { if (mine === seq) cb(x); })
      .catch((e) => onError?.(e));
  }, onError);
}

// settings/crypto: whether the data is encrypted (and the check for the passphrase); readable, never encrypted
export function listenCrypto(cb: (c: CryptoConfig | null) => void, onError?: (e: Error) => void) {
  return onSnapshot(doc(db, "settings", "crypto"), (d) => {
    const c = d.exists() ? (d.data() as CryptoConfig) : null;
    setCryptoConfig(c).then(() => cb(c && c.on ? c : null));
  }, onError);
}

/* ---------------- writing (with the activity log) ---------------- */

interface Write { coll: string; id: string; data: DocumentData; before?: DocumentData | null }

function displayName(coll: string, data: DocumentData) {
  if (data.name) return String(data.name);
  if (data.businessName) return String(data.businessName);
  const no = data.orderNo || data.jobNo;
  if (no) return no + (data.customerName ? " — " + data.customerName : "");
  return "";
}

export async function saveRecords(writes: Write[]) {
  const user = auth.currentUser;
  if (!user || !writes.length) return;
  const by = user.email || "";
  // chunks keep each batch well under Firestore's 500-write limit
  for (let i = 0; i < writes.length; i += 200) {
    const batch = writeBatch(db);
    for (const w of writes.slice(i, i + 200)) {
      const data = stable(strip(w.data)) as DocumentData;
      const isNew = !w.before;
      const record: DocumentData = { ...data, updatedAt: serverTimestamp(), updatedBy: by };
      if (isNew) Object.assign(record, { createdAt: serverTimestamp(), createdBy: by });
      batch.set(doc(db, w.coll, w.id), await sealDoc(w.coll, record), { merge: w.coll !== "settings" });
      batch.set(doc(collection(db, "activity")), await sealDoc("activity", {
        collection: w.coll,
        docId: w.id,
        action: isNew ? "create" : "update",
        name: displayName(w.coll, data),
        before: w.before ? stable(strip(w.before)) : null,
        after: data,
        at: serverTimestamp(),
        by,
      }));
    }
    await batch.commit();
  }
}

// save one record; does nothing if it didn't change
export async function saveRecord<T extends { id: string }>(coll: string, item: T, before?: T | null) {
  if (before && same(strip(before), strip(item))) return false;
  await saveRecords([{ coll, id: item.id, data: item as unknown as DocumentData, before: (before as unknown as DocumentData) || null }]);
  return true;
}

export async function saveSettings(next: Settings, before: Settings | null) {
  if (before && same(before, next)) return;
  await saveRecords([{ coll: "settings", id: "main", data: next as unknown as DocumentData, before: (before as unknown as DocumentData) || null }]);
}

// one entry in the activity log for anything that isn't a record change
export async function logEvent(action: string, details: Record<string, unknown> = {}) {
  const user = auth.currentUser;
  if (!user) return;
  const d = stable(details) as Record<string, unknown>;
  await addDoc(collection(db, "activity"), await sealDoc("activity", {
    collection: "app",
    action,
    name: (d.name as string) || (d.customerName as string) || "",
    details: d,
    at: serverTimestamp(),
    by: user.email || "",
  }));
}

// every generated message is kept (text + the form's fields) and logged;
// pressing Generate twice with the same text saves it once
const lastMessage: Record<string, string> = {};
export async function logMessage(type: string, customer: Customer | null, text: string, inputs: Record<string, unknown>) {
  const user = auth.currentUser;
  if (!user || lastMessage[type] === text) return;
  lastMessage[type] = text;
  const who = { customerId: customer?.id || "", customerName: customer?.name || "", mobile: customer?.mobile || "" };
  const batch = writeBatch(db);
  const msgRef = doc(collection(db, "messages"));
  batch.set(msgRef, await sealDoc("messages", { type, text, inputs: stable(inputs), ...who, at: serverTimestamp(), by: user.email || "" }));
  batch.set(doc(collection(db, "activity")), await sealDoc("activity", {
    collection: "app", action: "message-generated", name: who.customerName,
    details: { type, messageId: msgRef.id, ...who }, at: serverTimestamp(), by: user.email || "",
  }));
  await batch.commit();
}

/* ---------------- history (read-only) ---------------- */
export interface ActivityEntry {
  id: string; collection: string; docId?: string; action: string; name?: string;
  before?: Record<string, unknown> | null; after?: Record<string, unknown>; details?: Record<string, unknown>;
  at?: Timestamp | null; by?: string;
}
export interface MessageEntry {
  id: string; type: string; text: string; customerId?: string; customerName?: string; mobile?: string;
  inputs?: Record<string, unknown>; at?: Timestamp | null; by?: string;
}
// the latest entries, newest first
export async function loadLatest<T>(coll: "activity" | "messages", count = 300) {
  const snap = await getDocs(query(collection(db, coll), orderBy("at", "desc"), limit(count)));
  // entries from before encryption was turned on stay as they were (readable)
  return Promise.all(snap.docs.map(async (d) => ({ id: d.id, ...(await openDoc(d.data())) }) as T));
}

/* ---------------- Tally balances ---------------- */
// replaces one company's balances (same document the Windows app's sync writes)
export async function saveBalances(company: string, entry: BalanceSet & { matched: number; unmatched: string[] }) {
  const user = auth.currentUser;
  if (!user) return;
  await setDoc(doc(db, "balances", company), await sealDoc("balances", { ...(stable(entry) as object), at: serverTimestamp(), by: user.email || "" }));
  await logEvent("balances-imported", { name: entry.label, file: entry.file, matched: entry.matched, unmatched: entry.unmatched.length });
}

/* ---------------- Tally transactions (sent by the Windows app) ---------------- */
// d date (yyyy-mm-dd), t voucher type, n number, p customer ledger, a amount,
// dr customer debited (sale) / credited (receipt), nar narration, id Tally GUID
// via: the other ledger(s) in the voucher — Cash, a bank… (how it was booked)
export interface TallyVoucher { d: string; t: string; n: string; p: string; a: number; dr: boolean; nar?: string; via?: string; id?: string }
export interface TallyVoucherSet { company: string; label?: string; tallyCompany?: string; from?: string; to?: string; syncedAt?: string; count?: number; vouchers: TallyVoucher[] }
// read once when the Tally Match page opens (a few hundred KB; not kept live)
export async function loadTallyVouchers() {
  const snap = await getDocs(collection(db, "tallyVouchers"));
  const out: Record<string, TallyVoucherSet> = {};
  for (const d of snap.docs) out[d.id] = await openDoc<TallyVoucherSet>(d.data(), "tallyVouchers/" + d.id);
  return out;
}

/* ---------------- encryption (turned on once, from Settings) ---------------- */
// every collection that holds records; History and saved messages are add-only,
// so entries written before encryption stay as they were
export const ENCRYPTED_COLLECTIONS = ["customers", "products", "transports", "orders", "services", "receipts", "settings", "balances", "tallyVouchers", "tallyStock", "tallyBills"];

// saves the new passphrase's check value, then rewrites every record encrypted
// (same content, same created/updated stamps). One History entry for the lot.
export async function turnOnEncryption(pass: string, progress: (done: number, total: number) => void) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const cfg = await newConfig(pass, user.email || "");
  const ref = doc(db, "settings", "crypto");
  await runTransaction(db, async (tx) => {
    const cur = await tx.get(ref);
    if (cur.exists() && (cur.data() as CryptoConfig).on) throw new Error("Encryption was already turned on from another device. Enter that passphrase instead.");
    tx.set(ref, cfg);
  });
  await setCryptoConfig(cfg);
  const counts: Record<string, number> = {};
  const todo: { coll: string; id: string; data: DocumentData }[] = [];
  for (const coll of ENCRYPTED_COLLECTIONS) {
    const snap = await getDocs(collection(db, coll));
    counts[coll] = 0;
    snap.docs.forEach((d) => {
      if (coll === "settings" && d.id === "crypto") return;
      if (typeof d.data().enc === "string") return;
      todo.push({ coll, id: d.id, data: d.data() });
      counts[coll]++;
    });
  }
  // batches kept well under Firestore's limits (500 writes / 10 MB)
  let batch = writeBatch(db), n = 0, size = 0, done = 0;
  progress(0, todo.length);
  for (const t of todo) {
    const sealed = await sealDoc(t.coll, t.data);
    const len = String(sealed.enc || "").length;
    if (n && (n >= 200 || size + len > 4_000_000)) { await batch.commit(); batch = writeBatch(db); n = 0; size = 0; }
    batch.set(doc(db, t.coll, t.id), sealed);   // whole record replaced: no readable copy left
    n++; size += len; done++;
    if (done % 25 === 0) progress(done, todo.length);
  }
  if (n) await batch.commit();
  progress(todo.length, todo.length);
  await logEvent("encryption-turned-on", { name: "Encryption", records: todo.length, ...counts });
  return todo.length;
}
