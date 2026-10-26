import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Fingerprint, Info, Lock, Timer } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { cx, formatDateTime } from "../lib/format";
import { attendanceLabel, attendanceTone, sessionLabel, sessionTone } from "../lib/attendance";
import type { SelfMarkResult, StudentSession } from "../lib/types";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Spinner } from "../components/ui";

function countdown(target: string | null, now: number): string {
  if (!target) return "—";
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return "closed";
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function MarkAttendancePage() {
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setSessions(await api<StudentSession[]>("/sessions/mine"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load your sessions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const mark = async (session: StudentSession) => {
    setBusyId(session.id);
    setError(null);
    setNotice(null);
    try {
      const result = await api<SelfMarkResult>(`/sessions/${session.id}/self-mark`, { method: "POST" });
      setNotice(
        result.already_marked
          ? `Attendance for ${session.title} was already recorded as ${attendanceLabel(result.status).toLowerCase()}.`
          : `You are marked ${attendanceLabel(result.status).toLowerCase()} for ${session.title}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to mark your attendance.");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const { open, upcoming, rest } = useMemo(() => {
    const open: StudentSession[] = [];
    const upcoming: StudentSession[] = [];
    const rest: StudentSession[] = [];
    const live = ["scheduled", "active", "paused"];
    for (const session of sessions) {
      if (session.self_marking_open) open.push(session);
      else if (
        session.record_status === null &&
        live.includes(session.status) &&
        new Date(session.scheduled_end).getTime() > now
      )
        upcoming.push(session);
      else rest.push(session);
    }
    return { open, upcoming, rest };
  }, [sessions, now]);

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Spinner label="Loading sessions" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Mark my attendance"
        description="Confirm your presence in a live session. Marking is only possible while the session window is open."
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

      <Alert tone="info" className="mb-5" title="How this works">
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>Self-marking opens at the scheduled start time and closes when the attendance window ends.</li>
          <li>Your faculty can lock self-marking for you at any time if they need to verify your presence.</li>
          <li>A self-marked record is kept as a separate source and can be reviewed or corrected later.</li>
        </ul>
      </Alert>

      {sessions.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarClock aria-hidden className="size-5" />}
            title="No sessions yet"
            description="You are not on the roster for any session. Enrolment is done by the course faculty."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              <Fingerprint aria-hidden className="size-4" /> Open now
            </h2>
            {open.length === 0 ? (
              <Card>
                <p className="text-sm text-slate-500">
                  No session is accepting self-marking right now. Open windows appear here automatically when a
                  session starts.
                </p>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {open.map((session) => (
                  <article
                    key={session.id}
                    className={cx(
                      "relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-brand-900 to-slate-950 p-5 text-white shadow-float ring-1 ring-white/10",
                      open.length === 1 && "md:col-span-2",
                    )}
                  >
                    <div aria-hidden className="orb -right-12 -top-20 size-56 bg-brand-400/40" />
                    <div aria-hidden className="orb -bottom-24 -left-12 size-52 bg-accent-400/25" />
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-0 opacity-[0.08]"
                      style={{
                        backgroundImage:
                          "linear-gradient(rgba(255,255,255,.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.9) 1px, transparent 1px)",
                        backgroundSize: "38px 38px",
                        maskImage: "radial-gradient(75% 65% at 80% 0%, #000 0%, transparent 72%)",
                        WebkitMaskImage: "radial-gradient(75% 65% at 80% 0%, #000 0%, transparent 72%)",
                      }}
                    />

                    <div className="relative">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-300/30">
                          <span className="relative flex size-1.5">
                            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                          </span>
                          Live now
                        </span>
                        <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/80 ring-1 ring-white/15">
                          {session.course_code}
                        </span>
                      </div>
                      <h3 className="text-lg font-semibold tracking-tight text-white">{session.title}</h3>
                      <p className="mt-1 text-sm text-white/60">
                        {session.course_name} · starts {formatDateTime(session.scheduled_start)}
                      </p>

                      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                        <span className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm text-white/80 ring-1 ring-white/15">
                          <Timer aria-hidden className="size-4 text-accent-300" />
                          Closes in
                          <span className="font-semibold tabular-nums text-white">
                            {countdown(session.self_marking_closes_at, now)}
                          </span>
                        </span>
                        <Button
                          className="press-3d h-11 rounded-xl bg-gradient-to-b from-emerald-300 via-emerald-400 to-teal-500 px-5 text-emerald-950 shadow-[0_12px_28px_-12px_rgba(16,185,129,0.95)] hover:from-emerald-200 hover:via-emerald-300 hover:to-teal-400"
                          loading={busyId === session.id}
                          onClick={() => void mark(session)}
                        >
                          <CheckCircle2 aria-hidden className="size-4" /> Mark me present
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {upcoming.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <CalendarClock aria-hidden className="size-4" /> Upcoming
              </h2>
              <Card padded={false}>
                <ul className="divide-y divide-slate-100">
                  {upcoming.map((session) => (
                    <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div>
                        <p className="font-medium text-slate-900">{session.title}</p>
                        <p className="text-xs text-slate-500">
                          {session.course_code} · {formatDateTime(session.scheduled_start)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={sessionTone(session.status)}>{sessionLabel(session.status)}</Badge>
                        {session.self_marking_message && (
                          <span className="text-xs text-slate-500">{session.self_marking_message}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          {rest.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <Info aria-hidden className="size-4" /> Earlier sessions
              </h2>
              <Card padded={false}>
                <ul className="divide-y divide-slate-100">
                  {rest.map((session) => (
                    <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div>
                        <p className="font-medium text-slate-900">{session.title}</p>
                        <p className="text-xs text-slate-500">
                          {session.course_code} · {formatDateTime(session.scheduled_start)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {session.record_status ? (
                          <Badge tone={attendanceTone(session.record_status)}>
                            {attendanceLabel(session.record_status)}
                          </Badge>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-slate-500">
                            <Lock aria-hidden className="size-3.5" /> Not marked
                          </span>
                        )}
                        {session.self_marking_message && !session.record_status && (
                          <span className="text-xs text-slate-500">{session.self_marking_message}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
