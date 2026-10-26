import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Fingerprint, ScanFace, ShieldCheck, Trash2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { BiometricPolicy, EnrollmentStatus } from "../lib/types";
import { Alert, Badge, Button, Card, Field, Modal, PageHeader, Spinner, Textarea } from "../components/ui";

export function PrivacyPage() {
  const { user, status: authStatus } = useAuth();
  const studentId = user?.student_id ?? null;

  const [policy, setPolicy] = useState<BiometricPolicy | null>(null);
  const [status, setStatus] = useState<EnrollmentStatus | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [deleting, setDeleting] = useState(false);
  const [withdraw, setWithdraw] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const policyBody = await api<BiometricPolicy>("/privacy/policy");
      setPolicy(policyBody);
      if (studentId !== null) {
        setStatus(await api<EnrollmentStatus>(`/enrollment/${studentId}`));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load your biometric settings.");
    } finally {
      setLoadedFor(studentId);
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (event: FormEvent) => {
    event.preventDefault();
    if (studentId === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ deleted_templates: number; consent_withdrawn: boolean }>(
        `/biometrics/${studentId}/delete`,
        {
          method: "POST",
          body: { withdraw_consent: withdraw, reason: reason.trim() },
        },
      );
      setNotice(
        res.deleted_templates > 0
          ? `${res.deleted_templates} encrypted template${res.deleted_templates === 1 ? "" : "s"} deleted${res.consent_withdrawn ? " and consent withdrawn" : ""}.`
          : res.consent_withdrawn
            ? "Consent withdrawn."
            : "There was nothing to delete.",
      );
      setDeleting(false);
      setReason("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The deletion could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  if (authStatus === "loading" || loadedFor !== studentId) {
    return (
      <div className="py-16 text-center">
        <Spinner label="Loading privacy settings" />
      </div>
    );
  }

  const consent = status?.consent ?? null;
  const consentTone = consent?.status === "granted" ? "success" : "neutral";

  return (
    <div>
      <PageHeader
        title="Privacy & biometrics"
        description="What the attendance system stores about your face, and how to withdraw it."
      />

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Your biometric status" description="Templates only — no photographs or camera footage are kept.">
          {studentId === null ? (
            <Alert tone="info">This portal account is not linked to a student record.</Alert>
          ) : (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Consent</dt>
                  <dd className="mt-1">
                    <Badge tone={consentTone}>
                      {consent ? (consent.status === "granted" ? "Granted" : "Withdrawn") : "Not recorded"}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Notice version</dt>
                  <dd className="mt-1 text-slate-800">{consent?.policy_version ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Consent recorded</dt>
                  <dd className="mt-1 text-slate-800">{formatDateTime(consent?.granted_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Withdrawn</dt>
                  <dd className="mt-1 text-slate-800">{formatDateTime(consent?.withdrawn_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Stored templates</dt>
                  <dd className="mt-1 flex items-center gap-1.5 text-slate-800">
                    <Fingerprint aria-hidden className="size-4 text-slate-400" />
                    {status?.template_count ?? 0}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Model</dt>
                  <dd className="mt-1 text-slate-800">
                    {status ? `${status.model} ${status.model_version}` : "—"}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Enrolled</dt>
                  <dd className="mt-1 text-slate-800">{formatDateTime(status?.enrolled_at)}</dd>
                </div>
              </dl>

              <p className="text-sm text-slate-600">
                Enrolment is voluntary. You can register or update your face yourself from My account → Face
                registration; staff can also assist. If you withdraw consent, your templates are deleted and
                automated recognition stops for you; manual attendance is unaffected.
              </p>

              <div className="flex flex-wrap gap-2">
                <Button variant="danger" onClick={() => setDeleting(true)}>
                  <Trash2 aria-hidden className="size-4" />
                  {status && status.template_count > 0 ? "Delete my face data" : "Withdraw consent"}
                </Button>
                <Button variant="secondary" onClick={() => void load()}>
                  Refresh
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card title={policy ? policy.title : "Biometric notice"} description={policy ? `Version ${policy.policy_version}` : undefined}>
          {policy ? (
            <div className="space-y-4">
              {policy.sections.map((section) => (
                <section key={section.heading}>
                  <h3 className="text-sm font-semibold text-slate-900">{section.heading}</h3>
                  <p className="mt-1 text-sm text-slate-600">{section.body}</p>
                </section>
              ))}
              <p className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                <ShieldCheck aria-hidden className="size-4 shrink-0" />
                Templates are encrypted at rest and deleted after {policy.retention_days} days when attendance
                processing ends, or sooner if you ask.
              </p>
            </div>
          ) : (
            <Alert tone="warning">The biometric notice is unavailable right now.</Alert>
          )}
        </Card>
      </div>

      <Modal
        open={deleting}
        onClose={() => {
          setDeleting(false);
          setReason("");
        }}
        title="Delete biometric data"
        description="This cannot be undone; you would need to consent and enrol again."
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDeleting(false);
                setReason("");
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="delete-biometrics" variant="danger" loading={busy}>
              Delete
            </Button>
          </>
        }
      >
        <form id="delete-biometrics" onSubmit={remove} className="space-y-3">
          <Field label="Templates on record" value={String(status?.template_count ?? 0)} readOnly />
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={withdraw}
              onChange={(e) => setWithdraw(e.target.checked)}
              className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span>Also withdraw my consent, so I am not enrolled again without a fresh notice.</span>
          </label>
          <Textarea
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={3}
            maxLength={500}
            hint="Stored in the audit log. Only you and administrators can see it."
          />
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <ScanFace aria-hidden className="size-4" /> Attendance already recorded is kept for academic records.
          </p>
        </form>
      </Modal>
    </div>
  );
}
