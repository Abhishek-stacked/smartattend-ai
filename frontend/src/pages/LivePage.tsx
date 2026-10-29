import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Camera, CameraOff, CheckCircle2, Clock, Flag, Pause, Play, ScanFace, Square, UserCheck } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { captureFrame, frameFile } from "../lib/camera";
import { cx } from "../lib/format";
import { attendanceLabel, attendanceTone, sessionLabel, sessionTone } from "../lib/attendance";
import type {
  AttendanceSession,
  AttendanceStatus,
  ClientSettings,
  FaceResult,
  Page,
  RecognitionOutcome,
  RecognizeResponse,
  RosterEntry,
} from "../lib/types";
import { useCamera } from "../hooks/useCamera";
import { Alert, Badge, Button, Card, EmptyState, Modal, PageHeader, Select, Spinner, Textarea } from "../components/ui";

const FEED_LIMIT = 20;
const FEED_DEDUPE_MS = 7000;

const OUTCOME_LABELS: Record<RecognitionOutcome, string> = {
  recognized: "Match confirmed",
  unknown: "No match",
  low_confidence: "Uncertain match",
  poor_quality: "Quality rejected",
  multiple_faces: "Multiple faces",
  not_eligible: "Not eligible",
  liveness_failed: "Liveness failed",
  duplicate: "Already recorded",
  error: "Not marked",
};

const OUTCOME_TONES: Record<RecognitionOutcome, "success" | "warning" | "danger" | "neutral" | "info"> = {
  recognized: "success",
  unknown: "warning",
  low_confidence: "warning",
  poor_quality: "neutral",
  multiple_faces: "warning",
  not_eligible: "danger",
  liveness_failed: "danger",
  duplicate: "info",
  error: "danger",
};

const BOX_STYLES: Record<RecognitionOutcome, string> = {
  recognized: "border-emerald-400 bg-emerald-400/10",
  unknown: "border-amber-400 bg-amber-400/10",
  low_confidence: "border-amber-400 bg-amber-400/10",
  poor_quality: "border-slate-400 bg-slate-400/10",
  multiple_faces: "border-orange-400 bg-orange-400/10",
  not_eligible: "border-rose-400 bg-rose-400/10",
  liveness_failed: "border-rose-400 bg-rose-400/10",
  duplicate: "border-sky-400 bg-sky-400/10",
  error: "border-rose-400 bg-rose-400/10",
};

interface FeedEntry {
  id: number;
  at: string;
  outcome: RecognitionOutcome;
  name: string | null;
  registration: string | null;
  message: string;
  committed: boolean;
  similarity: number | null;
  liveness: string;
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function LivePage() {
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get("session"));
  const sessionId = Number.isFinite(requested) && requested > 0 ? requested : null;

  const [activeSessions, setActiveSessions] = useState<AttendanceSession[]>([]);
  const [activeBusy, setActiveBusy] = useState(false);
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [settings, setSettings] = useState<ClientSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [frame, setFrame] = useState<{ width: number; height: number; results: FaceResult[]; processingMs: number } | null>(null);
  const [feed, setFeed] = useState<FeedEntry[]>([]);

  const [marking, setMarking] = useState<{ entry: RosterEntry; status: AttendanceStatus } | null>(null);
  const [markReason, setMarkReason] = useState("");
  const [markBusy, setMarkBusy] = useState(false);

  const camera = useCamera();
  const feedId = useRef(0);
  const lastFeedKey = useRef(new Map<string, number>());

