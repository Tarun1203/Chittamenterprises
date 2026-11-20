// Signed-in user plus the live master data (customers, products, transports,
// settings), shared by every page.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { auth } from "./firebase";
import { isLocked, onCryptoChange, type CryptoConfig } from "./crypto";
import { listenCollection, listenCrypto, listenDoc, defaultSettings, type Customer, type Product, type Transport, type Settings, type Order, type ServiceJob, type Receipt, type BalanceSet } from "./data";

interface Store {
  user: User | null;
  authReady: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  customers: Customer[];      // active customers (not removed or merged)
  allCustomers: Customer[];   // including removed and merged
  products: Product[];
  transports: Transport[];
  settings: Settings;
  settingsLoaded: boolean;
  orders: Order[];
  services: ServiceJob[];
  receipts: Receipt[];
  balances: Record<string, BalanceSet>; // "business" / "cash" from Tally
  synced: boolean; // false while showing data saved on this device (offline)
  error: string;
  crypto: CryptoConfig | null; // set when the data is encrypted
  cryptoReady: boolean;        // settings/crypto has been read
  locked: boolean;             // encrypted, and this device doesn't have the passphrase yet
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [transports, setTransports] = useState<Transport[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [services, setServices] = useState<ServiceJob[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [balances, setBalances] = useState<Record<string, BalanceSet>>({});
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState("");
  const [crypto, setCrypto] = useState<CryptoConfig | null>(null);
  const [cryptoReady, setCryptoReady] = useState(false);
  const [locked, setLocked] = useState(false);
  useEffect(() => onCryptoChange(() => setLocked(isLocked())), []);

  useEffect(() => {
    // local development only (removed from the published build): ?demo shows
    // sample data without signing in, so screens can be checked; nothing saves
    if (import.meta.env.DEV && new URLSearchParams(location.search).has("demo")) {
      import("./demo").then((d) => {
        setUser(d.demoUser); setCustomers(d.demoCustomers); setProducts(d.demoProducts); setTransports(d.demoTransports);
        setOrders(d.demoOrders); setServices(d.demoServices); setReceipts(d.demoReceipts); setBalances(d.demoBalances);
        setSettingsLoaded(true); setSynced(true); setAuthReady(true); setCryptoReady(true);
      });
      return;
    }
    return onAuthStateChanged(auth, (u) => { setUser(u); setAuthReady(true); });
  }, []);

  // whether the data is encrypted: read before anything else
  useEffect(() => {
    if (!user || (import.meta.env.DEV && new URLSearchParams(location.search).has("demo"))) return;
    return listenCrypto((c) => { setCrypto(c); setLocked(isLocked()); setCryptoReady(true); },
      (e) => { setError(e.message); setCryptoReady(true); });
  }, [user]);

  useEffect(() => {
    if (!user || !cryptoReady || locked || (import.meta.env.DEV && new URLSearchParams(location.search).has("demo"))) return;
    setError("");
    const fail = (e: Error) => setError(e.message);
    const unsubs = [
      listenCollection<Customer>("customers", (items, fromCache) => { setCustomers(items); setSynced(!fromCache); }, fail),
      listenCollection<Product>("products", (items) => setProducts(items), fail),
      listenCollection<Transport>("transports", (items) => setTransports(items), fail),
      listenCollection<Order>("orders", (items) => setOrders(items), fail),
      listenCollection<ServiceJob>("services", (items) => setServices(items), fail),
      listenCollection<Receipt>("receipts", (items) => setReceipts(items), fail),
      listenCollection<BalanceSet & { id: string }>("balances", (items) => {
        const map: Record<string, BalanceSet> = {};
        items.forEach((b) => { map[b.id] = b; });
        setBalances(map);
      }, fail),
      listenDoc<Settings>("settings", "main", (s) => { setSettings({ ...defaultSettings, ...(s || {}) }); setSettingsLoaded(true); }, fail),
    ];
    return () => unsubs.forEach((u) => u());
  }, [user, cryptoReady, locked]);

  const active = customers.filter((c) => !c.removed && !c.mergedInto);
  const value: Store = {
    user,
    authReady,
    signIn: async (email, password) => { await signInWithEmailAndPassword(auth, email, password); },
    signOutUser: () => signOut(auth),
    customers: active,
    allCustomers: customers,
    products,
    transports,
    settings,
    settingsLoaded,
    orders,
    services,
    receipts,
    balances,
    synced,
    error,
    crypto,
    cryptoReady,
    locked,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}
