import { Route, Routes } from "react-router";
import { StoreProvider, useStore } from "@/lib/store";
import { ToastProvider, Icon3D } from "@/components/kit";
import { AppShell } from "@/components/AppShell";
import { UpdateBar } from "@/lib/pwa";
import { Login, Unlock } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Customers } from "@/pages/Customers";
import { Products } from "@/pages/Products";
import { Transports } from "@/pages/Transports";
import { PaymentUpdated } from "@/pages/PaymentUpdated";
import { BalanceConfirmation, Dispatch, PaymentReminder, ServiceMaterial, StockReturn, StockUpdate } from "@/pages/MessagePages";
import { Orders } from "@/pages/Orders";
import { ServiceJobs } from "@/pages/ServiceJobs";
import { History } from "@/pages/History";
import { Settings } from "@/pages/Settings";
import { Catalog } from "@/pages/Catalog";
import { TallyMatch } from "@/pages/TallyMatch";
import { WhatsNew } from "@/pages/WhatsNew";
import { Ledger } from "@/pages/Ledger";

function Gate() {
  const { user, authReady, cryptoReady, locked } = useStore();
  if (!authReady || (user && !cryptoReady)) {
    return (
      <div className="flex h-full items-center justify-center">
        <Icon3D name="star" className="h-16 w-16 animate-float drop-shadow-xl" />
      </div>
    );
  }
  if (!user) return <Login />;
  if (locked) return <Unlock />;
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/products" element={<Products />} />
        <Route path="/transports" element={<Transports />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/service-jobs" element={<ServiceJobs />} />
        <Route path="/payment-updated" element={<PaymentUpdated />} />
        <Route path="/payment-reminder" element={<PaymentReminder />} />
        <Route path="/balance-confirmation" element={<BalanceConfirmation />} />
        <Route path="/dispatch" element={<Dispatch />} />
        <Route path="/stock-update" element={<StockUpdate />} />
        <Route path="/stock-return" element={<StockReturn />} />
        <Route path="/service-material" element={<ServiceMaterial />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/tally" element={<TallyMatch />} />
        <Route path="/history" element={<History />} />
        <Route path="/whats-new" element={<WhatsNew />} />
        <Route path="/ledger" element={<Ledger />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <ToastProvider>
        <UpdateBar />
        <Gate />
      </ToastProvider>
    </StoreProvider>
  );
}