  const loadActiveSessions = useCallback(async () => {
    setActiveBusy(true);
    try {
      const page = await api<Page<AttendanceSession>>("/sessions?status=active&page_size=100");
      setActiveSessions(page.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load active sessions.");
    } finally {
      setActiveBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadActiveSessions();
    api<ClientSettings>("/settings/client")
      .then(setSettings)
      .catch(() => setSettings(null));
  }, [loadActiveSessions]);

  const loadSelected = useCallback(async () => {
    if (sessionId === null) {
      setSession(null);
      setRoster([]);
      return;
    }
    setLoading(true);
    try {
      const [detail, entries] = await Promise.all([
        api<AttendanceSession>(`/sessions/${sessionId}`),
        api<RosterEntry[]>(`/sessions/${sessionId}/roster`),
      ]);
      setSession(detail);
      setRoster(entries);
      setError(null);
    } catch (err) {
      setSession(null);
      setRoster([]);
      setError(err instanceof ApiError ? err.message : "Unable to load the session.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadSelected();
  }, [loadSelected]);

  useEffect(() => {
    if (session?.status !== "active") setScanning(false);
  }, [session?.status]);

  useEffect(() => {
    if (!scanning) setFrame(null);
  }, [scanning]);

  const pushFeed = useCallback((results: FaceResult[]) => {
    const now = Date.now();
    const fresh: FeedEntry[] = [];
    for (const result of results) {
      if (result.outcome === "poor_quality") continue;
      const key = `${result.outcome}:${result.student?.id ?? "none"}`;
      const last = lastFeedKey.current.get(key) ?? 0;
      if (now - last < FEED_DEDUPE_MS) continue;
      lastFeedKey.current.set(key, now);
      feedId.current += 1;
      fresh.push({
        id: feedId.current,
        at: new Date(now).toISOString(),
        outcome: result.outcome,
        name: result.student?.full_name ?? null,
        registration: result.student?.registration_number ?? null,
        message: result.message,
        committed: result.attendance?.committed ?? false,
        similarity: result.similarity,
        liveness: result.liveness.status,
      });
    }
    if (fresh.length > 0) setFeed((current) => [...fresh, ...current].slice(0, FEED_LIMIT));
  }, []);

  useEffect(() => {
    if (!scanning || sessionId === null || session?.status !== "active" || !camera.active) return;
    let cancelled = false;
    let timer = 0;
    const interval = Math.max(600, settings?.frame_interval_ms ?? 1000);

    const tick = async () => {
      const video = camera.videoRef.current;
      if (!video) return;
      const width = video.videoWidth;
      const height = video.videoHeight;
      try {
        const blob = await captureFrame(video);
        const body = new FormData();
        body.append("frame", frameFile(blob));
        body.append("session_id", String(sessionId));
        const response = await api<RecognizeResponse>("/recognition/recognize", { method: "POST", body });
        if (cancelled) return;
        setScanError(null);
        setFrame({ width, height, results: response.results, processingMs: response.processing_ms });
        pushFeed(response.results);
        if (response.results.some((r) => r.attendance?.committed)) void loadSelected();
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setScanError(err.message);
          if (err.status === 409) setScanning(false);
        } else if (err instanceof DOMException && err.name === "AbortError") {
          return;
        } else {
          setScanError(err instanceof Error ? err.message : "The frame could not be processed.");
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(tick, interval);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [scanning, sessionId, session?.status, camera.active, camera.videoRef, settings?.frame_interval_ms, loadSelected, pushFeed]);

  const chooseSession = (value: string) => {
    setScanning(false);
    setFrame(null);
    setFeed([]);
    lastFeedKey.current.clear();
    setParams(value ? { session: value } : {}, { replace: true });
  };

  const submitMark = async (event: FormEvent) => {
    event.preventDefault();
    if (!marking || sessionId === null) return;
    setMarkBusy(true);
    setError(null);
    try {
      await api(`/sessions/${sessionId}/attendance`, {
        method: "POST",
        body: { student_id: marking.entry.student_id, status: marking.status, reason: markReason.trim() },
      });
      setMarking(null);
      setMarkReason("");
      await loadSelected();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to mark attendance.");
    } finally {
      setMarkBusy(false);
    }
  };

  const active = session?.status === "active";
  const markable = active || session?.status === "closed";
  const pickerSessions =
    session && !activeSessions.some((s) => s.id === session.id) ? [session, ...activeSessions] : activeSessions;
  const unmarked = roster.filter((r) => r.status === null);
  const sortedRoster = [...roster].sort((a, b) => Number(a.status !== null) - Number(b.status !== null));

  return (
    <div>
      <PageHeader
        title="Live attendance"
        description="Camera station for an active session. Only confirmed matches are written to attendance."
        actions={
          session && (
            <div className="flex items-center gap-2">
              <Badge tone={sessionTone(session.status)}>{sessionLabel(session.status)}</Badge>
              <Link
                to={`/sessions/${session.id}`}
                className="text-sm font-medium text-brand-700 hover:text-brand-800"
              >
                Session detail
              </Link>
            </div>
          )
        }
      />

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <Card className="mb-4" title="Session" description="Only sessions that are currently active accept recognition.">
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Active session"
            className="min-w-64 flex-1"
            value={sessionId ?? ""}
            onChange={(e) => chooseSession(e.target.value)}
          >
            <option value="">Choose a session…</option>
            {pickerSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.course_code} · {s.title} · {timeOnly(s.scheduled_start)}
                {s.status !== "active" ? ` (${sessionLabel(s.status)})` : ""}
              </option>
            ))}
          </Select>
          <Button variant="secondary" onClick={() => void loadActiveSessions()} loading={activeBusy}>
            Refresh list
          </Button>
          {sessionId !== null && (
            <Button variant="secondary" onClick={() => void loadSelected()} loading={loading}>
              Refresh roster
            </Button>
          )}
        </div>

        {session && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span className="font-medium text-slate-900">
              {session.course_code} · {session.course_name}
            </span>
            <span className="text-slate-300">|</span>
            <span>{session.faculty_name}</span>
            <span className="text-slate-300">|</span>
            <span>
              {session.counts.present} present · {session.counts.late} late · {session.counts.pending_review} pending
              review · {session.counts.unmarked} unmarked
            </span>
          </div>
        )}

        {sessionId === null && (
          <p className="mt-4 text-sm text-slate-500">
            {activeSessions.length > 0
              ? "Pick a session to start the camera station."
              : "No session is active right now. Start a scheduled session from "}
            {activeSessions.length === 0 && (
              <Link to="/sessions" className="font-medium text-brand-700 hover:text-brand-800">
                sessions
              </Link>
            )}
            {activeSessions.length === 0 && "."}
          </p>
        )}
      </Card>

      {session && session.liveness_policy !== "off" && (
        <Alert
          tone={session.liveness_policy === "enforce" ? "warning" : "info"}
          className="mb-4"
          title={`Liveness policy: ${session.liveness_policy}`}
        >
          {session.liveness_policy === "enforce"
            ? "Attendance is written only when the liveness check passes. If the model is unavailable, nothing is marked automatically — use the manual fallback."
            : "Confident identities are recorded, but failed or inconclusive liveness checks are queued for staff review. Liveness is an experimental signal: verify suspicious presentations in person."}{" "}
          No image is stored; only scores are recorded.
        </Alert>
      )}

      {session && !active && (
        <Alert tone="info" className="mb-4">
          This session is {sessionLabel(session.status).toLowerCase()}. Recognition only runs while a session is active.
          Use manual marking or reopen the session from the detail page.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card
            title="Camera station"
            description="Frames are analysed in memory and are not stored. Boxes show the last processed frame."
            actions={
              camera.active && (
                <Button
                  size="sm"
                  variant={scanning ? "secondary" : "primary"}
                  onClick={() => setScanning((s) => !s)}
                  disabled={!active}
                >
                  {scanning ? <Pause aria-hidden className="size-3.5" /> : <Play aria-hidden className="size-3.5" />}
                  {scanning ? "Pause scanning" : "Start scanning"}
                </Button>
              )
            }
          >
            <div className="relative overflow-hidden rounded-lg border-2 border-slate-300 bg-black">
              <video
                ref={camera.videoRef}
                muted
                playsInline
                className="block w-full"
                aria-label="Live camera preview"
              />
              {frame && (
                <div aria-hidden className="pointer-events-none absolute inset-0">
                  {frame.results.map((result, index) => {
                    const [x, y, width, height] = result.box;
                    return (
                      <div
                        key={`${result.event_id ?? "frame"}-${index}`}
                        className={cx("absolute rounded-md border-2", BOX_STYLES[result.outcome])}
                        style={{
                          left: `${(x / frame.width) * 100}%`,
                          top: `${(y / frame.height) * 100}%`,
                          width: `${(width / frame.width) * 100}%`,
                          height: `${(height / frame.height) * 100}%`,
                        }}
                      >
                        <span className="absolute -top-6 left-0 max-w-full truncate border border-brand-500 bg-black/85 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-chalk">
                          {result.student?.full_name ?? OUTCOME_LABELS[result.outcome]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {!camera.active && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400">
                  <ScanFace aria-hidden className="size-8" />
                  <p className="text-sm text-chalk">{active ? "Camera is off" : "Select an active session to use the camera"}</p>
                  <Button variant="secondary" onClick={camera.start} loading={camera.starting} disabled={!active}>
                    <Camera aria-hidden className="size-4" /> Turn on camera
                  </Button>
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {camera.active && (
                <Button variant="secondary" onClick={camera.stop}>
                  <CameraOff aria-hidden className="size-4" /> Stop camera
                </Button>
              )}
              {camera.active && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setScanning(false);
                    setFrame(null);
                  }}
                  disabled={!scanning}
                >
                  <Square aria-hidden className="size-4" /> Clear overlay
                </Button>
              )}
              <span className="text-sm text-slate-500">
                {camera.active
                  ? scanning
                    ? `Scanning every ${Math.max(600, settings?.frame_interval_ms ?? 1000)} ms`
                    : "Camera on · scanning paused"
                  : "Camera off"}
              </span>
              {frame && <span className="text-xs text-slate-400">last frame {frame.processingMs} ms</span>}
            </div>

            {camera.error && (
              <Alert tone="error" className="mt-3">
                {camera.error}
              </Alert>
            )}
            {scanError && (
              <Alert tone="error" className="mt-3">
                {scanError}
              </Alert>
            )}
            {camera.active && scanning && frame && frame.results.length === 0 && (
              <p className="mt-3 text-sm text-slate-500">No face in the last frame — ask the student to step forward.</p>
            )}
          </Card>

          <Card
            padded={false}
            title="Event feed"
            description="Uncertain results are queued for review; nothing is marked on a guess."
          >
            {feed.length === 0 ? (
              <EmptyState
                icon={<Flag aria-hidden className="size-5" />}
                title="No recognition events yet"
                description="Start scanning while students present themselves to the camera."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {feed.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3 px-4 py-3">
                    <Badge tone={OUTCOME_TONES[entry.outcome]}>{OUTCOME_LABELS[entry.outcome]}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {entry.name ?? "Unidentified face"}
                        {entry.registration && (
                          <span className="ml-2 text-xs font-normal text-slate-500">{entry.registration}</span>
                        )}
                        {entry.committed && (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                            <CheckCircle2 aria-hidden className="size-3.5" /> marked
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">
                        {entry.message}
                        {entry.similarity !== null && ` · similarity ${(entry.similarity * 100).toFixed(1)}%`}
                        {entry.liveness === "not_enabled" && " · liveness unavailable"}
                        {entry.liveness !== "not_required" && entry.liveness !== "not_enabled" &&
                          ` · liveness ${entry.liveness}`}
                      </p>
                    </div>
                    <time className="shrink-0 text-xs text-slate-400">{timeOnly(entry.at)}</time>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card
          padded={false}
          title="Manual fallback"
          description={`${unmarked.length} of ${roster.length} participants still unmarked.`}
        >
          {sessionId === null ? (
            <div className="p-5">
              <EmptyState
                icon={<UserCheck aria-hidden className="size-5" />}
                title="No session selected"
                description="Choose an active session to see its roster."
              />
            </div>
          ) : loading && roster.length === 0 ? (
            <div className="p-8 text-center">
              <Spinner label="Loading roster" />
            </div>
          ) : sortedRoster.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<UserCheck aria-hidden className="size-5" />}
                title="The roster is empty"
                description="Enrol students in the course before the session."
              />
            </div>
          ) : (
            <ul className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
              {sortedRoster.map((entry) => (
                <li key={entry.student_id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{entry.full_name}</p>
                      <p className="text-xs text-slate-500">
                        {entry.registration_number}
                        {!entry.biometric_enrolled && " · no face templates"}
                      </p>
                    </div>
                    {entry.status ? (
                      <Badge tone={attendanceTone(entry.status)}>{attendanceLabel(entry.status)}</Badge>
                    ) : (
                      <Badge tone="neutral">Unmarked</Badge>
                    )}
                  </div>
                  {markable && !entry.status && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setMarking({ entry, status: "present" })}
                      >
                        <CheckCircle2 aria-hidden className="size-3.5" /> Present
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setMarking({ entry, status: "late" })}>
                        <Clock aria-hidden className="size-3.5" /> Late
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setMarking({ entry, status: "excused" })}>
                        Excused
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal
        open={marking !== null}
        onClose={() => {
          setMarking(null);
          setMarkReason("");
        }}
        title={marking ? `Mark ${attendanceLabel(marking.status).toLowerCase()}` : ""}
        description={marking ? `${marking.entry.full_name} · ${marking.entry.registration_number}` : undefined}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setMarking(null);
                setMarkReason("");
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="live-manual-mark" loading={markBusy}>
              Save mark
            </Button>
          </>
        }
      >
        <form id="live-manual-mark" onSubmit={submitMark} className="space-y-3">
          <p className="text-sm text-slate-600">
            Manual marks are recorded with your account in the audit log. They are never attributed to the camera.
          </p>
          <Textarea
            label="Reason"
            value={markReason}
            onChange={(e) => setMarkReason(e.target.value)}
            required
            minLength={3}
            hint="For example: camera unavailable, student verified in person."
          />
        </form>
      </Modal>
    </div>
  );
}
