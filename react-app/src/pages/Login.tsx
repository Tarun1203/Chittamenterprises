import { useState } from "react";
import { motion } from "motion/react";
import { Spotlight } from "@/components/ui/spotlight-new";
import { Button, Field, Icon3D } from "@/components/kit";
import { useStore } from "@/lib/store";

export function Login() {
  const { signIn } = useStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      const code = (err as { code?: string }).code || "";
      setError(/invalid|wrong|not-found|credential/i.test(code) ? "Wrong email or password." : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_1px_1px,rgba(36,99,235,0.12)_1px,transparent_0)] [background-size:20px_20px] px-5 py-10">
      <Spotlight />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
        className="relative z-10 w-full max-w-sm rounded-3xl border border-white/60 bg-white/85 p-7 shadow-[0_30px_60px_-20px_rgba(36,99,235,0.35)] backdrop-blur-xl"
      >
        <div className="mb-6 flex items-center gap-3">
          <Icon3D name="star" className="h-14 w-14 animate-float drop-shadow-xl" />
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">Chittam Enterprises</h1>
            <p className="text-sm text-neutral-500">Sign in to continue</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <input className="field-input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <input className="field-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="mt-5 text-center text-xs text-neutral-400">Use the same login as the Chittam app.</p>
      </motion.div>
    </div>
  );
}
