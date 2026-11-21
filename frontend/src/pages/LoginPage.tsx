import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, ScanFace, ShieldCheck, Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Alert, Button, Field, PasswordField } from "../components/ui";

const FEATURES = [
  {
    icon: ShieldCheck,
    title: "Liveness evaluated separately",
    body: "Spoof checks are scored on their own axis and flagged for review instead of silently passing.",
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
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Unable to sign in right now. Please try again.",
      );
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Product context. Decorative only, so it never displaces the form. */}
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-panel px-12 py-10 lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-brand-600 text-white">
            <ScanFace aria-hidden className="size-5" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-fg">SmartAttend AI</span>
        </div>

        <div className="max-w-lg">
          <h2 className="text-[2rem] font-semibold leading-[1.15] tracking-tight text-chalk">
            Attendance that verifies who is actually in the room.
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-fg-muted">
            Enrolment with recorded consent, recognition in a bounded window, exception review and an audit trail
            for every change - one system, on one origin.
          </p>

          <ul className="mt-10 space-y-6">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-raised text-brand-300">
                  <Icon aria-hidden className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">{title}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="max-w-md text-xs leading-relaxed text-fg-faint">
          Authorised institutional use only. Biometric data is processed under the consent policy recorded at
          enrolment.
        </p>
      </section>

      {/* The form is the primary surface, so it stays centred and unadorned. */}
      <section className="flex items-center justify-center bg-ink px-4 py-12">
        <div className="w-full max-w-[22rem]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-9 place-items-center rounded-lg bg-brand-600 text-white">
              <ScanFace aria-hidden className="size-5" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-fg">SmartAttend AI</span>
          </div>

          <h1 className="text-xl font-semibold tracking-tight text-fg">Sign in</h1>
          <p className="mt-1.5 text-sm text-fg-muted">Use your institutional email address.</p>

          <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
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
              {!submitting && <ArrowRight aria-hidden className="size-4" />}
            </Button>
          </form>

          <div className="mt-7 border-t border-line pt-5">
            <p className="text-[13px] leading-relaxed text-fg-muted">
              Forgot your password? Contact your administrator - they can set a new password or issue a single-use
              reset link.
            </p>
            <Link
              to="/reset-password"
              className="mt-2 inline-block text-[13px] font-medium text-brand-300 underline decoration-brand-500/40 underline-offset-2 hover:text-brand-200 hover:decoration-brand-300"
            >
              Have a reset link?
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
