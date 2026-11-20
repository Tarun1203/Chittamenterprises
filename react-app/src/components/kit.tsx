// Small shared pieces: 3D icons, page header, buttons, fields, toasts, dialog.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { ModalBody, ModalContent, ModalProvider, useModal } from "@/components/ui/animated-modal";

/* ---------------- 3D icons (3dicons.co, CC0) ---------------- */
export function Icon3D({ name, className }: { name: string; className?: string }) {
  return <img src={import.meta.env.BASE_URL + "icons3d/" + name + ".png"} alt="" draggable={false} className={cn("pointer-events-none select-none object-contain", className)} />;
}

/* ---------------- page header ---------------- */
export function PageHeader({ icon, eyebrow, title, subtitle, actions }: { icon?: string; eyebrow?: string; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-4">
        {icon && (
          <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-violet-50 p-2 ring-1 ring-brand-100 sm:flex">
            <Icon3D name={icon} className="h-full w-full drop-shadow-md" />
          </div>
        )}
        <div>
          {eyebrow && <p className="text-[11px] font-bold tracking-[0.16em] text-brand-600 uppercase">{eyebrow}</p>}
          <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900 md:text-[28px]">{title}</h1>
          {subtitle && <p className="mt-1 max-w-2xl text-sm text-neutral-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------------- buttons ---------------- */
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "whatsapp"; size?: "sm" | "md" };
export function Button({ variant = "primary", size = "md", className, children, ...props }: BtnProps) {
  const base = "group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";
  const sizes = { sm: "h-9 px-3.5 text-sm", md: "h-11 px-5 text-[15px]" };
  const variants = {
    primary: "bg-gradient-to-br from-brand-600 to-indigo-600 text-white shadow-[0_8px_20px_-8px_rgba(36,99,235,0.7)] hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-8px_rgba(36,99,235,0.75)]",
    whatsapp: "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-[0_8px_20px_-8px_rgba(16,150,120,0.7)] hover:-translate-y-0.5",
    secondary: "border border-neutral-200 bg-white text-neutral-800 shadow-sm hover:border-brand-200 hover:text-brand-700",
    ghost: "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
  };
  return (
    <button className={cn(base, sizes[size], variants[variant], className)} {...props}>
      {(variant === "primary" || variant === "whatsapp") && (
        <span className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 -skew-x-12 bg-white/25 transition-all duration-700 group-hover:left-[120%]" />
      )}
      <span className="relative inline-flex items-center gap-2">{children}</span>
    </button>
  );
}

/* ---------------- form field ---------------- */
export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-xs font-semibold tracking-wide text-neutral-500 uppercase">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-400">{hint}</span>}
    </label>
  );
}

/* ---------------- card ---------------- */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,15,20,0.04),0_4px_14px_-6px_rgba(15,15,20,0.06)]", className)}>{children}</div>;
}

export function EmptyState({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-neutral-200 bg-white/60 px-6 py-14 text-center">
      <Icon3D name={icon} className="h-20 w-20 animate-float drop-shadow-xl" />
      <h3 className="mt-4 text-lg font-bold text-neutral-800">{title}</h3>
      {text && <p className="mt-1 max-w-sm text-sm text-neutral-500">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ---------------- toasts ---------------- */
const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(""), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <AnimatePresence>
        {msg && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-24 left-1/2 z-[200] max-w-[90vw] -translate-x-1/2 rounded-2xl bg-neutral-900 px-5 py-3 text-center text-sm font-medium text-white shadow-2xl md:bottom-8"
          >
            {msg}
          </motion.div>
        )}
      </AnimatePresence>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------------- dialog (Aceternity animated modal, opened from code) ---------------- */
function SyncOpen({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { open: ctxOpen, setOpen } = useModal();
  const wasOpen = useRef(false);
  useEffect(() => { setOpen(open); }, [open, setOpen]);
  useEffect(() => {
    if (wasOpen.current && !ctxOpen) onClose();
    wasOpen.current = ctxOpen;
  }, [ctxOpen, onClose]);
  return null;
}

export function Dialog({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  // rendered at the top of the page: the page's animated wrapper would
  // otherwise trap the full-screen overlay inside it
  return createPortal(
    <ModalProvider>
      <SyncOpen open={open} onClose={onClose} />
      <ModalBody className="mx-3 max-h-[92%] min-h-0 w-full max-w-lg rounded-3xl md:max-w-lg">
        <ModalContent className="overflow-y-auto p-6 md:p-7">
          <h2 className="mb-5 pr-8 text-xl font-extrabold tracking-tight">{title}</h2>
          <div className="space-y-4">{children}</div>
        </ModalContent>
        {/* buttons keep their size and wrap onto a second line on narrow phones */}
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-4 py-4 sm:px-6 [&>*]:shrink-0 [&>*]:whitespace-nowrap">{footer}</div>}
      </ModalBody>
    </ModalProvider>,
    document.body,
  );
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100" aria-label="Close">
      <IconX size={18} />
    </button>
  );
}
