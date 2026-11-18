// Signed-in user plus the live master data (customers, products, transports,
// settings), shared by every page.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { auth } from "./firebase";
import { listenCollection, listenDoc, defaultSettings, type Customer, type Product, type Transport, type Settings } from "./data";

interface Store {
  user: User | null;
  authReady: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  customers: Customer[];
  products: Product[];
  transports: Transport[];
  settings: Settings;
  settingsLoaded: boolean;
  synced: boolean; // false while showing data saved on this device (offline)
  error: string;
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
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // local development only (removed from the published build): ?demo shows
    // sample data without signing in, so screens can be checked; nothing saves
    if (import.meta.env.DEV && new URLSearchParams(location.search).has("demo")) {
      import("./demo").then((d) => {
        setUser(d.demoUser); setCustomers(d.demoCustomers); setProducts(d.demoProducts); setTransports(d.demoTransports);
        setSettingsLoaded(true); setSynced(true); setAuthReady(true);
      });
      return;
    }
    return onAuthStateChanged(auth, (u) => { setUser(u); setAuthReady(true); });
  }, []);

  useEffect(() => {
    if (!user || (import.meta.env.DEV && new URLSearchParams(location.search).has("demo"))) return;
    const fail = (e: Error) => setError(e.message);
    const unsubs = [
      listenCollection<Customer>("customers", (items, fromCache) => { setCustomers(items); setSynced(!fromCache); }, fail),
      listenCollection<Product>("products", (items) => setProducts(items), fail),
      listenCollection<Transport>("transports", (items) => setTransports(items), fail),
      listenDoc<Settings>("settings", "main", (s) => { setSettings({ ...defaultSettings, ...(s || {}) }); setSettingsLoaded(true); }, fail),
    ];
    return () => unsubs.forEach((u) => u());
  }, [user]);

  const value: Store = {
    user,
    authReady,
    signIn: async (email, password) => { await signInWithEmailAndPassword(auth, email, password); },
    signOutUser: () => signOut(auth),
    customers,
    products,
    transports,
    settings,
    settingsLoaded,
    synced,
    error,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}
