// Encryption of the data in Firebase with the company passphrase.
//
// Once it is turned on (Settings → Encryption), every record is stored as one
// scrambled field "enc", so neither Google nor anyone reading the database
// directly can see names, amounts or messages. Only the bookkeeping fields
// stay readable (when it was saved and by whom, and for History which record
// it is about), because the database rules and the History order need them.
//
// The same format is used by the old app (js/00-crypto.js) and the Windows app
// (ChittamEnterprises.cs, class Crypto), so all three read each other's data:
//   key   = PBKDF2-SHA256(passphrase, salt, iter) → 64 bytes: AES key | HMAC key
//   enc   = base64( iv(16) | AES-256-CBC(deflate-raw(JSON)) | HMAC-SHA256(iv|ct) )
// The passphrase never leaves the device. Its key is kept on each device
// (IndexedDB, shared by the old and the new app) after it is typed once.
// If the passphrase is forgotten everywhere, the data cannot be recovered.

export interface CryptoConfig { on: boolean; salt: string; iter: number; check: string; setAt?: string; setBy?: string }

const DB_NAME = "chittam-crypto", STORE = "keys";
export const ITERATIONS = 310000;
const te = new TextEncoder(), td = new TextDecoder();

interface Keys { aes: CryptoKey; mac: CryptoKey; salt: string }
let keys: Keys | null = null;
let config: CryptoConfig | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());
export const onCryptoChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

export function b64(u: Uint8Array) {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s: string) {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

async function derive(pass: string, salt: string, iter: number): Promise<Keys> {
  const base = await crypto.subtle.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(salt) as BufferSource, iterations: iter }, base, 512));
  const aes = await crypto.subtle.importKey("raw", bits.slice(0, 32), { name: "AES-CBC" }, false, ["encrypt", "decrypt"]);
  const mac = await crypto.subtle.importKey("raw", bits.slice(32, 64), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return { aes, mac, salt };
}

async function sealWith(k: Keys, value: unknown) {
  const z = await pipe(te.encode(JSON.stringify(value)), new CompressionStream("deflate-raw"));
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, k.aes, z as BufferSource));
  const body = new Uint8Array(16 + ct.length);
  body.set(iv); body.set(ct, 16);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k.mac, body));
  const all = new Uint8Array(body.length + 32);
  all.set(body); all.set(mac, body.length);
  return b64(all);
}

async function openWith(k: Keys, s: string) {
  const all = unb64(s);
  if (all.length < 16 + 16 + 32) throw new Error("Damaged encrypted record.");
  const body = all.subarray(0, all.length - 32), mac = all.subarray(all.length - 32);
  if (!(await crypto.subtle.verify("HMAC", k.mac, mac as BufferSource, body as BufferSource))) throw new Error("This record was encrypted with a different passphrase, or was changed.");
  const z = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: body.subarray(0, 16) as BufferSource }, k.aes, body.subarray(16) as BufferSource));
  return JSON.parse(td.decode(await pipe(z, new DecompressionStream("deflate-raw"))));
}

/* ---------------- the key kept on this device ---------------- */

function idb<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = f(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => open.result.close();
    };
  });
}
async function loadKeys() {
  if (keys) return keys;
  try { keys = (await idb<Keys | undefined>("readonly", (s) => s.get("main"))) || null; } catch { keys = null; }
  return keys;
}

/* ---------------- state ---------------- */

// called with settings/crypto whenever it changes
export async function setCryptoConfig(c: CryptoConfig | null) {
  config = c && c.on ? c : null;
  await loadKeys();
  changed();
}
export const encryptionOn = () => !!config;
// true when the data is encrypted and this device doesn't have the key yet
export const isLocked = () => !!config && (!keys || keys.salt !== config.salt);

// checks the passphrase against the database's check value; keeps the key on this device
export async function unlock(pass: string) {
  if (!config) return true;
  const k = await derive(pass, config.salt, config.iter);
  try {
    const v = await openWith(k, config.check);
    if (!v || v.ok !== "chittam") return false;
  } catch { return false; }
  keys = k;
  try { await idb("readwrite", (s) => s.put(k, "main")); } catch { /* kept for this visit only */ }
  changed();
  return true;
}

// a new passphrase: the config to save in settings/crypto (this device keeps the key)
export async function newConfig(pass: string, by: string): Promise<CryptoConfig> {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const k = await derive(pass, salt, ITERATIONS);
  const check = await sealWith(k, { ok: "chittam" });
  keys = k;
  try { await idb("readwrite", (s) => s.put(k, "main")); } catch { /* kept for this visit only */ }
  return { on: true, salt, iter: ITERATIONS, check, setAt: new Date().toISOString(), setBy: by };
}

/* ---------------- records ---------------- */

// fields that stay readable in each collection (everything else is encrypted)
const META = ["createdAt", "createdBy", "updatedAt", "updatedBy", "at", "by"];
const PLAIN: Record<string, string[]> = {
  activity: [...META, "collection", "docId", "action", "source"],
  messages: [...META, "type"],
};
const plainOf = (coll: string) => PLAIN[coll] || META;

// a record ready to save: when encryption is on, all but the readable fields go into "enc"
export async function sealDoc<T extends Record<string, unknown>>(coll: string, data: T): Promise<Record<string, unknown>> {
  if (!config) return data;
  if (isLocked() || !keys) throw new Error("The data is encrypted — enter the passphrase first.");
  const keep = plainOf(coll), plain: Record<string, unknown> = {}, secret: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    (keep.includes(k) ? plain : secret)[k] = v;
  }
  return { ...plain, enc: await sealWith(keys, secret), encV: 1 };
}

// the same encrypted text always opens to the same thing: kept so each live update
// only opens the records that changed
const opened = new Map<string, { enc: string; value: Record<string, unknown> }>();

// a record as read from the database (opened if it was encrypted)
export async function openDoc<T = Record<string, unknown>>(data: Record<string, unknown> | undefined, path = ""): Promise<T> {
  if (!data || typeof data.enc !== "string") return data as T;
  const k = await loadKeys();
  if (!k) throw new Error("The data is encrypted — enter the passphrase first.");
  const hit = path ? opened.get(path) : undefined;
  let secret: Record<string, unknown>;
  if (hit && hit.enc === data.enc) secret = hit.value;
  else {
    secret = await openWith(k, data.enc);
    if (path) opened.set(path, { enc: data.enc, value: secret });
  }
  const rest: Record<string, unknown> = { ...data };
  delete rest.enc; delete rest.encV;
  return { ...rest, ...secret } as T;
}
