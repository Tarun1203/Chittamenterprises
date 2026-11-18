import { Route, Routes } from "react-router";
import { StoreProvider, useStore } from "@/lib/store";
import { ToastProvider, Icon3D } from "@/components/kit";
import { AppShell, NAV } from "@/components/AppShell";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Customers } from "@/pages/Customers";
import { Products } from "@/pages/Products";
import { Transports } from "@/pages/Transports";
import { Soon } from "@/pages/Soon";

function Gate() {
  const { user, authReady } = useStore();
  if (!authReady) {
    return (
      <div className="flex h-full items-center justify-center">
        <Icon3D name="star" className="h-16 w-16 animate-float drop-shadow-xl" />
      </div>
    );
  }
  if (!user) return <Login />;
  const soon = NAV.flatMap((g) => g.items).filter((i) => i.soon);
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/products" element={<Products />} />
        <Route path="/transports" element={<Transports />} />
        {soon.map((s) => <Route key={s.to} path={s.to} element={<Soon path={s.to} />} />)}
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </StoreProvider>
  );
}
