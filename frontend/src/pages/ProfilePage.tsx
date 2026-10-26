import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { KeyRound, Mail, RefreshCw, ScanFace, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ApiError, api } from "../lib/api";
import { formatDateTime, roleLabel } from "../lib/format";
import type { EnrollmentStatus } from "../lib/types";
import { EnrollmentDialog } from "../components/EnrollmentDialog";
import { Alert, Badge, Button, Card, PasswordField, PageHeader, Spinner } from "../components/ui";

export function ProfilePage() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [enrollment, setEnrollment] = useState<EnrollmentStatus | null>(null);
  const [enrollmentLoading, setEnrollmentLoading] = useState(false);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const studentId = user?.student_id ?? null;

  const loadEnrollment = useCallback(async () => {
    if (!studentId) return;
    setEnrollmentLoading(true);
    try {
      setEnrollment(await api<EnrollmentStatus>(`/enrollment/${studentId}`));
      setEnrollmentError(null);
    } catch (err) {
      setEnrollmentError(err instanceof ApiError ? err.message : "Unable to load your face registration status.");
    } finally {
      setEnrollmentLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    if (user?.role === "student" && studentId) void loadEnrollment();
  }, [user?.role, studentId, loadEnrollment]);

  if (!user) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (next !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api<{ message: string }>("/auth/change-password", {
        method: "POST",
        body: { current_password: current, new_password: next },
      });
      setSuccess(res.message);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to change the password. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="My account"
        description={
          user.role === "student"
            ? "Your sign-in details, face registration, and password."
            : "Your sign-in details and password."
        }
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Account details">
          <dl className="space-y-4 text-sm">
            <div className="flex items-start gap-3">
              <UserRound aria-hidden className="mt-0.5 size-4 text-slate-400" />
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Full name</dt>
                <dd className="font-medium text-slate-900">{user.full_name}</dd>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Mail aria-hidden className="mt-0.5 size-4 text-slate-400" />
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Email</dt>
                <dd className="font-medium text-slate-900">{user.email}</dd>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ShieldCheck aria-hidden className="mt-0.5 size-4 text-slate-400" />
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Role</dt>
                <dd className="mt-1">
                  <Badge tone="brand">{roleLabel(user.role)}</Badge>
                </dd>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <KeyRound aria-hidden className="mt-0.5 size-4 text-slate-400" />
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Last sign-in</dt>
                <dd className="font-medium text-slate-900">{formatDateTime(user.last_login_at)}</dd>
              </div>
            </div>
          </dl>
        </Card>

        <Card title="Change password" description="Changing your password signs out your other devices.">
          <form onSubmit={submit} className="space-y-4" noValidate>
            {error && <Alert tone="error">{error}</Alert>}
            {success && <Alert tone="success">{success}</Alert>}
            <PasswordField
              label="Current password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
            <PasswordField
              label="New password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              hint="At least 10 characters, including a letter and a number."
              required
            />
            <PasswordField
              label="Confirm new password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              error={confirm && next !== confirm ? "Passwords do not match" : null}
              required
            />
            <Button type="submit" loading={submitting} disabled={!current || !next || !confirm}>
              Update password
            </Button>
          </form>
        </Card>
      </div>

      {user.role === "student" && studentId && (
        <div className="mt-5">
          <Card
            title="Face registration"
            description="Register your face once so it can be recognised during class attendance."
          >
            {enrollmentLoading && !enrollment ? (
              <Spinner label="Loading face registration" />
            ) : enrollmentError ? (
              <div className="space-y-3">
                <Alert tone="error">{enrollmentError}</Alert>
                <Button variant="secondary" onClick={() => void loadEnrollment()} loading={enrollmentLoading}>
                  <RefreshCw aria-hidden className="size-4" /> Try again
                </Button>
              </div>
            ) : enrollment ? (
              <div className="space-y-4 text-sm">
                <dl className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Consent</dt>
                    <dd className="mt-1">
                      {enrollment.consent?.status === "granted" ? (
                        <Badge tone="success">Granted</Badge>
                      ) : enrollment.consent?.status === "withdrawn" ? (
                        <Badge tone="warning">Withdrawn</Badge>
                      ) : (
                        <Badge>Not recorded</Badge>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Templates</dt>
                    <dd className="mt-1 font-medium text-slate-900">{enrollment.template_count}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Registered</dt>
                    <dd className="mt-1 font-medium text-slate-900">{formatDateTime(enrollment.enrolled_at)}</dd>
                  </div>
                </dl>

                {enrollment.template_count > 0 ? (
                  <Alert tone="success">
                    Your face is registered. You can update the samples if your appearance has changed.
                  </Alert>
                ) : enrollment.consent?.status === "withdrawn" ? (
                  <Alert tone="warning">
                    You withdrew consent. Registering again records a fresh consent.
                  </Alert>
                ) : enrollment.consent?.status === "granted" ? (
                  <Alert tone="info">
                    Your consent is recorded but no face samples are saved yet. Register your face to finish.
                  </Alert>
                ) : (
                  <Alert tone="info">
                    Register your face to be recognised during class attendance. Consent is required first and is
                    voluntary.
                  </Alert>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => setEnrolling(true)}>
                    <ScanFace aria-hidden className="size-4" />
                    {enrollment.template_count > 0 ? "Update my face data" : "Register my face"}
                  </Button>
                  <Button variant="secondary" onClick={() => void loadEnrollment()} loading={enrollmentLoading}>
                    <RefreshCw aria-hidden className="size-4" /> Refresh
                  </Button>
                </div>

                <p className="text-xs text-slate-500">
                  Photos are processed in this browser and never stored on the server; only encrypted face templates
                  are kept. Registration is voluntary and does not replace your email and password sign-in.
                </p>
              </div>
            ) : null}
          </Card>
        </div>
      )}

      <EnrollmentDialog
        open={enrolling}
        student={studentId ? { id: studentId, full_name: user.full_name } : null}
        selfEnrolled
        onClose={() => setEnrolling(false)}
        onChanged={() => void loadEnrollment()}
      />
    </div>
  );
}
