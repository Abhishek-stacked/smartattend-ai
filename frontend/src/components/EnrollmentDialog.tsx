import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Camera, CameraOff, Check, ScanFace, Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { captureFrame, frameFile } from "../lib/camera";
import { formatDateTime } from "../lib/format";
import type {
  BiometricPolicy,
  ClientSettings,
  ConsentRecord,
  DetectResponse,
  EnrollResponse,
  EnrollmentStatus,
} from "../lib/types";
import { useCamera } from "../hooks/useCamera";
import { Alert, Badge, Button, Modal, Spinner } from "./ui";

type Step = "loading" | "consent" | "capture" | "done";

export interface EnrollmentTarget {
  id: number;
  full_name: string;
  registration_number?: string | null;
}

const QUALITY_TEXT: Record<string, string> = {
  face_too_small: "Move closer so the face fills more of the frame.",
  blurry: "Hold still — the frame is blurry.",
  too_dark: "Add light in front of the participant.",
  too_bright: "Reduce backlight or glare.",
};

const MIN_SAMPLES = 3;
const MAX_SAMPLES = 5;

function feedback(
  detect: DetectResponse | null,
  selfEnrolled = false,
): { tone: "success" | "warning" | "error" | "info"; text: string } {
  if (!detect) return { tone: "info", text: "Checking the camera frame…" };
  if (detect.faces.length === 0) {
    return {
      tone: "warning",
      text: selfEnrolled ? "No face detected. Look straight at the camera." : "No face detected. Ask the participant to look at the camera.",
    };
  }
  if (detect.faces.length > 1) {
    return {
      tone: "error",
      text: selfEnrolled ? "More than one face is visible. Make sure you are alone in the frame." : "More than one face is visible. Capture one participant at a time.",
    };
  }
  const face = detect.faces[0];
  if (!face.quality.ok) {
    const text = face.quality.issues
      .map((issue) => (selfEnrolled && issue === "too_dark" ? "Add more light in front of you." : QUALITY_TEXT[issue] ?? issue))
      .join(" ");
    return { tone: "warning", text };
  }
  return { tone: "success", text: "Good sample — the face is clear and well framed." };
}

