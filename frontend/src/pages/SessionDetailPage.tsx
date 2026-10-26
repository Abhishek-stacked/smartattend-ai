import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Flag,
  Lock,
  LockOpen,
  Pause,
  Play,
  RotateCcw,
  ScanFace,
  Square,
  UserCheck,
  XCircle,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { attendanceLabel, attendanceTone, sessionLabel, sessionTone } from "../lib/attendance";
import type { AttendanceSession, AttendanceStatus, RosterEntry } from "../lib/types";
import { useAuth } from "../context/AuthContext";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Spinner,
  Switch,
  Textarea,
} from "../components/ui";

type PendingAction = "cancel" | "reopen" | "finalize" | "close" | null;

const ACTION_COPY: Record<Exclude<PendingAction, null>, { title: string; body: string; confirm: string }> = {
  close: {
    title: "Close session",
    body: "New marks stop being accepted. Unmarked students can still be marked while the session is closed.",
    confirm: "Close session",
  },
  finalize: {
    title: "Finalize session",
    body: "Every participant without a record will be marked absent with source 'system'. Finalized sessions cannot be reopened.",
    confirm: "Finalize and mark absences",
  },
  cancel: {
    title: "Cancel session",
    body: "The session is cancelled and cannot be started. Existing records are kept but no longer editable.",
    confirm: "Cancel session",
  },
  reopen: {
    title: "Reopen session",
    body: "Reopening returns the session to active. A reason is required and is written to the audit log.",
    confirm: "Reopen session",
  },
};

