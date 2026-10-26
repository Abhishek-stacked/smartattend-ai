import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ScanFace } from "lucide-react";
import { ApiError, api } from "../lib/api";
import { Alert, Button, PasswordField } from "../components/ui";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await api("/auth/reset-password", { method: "POST", body: { token, new_password: password } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to reset the password. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-brand-600 text-white">
            <ScanFace aria-hidden className="size-6" />
          </span>
          <div>
            <p className="text-base font-semibold text-slate-900">SmartAttend AI</p>
            <p className="text-xs text-slate-500">Reset your password</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {!token ? (
            <Alert tone="error" title="This link is incomplete">
              Open the full reset link your administrator shared with you.
            </Alert>
          ) : done ? (
            <div className="space-y-4">
              <Alert tone="success" title="Password updated">
                You can now sign in with your new password. Other sessions were signed out.
              </Alert>
              <Link to="/login">
                <Button className="w-full">Go to sign in</Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <p className="text-sm text-slate-500">
                Reset links are single-use and expire 24 hours after they are issued.
              </p>
              {error && <Alert tone="error">{error}</Alert>}
              <PasswordField
                label="New password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                hint="At least 10 characters, including a letter and a number."
                required
              />
              <PasswordField
                label="Confirm new password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              <Button type="submit" className="w-full" loading={submitting} disabled={!password || !confirm}>
                Set new password
              </Button>
              <p className="text-center text-xs text-slate-500">
                <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
