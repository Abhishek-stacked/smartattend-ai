import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarClock,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  Flag,
  FilePenLine,
  RefreshCw,
  ScanFace,
  Server,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, ApiError, query } from "../lib/api";
import { cx, formatDate, formatDateTime, percent, roleLabel } from "../lib/format";
import { STATUS_COLORS } from "../lib/reportColors";
import { attendanceLabel, attendanceTone, sessionTone } from "../lib/attendance";
import { navFor } from "../lib/navigation";
import type {
  Activity,
  AttendanceRecord,
  AttendanceStatus,
  MeSummary,
  Page,
  ReportSummary,
  Trends,
} from "../lib/types";
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner } from "../components/ui";

// Recharts is a large dependency; only the two chart cards need it.
const TrendChart = lazy(() =>
  import("../components/charts/AttendanceCharts").then((module) => ({ default: module.TrendChart })),
);
const StatusPie = lazy(() =>
  import("../components/charts/AttendanceCharts").then((module) => ({ default: module.StatusPie })),
);

interface Health {
  status: "ok" | "degraded";
  database: "ok" | "unavailable";
  models: Record<string, "present" | "missing">;
}

const MODEL_LABELS: Record<string, string> = {
  face_detection: "Face detection (YuNet)",
  face_recognition: "Face recognition (SFace)",
  liveness: "Liveness (MiniFASNet, experimental)",
};

const CHART_STATUSES: AttendanceStatus[] = ["present", "late", "absent", "excused", "pending_review"];

type Period = "30d" | "90d" | "all";

