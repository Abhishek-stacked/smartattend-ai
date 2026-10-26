import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ScanFace, ShieldCheck, Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/api";
import { Alert, Button, Field, PasswordField } from "../components/ui";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? "/dashboard";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(err.message);
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Unable to sign in right now. Please try again.");
      }
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-slate-950 p-10 text-slate-300 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-28 -top-16 size-[26rem] rounded-full bg-brand-500/30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-28 -right-10 size-96 rounded-full bg-accent-400/25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(148,163,184,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.35) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(70% 60% at 50% 40%, black, transparent)",
          }}
        />

        {/* Floating scan motif: concentric rings tilted in perspective. */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-[-6rem] top-1/2 hidden h-[26rem] w-[26rem] -translate-y-1/2 place-items-center xl:grid"
        >
          <div className="absolute size-full rounded-full border border-white/10" />
          <div className="absolute size-[78%] rounded-full border border-brand-300/25" />
          <div className="absolute size-[56%] rounded-full border border-accent-300/30" />
          <div className="absolute size-[34%] rounded-full bg-gradient-to-br from-brand-400/40 to-accent-400/30 shadow-[0_0_60px_-10px_rgba(108,99,244,0.9)]" />
          <div className="absolute h-px w-full bg-gradient-to-r from-transparent via-accent-300/70 to-transparent" />
          <div className="absolute size-3 rounded-full bg-accent-300 shadow-[0_0_18px_4px_rgba(34,211,238,0.85)]" />
        </div>

        <div className="relative flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand-300 via-brand-500 to-accent-500 text-white shadow-[0_12px_28px_-10px_rgba(108,99,244,1)] ring-1 ring-white/25">
            <ScanFace aria-hidden className="size-6" />
          </span>
          <div>
            <p className="text-base font-semibold text-white">SmartAttend AI</p>
            <p className="text-xs text-slate-400">Facial recognition attendance</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight text-white">
            Attendance that verifies who is actually in the room.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            One platform for enrollment with consent, real-time recognition, exception review, and reporting —
            with a complete audit trail for every change.
          </p>
          <ul className="mt-8 space-y-4 text-sm">
            <li className="glass flex gap-3 rounded-2xl p-4 shadow-[0_20px_40px_-24px_rgba(0,0,0,0.9)]">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent-400/30 to-brand-500/30 text-accent-300 ring-1 ring-white/15">
                <ShieldCheck aria-hidden className="size-5" />
              </span>
              <span>
                <span className="font-medium text-white">Liveness-aware verification.</span> Spoof checks are
                evaluated separately from identity matching and can be flagged for review.
              </span>
            </li>
            <li className="glass flex gap-3 rounded-2xl p-4 shadow-[0_20px_40px_-24px_rgba(0,0,0,0.9)]">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-400/30 to-fuchsia-500/30 text-brand-200 ring-1 ring-white/15">
                <Sparkles aria-hidden className="size-5" />
              </span>
              <span>
                <span className="font-medium text-white">Uncertain matches are never guessed.</span> Low-confidence
                and multiple-face events are routed to a human reviewer.
              </span>
            </li>
          </ul>
        </div>

        <p className="relative text-xs text-slate-500">
          Authorized institutional use only. Biometric data is processed under the institution consent policy.
        </p>
      </section>

      <section className="relative flex items-center justify-center overflow-hidden bg-slate-50 px-4 py-12">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-accent-300/25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-20 size-96 rounded-full bg-brand-400/25 blur-3xl"
        />
        <div className="relative w-full max-w-sm rounded-3xl border border-white/70 bg-white/80 p-7 shadow-float backdrop-blur-xl">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-10 -top-px h-px bg-gradient-to-r from-transparent via-brand-400 to-transparent"
          />
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand-400 via-brand-500 to-accent-500 text-white shadow-control">
              <ScanFace aria-hidden className="size-6" />
            </span>
            <div>
              <p className="text-base font-semibold text-slate-900">SmartAttend AI</p>
              <p className="text-xs text-slate-500">Facial recognition attendance</p>
            </div>
          </div>

          <h2 className="bg-gradient-to-br from-slate-900 to-brand-700 bg-clip-text text-2xl font-semibold tracking-tight text-transparent">
            Sign in
          </h2>
          <p className="mt-1 text-sm text-slate-500">Use your institutional email address.</p>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            {error && <Alert tone="error">{error}</Alert>}

            <Field
              label="Email address"
              type="email"
              name="email"
              autoComplete="username"
              placeholder="you@institution.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <PasswordField
              label="Password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <Button type="submit" className="w-full" loading={submitting} disabled={!email || !password}>
              {submitting ? "Signing in" : "Sign in"}
            </Button>
          </form>

          <p className="mt-6 text-xs leading-relaxed text-slate-500">
            Forgot your password? Contact your administrator — they can set a new password or issue a single-use reset link.{" "}
            <Link to="/reset-password" className="font-medium text-brand-600 hover:text-brand-700">
              Have a reset link?
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