export function SessionDetailPage() {
  const { sessionId } = useParams();
  const id = Number(sessionId);
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [pending, setPending] = useState<PendingAction>(null);
  const [reason, setReason] = useState("");
  const [pendingMark, setPendingMark] = useState<{ student: RosterEntry; status: AttendanceStatus } | null>(null);
  const [markReason, setMarkReason] = useState("");
  const [pendingLock, setPendingLock] = useState<RosterEntry | null>(null);
  const [lockReason, setLockReason] = useState("");

  const load = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    try {
      const [detail, entries] = await Promise.all([
        api<AttendanceSession>(`/sessions/${id}`),
        api<RosterEntry[]>(`/sessions/${id}/roster`),
      ]);
      setSession(detail);
      setRoster(entries);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load the session.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const transition = async (action: string, body?: Record<string, unknown>) => {
    setBusyAction(action);
    setError(null);
    try {
      await api<AttendanceSession>(`/sessions/${id}/${action}`, { method: "POST", body: body ?? {} });
      setPending(null);
      setReason("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to update the session.");
    } finally {
      setBusyAction(null);
    }
  };

  const mark = async (event: FormEvent) => {
    event.preventDefault();
    if (!pendingMark) return;
    setBusyAction("mark");
    setError(null);
    try {
      await api(`/sessions/${id}/attendance`, {
        method: "POST",
        body: { student_id: pendingMark.student.student_id, status: pendingMark.status, reason: markReason.trim() },
      });
      setPendingMark(null);
      setMarkReason("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to mark attendance.");
    } finally {
      setBusyAction(null);
    }
  };

  const toggleSelfMarking = async (enabled: boolean) => {
    setBusyAction("self-marking");
    setError(null);
    try {
      await api<AttendanceSession>(`/sessions/${id}/self-marking`, {
        method: "PATCH",
        body: { enabled },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to update self-marking.");
    } finally {
      setBusyAction(null);
    }
  };

  const applyLock = async (entry: RosterEntry, locked: boolean, lockReasonText: string | null) => {
    setBusyAction(`lock-${entry.student_id}`);
    setError(null);
    try {
      const updated = await api<RosterEntry[]>(`/sessions/${id}/participants/${entry.student_id}/self-marking`, {
        method: "PATCH",
        body: { locked, reason: lockReasonText },
      });
      setRoster(updated);
      setPendingLock(null);
      setLockReason("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to update self-marking access.");
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Spinner label="Loading session" />
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        <Alert tone="error">{error ?? "Session not found."}</Alert>
        <Button className="mt-4" variant="secondary" onClick={() => navigate("/sessions")}>
          <ArrowLeft aria-hidden className="size-4" /> Back to sessions
        </Button>
      </div>
    );
  }

  const markable = session.status === "active" || session.status === "closed";
  const unmarked = roster.filter((r) => r.status === null);
  const counts = session.counts;
  const summary = [
    { label: "Participants", value: counts.participants, icon: UserCheck, tone: "text-slate-700" },
    { label: "Present", value: counts.present, icon: CheckCircle2, tone: "text-emerald-700" },
    { label: "Late", value: counts.late, icon: Clock, tone: "text-amber-700" },
    { label: "Absent", value: counts.absent, icon: XCircle, tone: "text-rose-700" },
    { label: "Pending review", value: counts.pending_review, icon: Flag, tone: "text-amber-700" },
    { label: "Unmarked", value: counts.unmarked, icon: Clock, tone: "text-slate-500" },
  ];

  return (
    <div>
      <div className="mb-3">
        <Link to="/sessions" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft aria-hidden className="size-4" /> All sessions
        </Link>
      </div>

      <PageHeader
        title={session.title}
        description={`${session.course_code} · ${session.course_name} · ${session.faculty_name}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={sessionTone(session.status)}>{sessionLabel(session.status)}</Badge>
            {session.status === "scheduled" && (
              <Button onClick={() => transition("start")} loading={busyAction === "start"}>
                <Play aria-hidden className="size-4" /> Start session
              </Button>
            )}
            {session.status === "active" && (
              <>
                <Button variant="secondary" onClick={() => transition("pause")} loading={busyAction === "pause"}>
                  <Pause aria-hidden className="size-4" /> Pause
                </Button>
                <Button variant="secondary" onClick={() => setPending("close")}>
                  <Square aria-hidden className="size-4" /> Close
                </Button>
              </>
            )}
            {session.status === "paused" && (
              <>
                <Button onClick={() => transition("resume")} loading={busyAction === "resume"}>
                  <Play aria-hidden className="size-4" /> Resume
                </Button>
                <Button variant="secondary" onClick={() => setPending("close")}>
                  <Square aria-hidden className="size-4" /> Close
                </Button>
              </>
            )}
            {session.status === "closed" && (
              <>
                <Button onClick={() => setPending("finalize")}>
                  <CheckCircle2 aria-hidden className="size-4" /> Finalize
                </Button>
                <Button variant="secondary" onClick={() => setPending("reopen")}>
                  <RotateCcw aria-hidden className="size-4" /> Reopen
                </Button>
              </>
            )}
            {(session.status === "scheduled" || session.status === "active" || session.status === "paused") && (
              <Button variant="ghost" onClick={() => setPending("cancel")}>
                Cancel
              </Button>
            )}
            {markable && (
              <Button variant="secondary" onClick={() => navigate(`/live?session=${id}`)}>
                <ScanFace aria-hidden className="size-4" /> Live view
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <div className="mb-4 grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {[
              { label: "Scheduled", value: formatDateTime(session.scheduled_start) },
              { label: "Ends", value: formatDateTime(session.scheduled_end) },
              { label: "Late after", value: formatDateTime(session.late_after) },
              { label: "Window closes", value: formatDateTime(session.attendance_closes_at) },
              { label: "Liveness policy", value: session.liveness_policy },
              { label: "Started", value: formatDateTime(session.started_at) },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-white/80 bg-gradient-to-b from-white to-slate-50/70 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_14px_-12px_rgba(30,27,75,0.55)]"
              >
                <dt className="text-xs uppercase tracking-wide text-slate-500">{item.label}</dt>
                <dd className="mt-0.5 font-medium text-slate-800">{item.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card>
          <div className="grid grid-cols-2 gap-3">
            {summary.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-white/80 bg-gradient-to-b from-white to-slate-50/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_14px_-12px_rgba(30,27,75,0.55)]"
              >
                <p className="flex items-center gap-1 text-xs text-slate-500">
                  <item.icon aria-hidden className="size-3.5" /> {item.label}
                </p>
                <p className={`mt-1 text-xl font-semibold tabular-nums ${item.tone}`}>{item.value}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {isAdmin && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 max-w-2xl">
              <h2 className="text-base font-semibold text-slate-900">Student self-marking</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                When enabled, students can mark their own attendance between the scheduled start and the close of the
                attendance window. You can still lock any individual student below.
              </p>
            </div>
            <Switch
              checked={session.self_marking_enabled}
              onChange={(next) => void toggleSelfMarking(next)}
              disabled={busyAction === "self-marking"}
              label="Student self-marking"
            />
          </div>
        </Card>
      )}

      {!markable && (
        <Alert tone="info" className="mb-4">
          {session.status === "scheduled" && "Start the session to record attendance."}
          {session.status === "finalized" && "This session is finalized. Use a correction request or record correction to change a mark."}
          {session.status === "cancelled" && "This session was cancelled; attendance cannot be recorded."}
        </Alert>
      )}

      <Card
        padded={false}
        title="Roster"
        description={`${roster.length} participants · ${unmarked.length} still unmarked`}
      >
        {roster.length === 0 ? (
          <EmptyState
            icon={<UserCheck aria-hidden className="size-5" />}
            title="The roster is empty"
            description="Enroll students in the course before scheduling the session."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <caption className="sr-only">Session roster</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Student</th>
                  <th scope="col" className="px-4 py-3 font-medium">Biometrics</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Marked</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Self-mark</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Manual mark</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {roster.map((entry) => (
                  <tr key={entry.student_id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{entry.full_name}</p>
                      <p className="text-xs text-slate-500">{entry.registration_number}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={entry.biometric_enrolled ? "success" : "neutral"}>
                        {entry.biometric_enrolled ? "Enrolled" : "None"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {entry.status ? (
                        <Badge tone={attendanceTone(entry.status)}>{attendanceLabel(entry.status)}</Badge>
                      ) : (
                        <span className="text-slate-400">Not marked</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {entry.marked_at ? (
                        <>
                          <p>{formatDateTime(entry.marked_at)}</p>
                          <p className="text-xs text-slate-500">{entry.source}</p>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {entry.self_marking_locked ? (
                        <div className="flex flex-col items-end gap-1">
                          <Badge tone="warning">
                            <Lock aria-hidden className="size-3" /> Locked
                          </Badge>
                          {entry.self_marking_lock_reason && (
                            <p className="max-w-[16rem] text-xs text-slate-500">{entry.self_marking_lock_reason}</p>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={busyAction === `lock-${entry.student_id}`}
                            onClick={() => void applyLock(entry, false, null)}
                          >
                            <LockOpen aria-hidden className="size-3.5" /> Unlock
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setPendingLock(entry);
                            setLockReason("");
                          }}
                        >
                          <Lock aria-hidden className="size-3.5" /> Lock
                        </Button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {markable && !entry.status ? (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setPendingMark({ student: entry, status: "present" })}
                          >
                            Present
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setPendingMark({ student: entry, status: "late" })}
                          >
                            Late
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setPendingMark({ student: entry, status: "excused" })}
                          >
                            Excused
                          </Button>
                        </div>
                      ) : (
                        <p className="text-right text-xs text-slate-400">
                          {entry.status ? "Recorded" : "Unavailable"}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={pending !== null}
        onClose={() => {
          setPending(null);
          setReason("");
        }}
        title={pending ? ACTION_COPY[pending].title : ""}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPending(null);
                setReason("");
              }}
            >
              Keep as is
            </Button>
            <Button
              variant={pending === "finalize" || pending === "cancel" ? "danger" : "primary"}
              loading={busyAction === pending}
              onClick={() =>
                pending &&
                transition(pending, {
                  reason: reason.trim() || null,
                })
              }
            >
              {pending ? ACTION_COPY[pending].confirm : ""}
            </Button>
          </>
        }
      >
        {pending && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{ACTION_COPY[pending].body}</p>
            {(pending === "reopen" || pending === "cancel") && (
              <Textarea
                label={pending === "reopen" ? "Reason" : "Reason (optional)"}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required={pending === "reopen"}
                minLength={pending === "reopen" ? 3 : undefined}
                hint="Recorded in the audit log."
              />
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={pendingMark !== null}
        onClose={() => {
          setPendingMark(null);
          setMarkReason("");
        }}
        title={pendingMark ? `Mark ${attendanceLabel(pendingMark.status).toLowerCase()}` : ""}
        description={pendingMark ? `${pendingMark.student.full_name} · ${pendingMark.student.registration_number}` : undefined}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPendingMark(null);
                setMarkReason("");
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="manual-mark-form" loading={busyAction === "mark"}>
              Save mark
            </Button>
          </>
        }
      >
        <form id="manual-mark-form" onSubmit={mark} className="space-y-3">
          <Field label="Status" value={attendanceLabel(pendingMark?.status ?? null)} readOnly />
          <Textarea
            label="Reason"
            value={markReason}
            onChange={(e) => setMarkReason(e.target.value)}
            required
            minLength={3}
            hint="Manual marks are audited with your account."
          />
        </form>
      </Modal>

      <Modal
        open={pendingLock !== null}
        onClose={() => {
          setPendingLock(null);
          setLockReason("");
        }}
        title="Lock self-marking"
        description={
          pendingLock ? `${pendingLock.full_name} · ${pendingLock.registration_number}` : undefined
        }
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPendingLock(null);
                setLockReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busyAction === `lock-${pendingLock?.student_id}`}
              onClick={() => pendingLock && void applyLock(pendingLock, true, lockReason.trim() || null)}
            >
              Lock self-marking
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            This student can no longer mark their own attendance for this session. Face recognition and manual marks
            still work as normal.
          </p>
          <Textarea
            label="Reason (optional)"
            value={lockReason}
            onChange={(e) => setLockReason(e.target.value)}
            maxLength={500}
            hint="Recorded in the audit log."
          />
        </div>
      </Modal>
    </div>
  );
}
