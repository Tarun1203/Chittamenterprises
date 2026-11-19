// The app's data: the same Firestore collections and fields as the current
// app, so both can be used side by side. Rules that never change:
//   - nothing is ever deleted (there is no delete function here, and the
//     database rules refuse deletes);
//   - every add / edit also writes an entry to the activity log (History).
import { collection, doc, onSnapshot, serverTimestamp, writeBatch, addDoc, type DocumentData } from "firebase/firestore";
import { db, auth } from "./firebase";

export interface Customer { id: string; name: string; mobile?: string }
export interface Product { id: string; name: string; category?: string; price?: number }
export interface Transport { id: string; name: string; contactPerson?: string; phone?: string; branch?: string }
export interface Settings {
  businessName: string;
  address: string;
  upiList: { upiId: string; payeeName?: string; isDefault?: boolean }[];
  bankList: { label?: string; accountNo: string; ifsc?: string; bankBranch?: string; isDefault?: boolean }[];
  paymentModes: string[];
}

export interface OrderItem { name: string; qty: number; rate: number; amount: number }
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
}
export interface BalanceSet {
  company: string; label?: string; file?: string; importedAt?: string; importedBy?: string;
  balances: Record<string, number>; names?: Record<string, string>;
}

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

export function listenCollection<T>(name: string, cb: (items: T[], fromCache: boolean) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    collection(db, name),
    { includeMetadataChanges: true },
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...strip(d.data()) }) as T), snap.metadata.fromCache),
    onError,
  );
}

export function listenDoc<T>(path: string, id: string, cb: (data: T | null) => void, onError?: (e: Error) => void) {
  return onSnapshot(doc(db, path, id), (d) => cb(d.exists() ? (strip(d.data()) as T) : null), onError);
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
      batch.set(doc(db, w.coll, w.id), record, { merge: w.coll !== "settings" });
      batch.set(doc(collection(db, "activity")), {
        collection: w.coll,
        docId: w.id,
        action: isNew ? "create" : "update",
        name: displayName(w.coll, data),
        before: w.before ? stable(strip(w.before)) : null,
        after: data,
        at: serverTimestamp(),
        by,
      });
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
  await addDoc(collection(db, "activity"), {
    collection: "app",
    action,
    name: (d.name as string) || (d.customerName as string) || "",
    details: d,
    at: serverTimestamp(),
    by: user.email || "",
  });
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
  batch.set(msgRef, { type, text, inputs: stable(inputs), ...who, at: serverTimestamp(), by: user.email || "" });
  batch.set(doc(collection(db, "activity")), {
    collection: "app", action: "message-generated", name: who.customerName,
    details: { type, messageId: msgRef.id, ...who }, at: serverTimestamp(), by: user.email || "",
  });
  await batch.commit();
}