const PERIODS: Record<Period, { label: string; days: number | null; granularity: "day" | "week" | "month" }> = {
  "30d": { label: "Last 30 days", days: 30, granularity: "day" },
  "90d": { label: "Last 90 days", days: 90, granularity: "week" },
  all: { label: "All time", days: null, granularity: "month" },
};

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toLocaleDateString("en-CA");
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function Stat({
  label,
  value,
  hint,
  accent = "from-brand-400 via-brand-500 to-accent-400",
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="panel panel-edge group relative overflow-hidden rounded-2xl p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-lift">
      <span
        aria-hidden
        className={cx(
          "absolute -right-6 -top-8 size-24 rounded-full bg-gradient-to-br opacity-20 blur-2xl transition-opacity duration-300 group-hover:opacity-40",
          accent,
        )}
      />
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1.5 bg-gradient-to-br from-slate-900 to-brand-700 bg-clip-text text-2xl font-semibold tabular-nums text-transparent">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const isStaff = user?.role === "admin" || user?.role === "faculty";
  const isAdmin = user?.role === "admin";

  const [period, setPeriod] = useState<Period>("30d");
  const [refreshKey, setRefreshKey] = useState(0);
  const [summary, setSummary] = useState<ReportSummary | MeSummary | null>(null);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [recent, setRecent] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    api<Health>("/health", { signal: controller.signal })
      .then((data) => {
        setHealth(data);
        setHealthError(false);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setHealthError(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!user || !isStaff) return;
    const controller = new AbortController();
    const config = PERIODS[period];
    const range =
      config.days === null
        ? { date_from: null, date_to: null }
        : { date_from: daysAgo(config.days), date_to: daysAgo(0) };
    setLoading(true);
    Promise.all([
      api<ReportSummary>(`/reports/summary${query(range)}`, { signal: controller.signal }),
      api<Trends>(
        `/reports/trends${query({ ...range, granularity: config.granularity })}`,
        { signal: controller.signal },
      ),
      api<Activity>("/reports/activity", { signal: controller.signal }),
    ])
      .then(([summaryData, trendData, activityData]) => {
        setSummary(summaryData);
        setTrends(trendData);
        setActivity(activityData);
        setError(null);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Unable to load dashboard metrics.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [user, isStaff, period, refreshKey]);

  useEffect(() => {
    if (!user || isStaff) return;
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      api<MeSummary>("/me/summary", { signal: controller.signal }),
      api<Page<AttendanceRecord>>(`/me/attendance${query({ page_size: 6 })}`, { signal: controller.signal }),
    ])
      .then(([summaryData, records]) => {
        setSummary(summaryData);
        setRecent(records.items);
        setError(null);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Unable to load your attendance.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [user, isStaff, refreshKey]);

  if (!user) return null;
  const shortcuts = navFor(user.role).filter((item) => item.to !== "/dashboard" && item.to !== "/profile");
  const pendingTotal = summary ? summary.pending_reviews + summary.pending_corrections : 0;
  const distribution = trends
    ? CHART_STATUSES.map((status) => ({
        status,
        label: attendanceLabel(status),
        value: trends.distribution[status] ?? 0,
      })).filter((slice) => slice.value > 0)
    : [];
  const marked = summary ? summary.present + summary.late + summary.absent + summary.excused + summary.pending_review : 0;

  return (
    <div>
      <PageHeader
        title={greeting()}
        description={`${user.full_name} · ${roleLabel(user.role)} · ${user.email}`}
        actions={
          <>
            <Badge tone="brand">{roleLabel(user.role)}</Badge>
            {isStaff && (
              <select
                value={period}
                onChange={(event) => setPeriod(event.target.value as Period)}
                aria-label="Reporting period"
                className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
              >
                {(Object.keys(PERIODS) as Period[]).map((key) => (
                  <option key={key} value={key}>
                    {PERIODS[key].label}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={refresh}
              aria-label="Refresh dashboard"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 shadow-sm hover:bg-slate-50"
            >
              <RefreshCw aria-hidden className={loading ? "size-4 animate-spin" : "size-4"} />
            </button>
          </>
        }
      />

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {!summary ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <Spinner label="Loading attendance analytics" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Stat
              label="Attendance rate"
              value={percent(summary.attendance_rate)}
              hint={`${summary.present + summary.late} of ${marked} marked`}
              accent="from-emerald-400 via-teal-400 to-accent-400"
            />
            <Stat
              label="Present"
              value={String(summary.present)}
              hint={`${summary.late} late`}
              accent="from-emerald-300 via-emerald-400 to-teal-400"
            />
            <Stat
              label="Absent"
              value={String(summary.absent)}
              hint={`${summary.excused} excused`}
              accent="from-rose-300 via-rose-400 to-orange-300"
            />
            <Stat
              label="Sessions"
              value={String(summary.sessions)}
              hint={`${summary.active_sessions} active · ${summary.participants} participants`}
              accent="from-brand-300 via-brand-400 to-accent-400"
            />
            <Stat
              label={isStaff ? "Needs attention" : "My requests"}
              value={String(isStaff ? pendingTotal : summary.pending_corrections)}
              hint={
                isStaff
                  ? `${summary.pending_reviews} reviews · ${summary.pending_corrections} corrections`
                  : `${summary.pending_corrections} awaiting review`
              }
              accent="from-violet-300 via-fuchsia-400 to-brand-400"
            />
          </div>

          {isStaff && pendingTotal > 0 && (
            <Alert tone="warning" title="Waiting on a decision" className="mt-4">
              <div className="flex flex-wrap items-center gap-4">
                {summary.pending_reviews > 0 && (
                  <Link to="/review" className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline">
                    <Flag aria-hidden className="size-3.5" /> {summary.pending_reviews} recognition event(s) to review
                  </Link>
                )}
                {summary.pending_corrections > 0 && (
                  <Link
                    to="/corrections"
                    className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
                  >
                    <FilePenLine aria-hidden className="size-3.5" /> {summary.pending_corrections} correction
                    request(s)
                  </Link>
                )}
              </div>
            </Alert>
          )}

          {isStaff && trends ? (
            <>
              <div className="mt-5 grid items-start gap-5 lg:grid-cols-3">
                <Card
                  className="lg:col-span-2"
                  title="Attendance trend"
                  description={`${PERIODS[period].label} grouped by ${PERIODS[period].granularity}.`}
                >
                  {trends.series.length === 0 ? (
                    <EmptyState
                      icon={<CalendarClock aria-hidden className="size-5" />}
                      title="No attendance data for this period"
                      description="Start a session and mark students to build the trend."
                    />
                  ) : (
                    <div className="h-64 w-full">
                      <Suspense fallback={<div className="h-full w-full animate-pulse rounded-lg bg-slate-50" />}>
                        <TrendChart series={trends.series} />
                      </Suspense>
                    </div>
                  )}
                </Card>

                <Card title="Status distribution" description="Every marked record in the selected period.">
                  {distribution.length === 0 ? (
                    <EmptyState
                      icon={<ClipboardCheck aria-hidden className="size-5" />}
                      title="Nothing marked yet"
                      description="Records appear here as soon as attendance is recorded."
                    />
                  ) : (
                    <>
                      <div className="h-40 w-full">
                        <Suspense fallback={<div className="h-full w-full animate-pulse rounded-lg bg-slate-50" />}>
                          <StatusPie slices={distribution} />
                        </Suspense>
                      </div>
                      <ul className="mt-2 space-y-1.5 text-sm">
                        {distribution.map((slice) => (
                          <li key={slice.status} className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2 text-slate-600">
                              <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[slice.status] }} />
                              {slice.label}
                            </span>
                            <span className="tabular-nums text-slate-900">
                              {slice.value}
                              <span className="ml-1 text-xs text-slate-500">
                                ({percent((slice.value / Math.max(1, marked)) * 100)})
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </Card>
              </div>

              <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
                <Card
                  title="Attendance by course"
                  description="Present and late are counted as attended."
                  actions={
                    <Link to="/reports" className="text-sm font-medium text-brand-600 hover:text-brand-700">
                      Full reports
                    </Link>
                  }
                >
                  {trends.courses.length === 0 ? (
                    <EmptyState
                      icon={<ClipboardCheck aria-hidden className="size-5" />}
                      title="No courses with records"
                      description="Course comparisons need at least one marked session."
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <caption className="sr-only">Attendance by course</caption>
                        <thead className="text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th scope="col" className="pb-2 font-medium">Course</th>
                            <th scope="col" className="pb-2 text-right font-medium">Records</th>
                            <th scope="col" className="pb-2 text-right font-medium">Attendance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {trends.courses.map((course) => (
                            <tr key={course.course_id}>
                              <td className="py-2.5">
                                <p className="font-medium text-slate-900">{course.code}</p>
                                <p className="text-xs text-slate-500">{course.name}</p>
                              </td>
                              <td className="py-2.5 text-right tabular-nums text-slate-600">{course.total}</td>
                              <td className="py-2.5 text-right">
                                <span className="tabular-nums font-medium text-slate-900">{percent(course.rate)}</span>
                                <span className="mt-1 block h-1 w-24 overflow-hidden rounded-full bg-slate-100">
                                  <span
                                    className="block h-full rounded-full bg-brand-500"
                                    style={{ width: `${Math.min(100, course.rate)}%` }}
                                  />
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>

                <Card
                  title="Latest sessions"
                  description="The five most recent sessions in your scope."
                  actions={
                    <Link to="/sessions" className="text-sm font-medium text-brand-600 hover:text-brand-700">
                      All sessions
                    </Link>
                  }
                >
                  {!activity || activity.sessions.length === 0 ? (
                    <EmptyState
                      icon={<CalendarClock aria-hidden className="size-5" />}
                      title="No sessions yet"
                      description="Schedule a session to begin taking attendance."
                    />
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {activity.sessions.map((session) => (
                        <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                          <div className="min-w-0">
                            <Link
                              to={`/sessions/${session.id}`}
                              className="truncate text-sm font-medium text-slate-900 hover:text-brand-700"
                            >
                              {session.course_code} · {session.title}
                            </Link>
                            <p className="text-xs text-slate-500">
                              {formatDate(session.session_date)} · {session.counts.present} present ·{" "}
                              {session.counts.late} late · {session.counts.absent} absent
                              {session.counts.unmarked > 0 ? ` · ${session.counts.unmarked} unmarked` : ""}
                            </p>
                          </div>
                          <Badge tone={sessionTone(session.status)}>{session.status}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </>
          ) : (
            <div className="mt-5 grid items-start gap-5 lg:grid-cols-3">
              <Card
                className="lg:col-span-2"
                title="Recent attendance"
                description="Your six most recent records."
                actions={
                  <Link to="/attendance" className="text-sm font-medium text-brand-600 hover:text-brand-700">
                    All records
                  </Link>
                }
              >
                {recent.length === 0 ? (
                  <EmptyState
                    icon={<ClipboardCheck aria-hidden className="size-5" />}
                    title="No attendance records yet"
                    description="Records appear once your faculty starts a session you are enrolled in."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <caption className="sr-only">Your recent attendance</caption>
                      <thead className="text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th scope="col" className="pb-2 font-medium">Date</th>
                          <th scope="col" className="pb-2 font-medium">Course / session</th>
                          <th scope="col" className="pb-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {recent.map((record) => (
                          <tr key={record.id}>
                            <td className="py-2.5 text-slate-600">{formatDate(record.session_date)}</td>
                            <td className="py-2.5">
                              <p className="text-slate-800">{record.course_code}</p>
                              <p className="text-xs text-slate-500">{record.session_title}</p>
                            </td>
                            <td className="py-2.5">
                              <Badge tone={attendanceTone(record.status)}>{attendanceLabel(record.status)}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card title="Quick actions">
                <div className="grid gap-2">
                  {shortcuts.map(({ to, label, icon: Icon }) => (
                    <Link
                      key={to}
                      to={to}
                      className="group flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-800"
                    >
                      <span className="grid size-8 place-items-center rounded-md bg-slate-100 text-slate-600 group-hover:bg-brand-100 group-hover:text-brand-700">
                        <Icon aria-hidden className="size-4" />
                      </span>
                      {label}
                      <ArrowRight aria-hidden className="ml-auto size-4 text-slate-300 group-hover:text-brand-500" />
                    </Link>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </>
      )}

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-3">
        <Card title="Your account">
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Full name</dt>
              <dd className="font-medium text-slate-900">{user.full_name}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Email</dt>
              <dd className="truncate font-medium text-slate-900">{user.email}</dd>
            </div>
            {summary && "registration_number" in summary && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Registration</dt>
                <dd className="font-medium text-slate-900">{summary.registration_number}</dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Last sign-in</dt>
              <dd className="font-medium text-slate-900">{formatDateTime(user.last_login_at)}</dd>
            </div>
          </dl>
          <Link
            to="/profile"
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            Manage account <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Card>

        <Card title="How recognition is decided" description="The rules the backend enforces on every event.">
          <ul className="space-y-3 text-sm text-slate-600">
            <li className="flex gap-2">
              <UserRound aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-500" />
              A match is accepted only above the configured similarity threshold and only against students enrolled
              for the active session.
            </li>
            <li className="flex gap-2">
              <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-500" />
              Low-confidence, unknown and ambiguous faces are flagged for review — never marked present
              automatically.
            </li>
            <li className="flex gap-2">
              <ScanFace aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-500" />
              Liveness is evaluated separately from identity. When its policy is off, attendance proceeds on
              recognition alone and the decision is recorded.
            </li>
          </ul>
        </Card>

        {isAdmin && (
          <Card title="System status" description="Live check of the API, database and installed models.">
            {healthError ? (
              <p className="text-sm text-rose-600">Status check failed. The API may be unreachable.</p>
            ) : !health ? (
              <Spinner label="Checking services" />
            ) : (
              <ul className="space-y-3 text-sm">
                <li className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-slate-600">
                    <Server aria-hidden className="size-4" /> API &amp; database
                  </span>
                  {health.database === "ok" ? (
                    <Badge tone="success">
                      <CircleCheck aria-hidden className="size-3.5" /> Operational
                    </Badge>
                  ) : (
                    <Badge tone="danger">
                      <CircleX aria-hidden className="size-3.5" /> Degraded
                    </Badge>
                  )}
                </li>
                {Object.entries(health.models).map(([key, state]) => (
                  <li key={key} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-slate-600">
                      {key === "liveness" ? (
                        <ShieldCheck aria-hidden className="size-4" />
                      ) : (
                        <ScanFace aria-hidden className="size-4" />
                      )}
                      {MODEL_LABELS[key] ?? key}
                    </span>
                    {state === "present" ? (
                      <Badge tone="success">Installed</Badge>
                    ) : (
                      <Badge tone="warning">Not installed</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