export function EnrollmentDialog({
  open,
  student,
  selfEnrolled = false,
  onClose,
  onChanged,
}: {
  open: boolean;
  student: EnrollmentTarget | null;
  selfEnrolled?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [step, setStep] = useState<Step>("loading");
  const [policy, setPolicy] = useState<BiometricPolicy | null>(null);
  const [status, setStatus] = useState<EnrollmentStatus | null>(null);
  const [settings, setSettings] = useState<ClientSettings | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [samples, setSamples] = useState<Blob[]>([]);
  const [detect, setDetect] = useState<DetectResponse | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [replace, setReplace] = useState(false);
  const [result, setResult] = useState<EnrollResponse | null>(null);

  const camera = useCamera();
  const stopCamera = camera.stop;

  const loadStatus = useCallback(async (studentId: number) => {
    const next = await api<EnrollmentStatus>(`/enrollment/${studentId}`);
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    if (!open || !student) return;
    let cancelled = false;
    setStep("loading");
    setConfirmed(false);
    setSamples([]);
    setDetect(null);
    setResult(null);
    setReplace(false);
    setError(null);
    void Promise.all([
      api<BiometricPolicy>("/privacy/policy"),
      api<EnrollmentStatus>(`/enrollment/${student.id}`),
      api<ClientSettings>("/settings/client"),
    ])
      .then(([policyBody, enrollment, client]) => {
        if (cancelled) return;
        setPolicy(policyBody);
        setStatus(enrollment);
        setSettings(client);
        setStep(enrollment.consent?.status === "granted" ? "capture" : "consent");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Unable to load the enrolment details.");
        setStep("consent");
      });
    return () => {
      cancelled = true;
    };
  }, [open, student]);

  useEffect(() => {
    if (!open || step === "done") stopCamera();
  }, [open, step, stopCamera]);

  useEffect(() => {
    if (step !== "capture" || !camera.active) return;
    let cancelled = false;
    let timer = 0;
    const interval = Math.max(600, settings?.frame_interval_ms ?? 1000);

    const tick = async () => {
      try {
        const blob = await captureFrame(camera.videoRef.current);
        const body = new FormData();
        body.append("frame", frameFile(blob));
        const response = await api<DetectResponse>("/recognition/detect", { method: "POST", body });
        if (!cancelled) setDetect(response);
      } catch {
        if (!cancelled) setDetect(null);
      }
      if (!cancelled) timer = window.setTimeout(tick, interval);
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [step, camera.active, camera.videoRef, settings?.frame_interval_ms]);

  const recordConsent = async (event: FormEvent) => {
    event.preventDefault();
    if (!student || !policy) return;
    setBusy(true);
    setError(null);
    try {
      await api<ConsentRecord>(`/enrollment/${student.id}/consent`, {
        method: "POST",
        body: { policy_version: policy.policy_version, participant_confirmed: true },
      });
      await loadStatus(student.id);
      setStep("capture");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The consent could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const addSample = async () => {
    if (!student) return;
    setCapturing(true);
    setError(null);
    try {
      const blob = await captureFrame(camera.videoRef.current);
      const body = new FormData();
      body.append("frame", frameFile(blob));
      const check = await api<DetectResponse>("/recognition/detect", { method: "POST", body });
      setDetect(check);
      if (check.faces.length !== 1) {
        setError("Keep exactly one face in the frame before capturing.");
        return;
      }
      if (!check.faces[0].quality.ok) {
        setError(feedback(check).text);
        return;
      }
      setSamples((current) => (current.length >= MAX_SAMPLES ? current : [...current, blob]));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The sample could not be captured.");
    } finally {
      setCapturing(false);
    }
  };

  const submit = async () => {
    if (!student) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      samples.forEach((blob, index) => body.append("samples", frameFile(blob, `sample-${index + 1}.jpg`)));
      body.append("replace", status && status.template_count > 0 && replace ? "true" : "false");
      const response = await api<EnrollResponse>(`/enrollment/${student.id}`, { method: "POST", body });
      setResult(response);
      setStep("done");
      camera.stop();
      onChanged();
      await loadStatus(student.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The templates could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    camera.stop();
    onClose();
  };

  const statusHint = feedback(detect, selfEnrolled);

  return (
    <Modal
      open={open}
      onClose={close}
      title={student ? (selfEnrolled ? "Register your face" : `Face enrolment · ${student.full_name}`) : "Face enrolment"}
      description={student ? (selfEnrolled ? "Facial attendance registration" : student.registration_number ?? undefined) : undefined}
      size="lg"
      footer={
        step === "consent" ? (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="consent-form" loading={busy} disabled={!confirmed || !policy}>
              Record consent and continue
            </Button>
          </>
        ) : step === "capture" ? (
          <>
            <Button variant="secondary" onClick={close}>
              Close
            </Button>
            <Button onClick={submit} loading={busy} disabled={samples.length < MIN_SAMPLES}>
              Save {samples.length || ""} sample{samples.length === 1 ? "" : "s"}
            </Button>
          </>
        ) : (
          <Button onClick={close}>Done</Button>
        )
      }
    >
      {step === "loading" ? (
        <div className="py-8 text-center">
          <Spinner label="Loading enrolment" />
        </div>
      ) : step === "consent" ? (
        <form id="consent-form" onSubmit={recordConsent} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          {status?.consent?.status === "withdrawn" && (
            <Alert tone="info">Consent was previously withdrawn. Record a fresh consent before enrolling again.</Alert>
          )}
          {policy ? (
            <>
              <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Version {policy.policy_version}</p>
                  <h3 className="text-sm font-semibold text-slate-900">{policy.title}</h3>
                </div>
                {policy.sections.map((section) => (
                  <section key={section.heading}>
                    <h4 className="text-sm font-medium text-slate-800">{section.heading}</h4>
                    <p className="text-sm text-slate-600">{section.body}</p>
                  </section>
                ))}
              </div>
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span>
                  {selfEnrolled
                    ? "I have read this notice, had the chance to ask questions, and agree to facial enrolment for attendance. I understand enrolment is voluntary."
                    : "The participant has read this notice, had the chance to ask questions, and agrees to facial enrolment for attendance. They understand enrolment is voluntary."}
                </span>
              </label>
            </>
          ) : (
            <Alert tone="error">The biometric notice could not be loaded. Close this dialog and try again.</Alert>
          )}
        </form>
      ) : step === "capture" ? (
        <div className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Alert tone="info">
            Take {MIN_SAMPLES}–{MAX_SAMPLES} samples in one sitting, looking straight at the camera. Photos stay in this
            browser until submission; the server stores encrypted templates only.
          </Alert>
          {selfEnrolled && (
            <p className="text-sm text-slate-600">
              Use good, even lighting and keep your whole face in the frame. Nobody else should be visible. You can
              update these samples later from this page.
            </p>
          )}

          <div className="relative overflow-hidden rounded-lg bg-slate-900">
            <video
              ref={camera.videoRef}
              muted
              playsInline
              className="aspect-video w-full object-cover"
              aria-label="Enrolment camera preview"
            />
            {!camera.active && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-300">
                <ScanFace aria-hidden className="size-8" />
                <p className="text-sm">Camera is off</p>
                <Button variant="secondary" onClick={camera.start} loading={camera.starting}>
                  <Camera aria-hidden className="size-4" /> Turn on camera
                </Button>
              </div>
            )}
          </div>
          {camera.error && <Alert tone="error">{camera.error}</Alert>}

          {camera.active && <Alert tone={statusHint.tone}>{statusHint.text}</Alert>}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={addSample} loading={capturing} disabled={!camera.active || samples.length >= MAX_SAMPLES}>
              <Camera aria-hidden className="size-4" /> Capture sample
            </Button>
            {camera.active && (
              <Button variant="secondary" onClick={camera.stop}>
                <CameraOff aria-hidden className="size-4" /> Stop camera
              </Button>
            )}
            {samples.length > 0 && (
              <Button variant="ghost" onClick={() => setSamples([])}>
                <Trash2 aria-hidden className="size-4" /> Clear samples
              </Button>
            )}
            <span className="text-sm text-slate-600">
              {samples.length} of {MAX_SAMPLES} captured
            </span>
            {samples.length >= MIN_SAMPLES && (
              <Badge tone="success">
                <Check aria-hidden className="size-3" /> Ready to save
              </Badge>
            )}
          </div>

          {status && status.template_count > 0 && (
            <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
                className="mt-0.5 size-4 rounded border-amber-300 text-brand-600 focus:ring-brand-500"
              />
              <span>
                {selfEnrolled ? "You already have" : "This student already has"} {status.template_count} templates
                {status.enrolled_at ? ` from ${formatDateTime(status.enrolled_at)}` : ""}. Tick to replace them.
              </span>
            </label>
          )}
        </div>
      ) : (
        result && (
          <div className="space-y-3">
            <Alert tone="success" title={selfEnrolled ? "Face registration complete" : "Enrolment complete"}>
              {result.template_count} encrypted templates {selfEnrolled ? "were saved for you" : "saved for this student"} using{" "}
              {result.model} {result.model_version}. No photographs were retained.
            </Alert>
            <p className="text-sm text-slate-600">
              {selfEnrolled ? "You can now be" : "The student can now be"} recognised during active sessions.
              Recognition still requires a close match and is queued for review when uncertain.
            </p>
          </div>
        )
      )}
    </Modal>
  );
}
