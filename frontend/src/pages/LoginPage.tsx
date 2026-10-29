import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, ScanFace, ShieldCheck, Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/api";
import { Alert, Button, Field, PasswordField } from "../components/ui";

const TICKER = ["FACE MATCH", "LIVENESS CHECK", "CONSENT FIRST", "AUDIT TRAIL", "REVIEW QUEUE", "ROSTER SYNC"];

const SPECS = [
  {
    icon: ShieldCheck,
    title: "Liveness evaluated separately",
    body: "Spoof checks are scored on their own axis and can be flagged for review instead of silently passing.",
  },
  {
    icon: Sparkles,
    title: "Uncertain matches are never guessed",
    body: "Low-confidence and multiple-face events become a review item for a human, never an automatic mark.",
  },
  {
    icon: ScanFace,
    title: "Consent recorded before a template exists",
    body: "Enrolment writes a consent event first; templates are encrypted at rest and purged on schedule.",
  },
];

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
    <div className="grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
      {/* ---------------------------------------------------------------- */}
      {/* LEFT: the specification sheet. Decorative, hidden below lg.       */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative hidden flex-col justify-between overflow-hidden border-r-2 border-slate-200 bg-[#050506] px-10 py-9 lg:flex">
        <div aria-hidden className="floor" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px)",
            backgroundSize: "52px 52px",
            maskImage: "radial-gradient(85% 70% at 30% 20%, #000 0%, transparent 80%)",
            WebkitMaskImage: "radial-gradient(85% 70% at 30% 20%, #000 0%, transparent 80%)",
          }}
        />
        <div aria-hidden className="scan pointer-events-none absolute inset-0 overflow-hidden" />

        <div className="relative flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center border-2 border-brand-500 bg-brand-500 text-[#08080a] shadow-[4px_4px_0_0_#000]">
              <ScanFace aria-hidden className="size-6" />
            </span>
            <div>
              <p className="font-mono text-[13px] font-bold uppercase tracking-[0.12em] text-chalk">
                SmartAttend AI
              </p>
              <p className="label-mono">Facial recognition attendance</p>
            </div>
          </div>
          <p className="flex items-center gap-2 border-2 border-slate-300 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-slate-500">
            <span aria-hidden className="live-dot block size-1.5 bg-brand-500" />
            Systems nominal
          </p>
        </div>

        <div className="relative mt-10 max-w-xl">
          <p className="label-mono anim-rise" style={{ "--d": "60ms" } as CSSProperties}>
            01 / Access control
          </p>
          <h1
            className="anim-rise mt-4 text-[2.6rem] font-semibold uppercase leading-[0.98] tracking-tight text-chalk xl:text-5xl"
            style={{ "--d": "120ms" } as CSSProperties}
          >
            Attendance that{" "}
            <span className="relative inline-block bg-brand-500 px-2 text-[#08080a]">verifies</span>{" "}
            who is actually in the room.
          </h1>
          <p
            className="anim-rise mt-5 max-w-md text-sm leading-relaxed text-slate-400"
            style={{ "--d": "180ms" } as CSSProperties}
          >
            Enrolment with recorded consent, recognition in a bounded window, exception review, and an audit
            trail for every change — one system, on one origin.
          </p>

          <div className="mt-8 max-w-[30rem]">
            {SPECS.map(({ icon: Icon, title, body }, i) => (
              <div
                key={title}
                className="spec-row anim-rise"
                style={{ "--d": `${240 + i * 80}ms` } as CSSProperties}
              >
                <span className="font-mono text-[11px] font-bold tracking-[0.1em] text-brand-500">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>
                  <span className="flex items-center gap-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-900">
                    <Icon aria-hidden className="size-3.5 text-slate-500" />
                    {title}
                  </span>
                  <span className="mt-1 block text-[13px] leading-relaxed text-slate-400">{body}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* The 3D object: a wireframe cube whose faces are the system's verbs. */}
        <div
          aria-hidden
          className="scene pointer-events-none absolute right-14 top-[42%] hidden 2xl:block"
        >
          <div className="cube">
            <span className="cube-face">FACE</span>
            <span className="cube-face">MATCH</span>
            <span className="cube-face">LIVE</span>
            <span className="cube-face">AUDIT</span>
            <span className="cube-face">CONSENT</span>
            <span className="cube-face">REVIEW</span>
          </div>
        </div>

        <div className="relative -mx-10 mt-10">
          <div className="ticker bg-[#0a0a0c]">
            <div className="ticker-track">
              {[0, 1].map((copy) => (
                <span
                  key={copy}
                  className="flex shrink-0 items-center gap-7 py-2 pl-7 font-mono text-[9.5px] uppercase tracking-[0.28em] text-slate-500"
                >
                  {TICKER.map((word) => (
                    <span key={word} className="flex items-center gap-7">
                      {word}
                      <span aria-hidden className="block size-1 bg-brand-500" />
                    </span>
                  ))}
                </span>
              ))}
            </div>
          </div>
          <p className="mt-4 px-10 font-mono text-[9px] uppercase leading-relaxed tracking-[0.18em] text-slate-500">
            Authorized institutional use only · biometric data processed under the consent policy
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* RIGHT: the form.                                                  */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative flex items-center justify-center overflow-hidden bg-ink px-4 py-12">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 size-[24rem] rounded-full bg-brand-500/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-24 size-[22rem] rounded-full bg-accent-400/10 blur-3xl"
        />

        <div className="relative w-full max-w-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="label-mono">02 / Authenticate</p>
            <p className="label-mono">TLS 1.3</p>
          </div>

          <div className="scene relative">
            {/* Two plates behind the card: the depth is real furniture, not a shadow. */}
            <div
              aria-hidden
              className="absolute inset-0 translate-x-2.5 translate-y-2.5 border-2 border-slate-300 bg-slate-100"
            />
            <div
              aria-hidden
              className="absolute inset-0 translate-x-5 translate-y-5 border-2 border-brand-500/60"
            />

            <div className="slab-3d anim-pop relative border-2 border-slate-300 bg-panel px-7 py-8">
            <div className="mb-7 flex items-center gap-3 lg:hidden">
              <span className="grid size-10 place-items-center border-2 border-brand-500 bg-brand-500 text-[#08080a] shadow-[3px_3px_0_0_#000]">
                <ScanFace aria-hidden className="size-6" />
              </span>
              <div>
                <p className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-chalk">SmartAttend AI</p>
                <p className="label-mono">Facial recognition attendance</p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <h2 className="text-2xl font-semibold uppercase leading-none tracking-tight text-chalk">Sign in</h2>
              <span className="border-2 border-slate-300 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-slate-500">
                Sec
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500">Use your institutional email address.</p>
            <div aria-hidden className="mt-5 h-0.5 w-14 bg-brand-500" />

            <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
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

              <Button
                type="submit"
                className="group w-full"
                loading={submitting}
                disabled={!email || !password}
              >
                {submitting ? "Signing in" : "Sign in"}
                {!submitting && (
                  <ArrowRight
                    aria-hidden
                    className="size-4 transition-transform duration-200 group-hover:translate-x-1"
                  />
                )}
              </Button>
            </form>

            <div className="mt-6 border-t-2 border-slate-200 pt-4">
              <p className="text-xs leading-relaxed text-slate-500">
                Forgot your password? Contact your administrator — they can set a new password or issue a
                single-use reset link.
              </p>
              <Link
                to="/reset-password"
                className="mt-2 inline-block whitespace-nowrap font-mono text-[10.5px] uppercase tracking-[0.1em] text-brand-500 underline decoration-2 underline-offset-2 hover:text-brand-600"
              >
                Have a reset link?
              </Link>
            </div>
            </div>
          </div>

          <p className="mt-10 flex items-center justify-between gap-3 font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
            <span>Session · 480 min</span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="live-dot block size-1 bg-brand-500" />
              Ready
            </span>
          </p>
        </div>
      </section>
    </div>
  );
}
