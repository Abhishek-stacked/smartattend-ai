import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, CalendarPlus, Search } from "lucide-react";
import { api, ApiError, query } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { attendanceRate, sessionLabel, sessionTone } from "../lib/attendance";
import type { AttendanceSession, ClientSettings, Course, Page, SessionStatus } from "../lib/types";
import { useDebounced } from "../hooks/useDebounced";
import { Alert, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Select, Spinner } from "../components/ui";

const PAGE_SIZE = 12;

function todayLocal(): string {
  return new Date().toLocaleDateString("en-CA");
}

function localToIso(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

export function SessionsPage() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");
  const [status, setStatus] = useState<"" | SessionStatus>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 250);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<AttendanceSession> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    course_id: "",
    title: "",
    date: todayLocal(),
    start: "09:00",
    end: "10:00",
    late_after_min: "",
    window_min: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [defaults, setDefaults] = useState<ClientSettings | null>(null);

  useEffect(() => {
    api<Page<Course>>(`/courses${query({ status: "active", page_size: 100 })}`)
      .then((result) => setCourses(result.items))
      .catch(() => setCourses([]));
    api<ClientSettings>("/settings/client")
      .then(setDefaults)
      .catch(() => setDefaults(null));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api<Page<AttendanceSession>>(
      `/sessions${query({ course_id: courseId, status, date_from: dateFrom, date_to: dateTo, page, page_size: PAGE_SIZE })}`,
      { signal: controller.signal },
    )
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Unable to load sessions.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [courseId, status, dateFrom, dateTo, page, refreshKey]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  const createSession = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const created = await api<AttendanceSession>("/sessions", {
        method: "POST",
        body: {
          course_id: Number(form.course_id),
          title: form.title.trim(),
          scheduled_start: localToIso(form.date, form.start),
          scheduled_end: localToIso(form.date, form.end),
          late_after_min: form.late_after_min ? Number(form.late_after_min) : null,
          window_min: form.window_min ? Number(form.window_min) : null,
        },
      });
      setCreateOpen(false);
      setForm({
        course_id: "",
        title: "",
        date: todayLocal(),
        start: "09:00",
        end: "10:00",
        late_after_min: "",
        window_min: "",
      });
      reload();
      navigate(`/sessions/${created.id}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Unable to create the session.");
    } finally {
      setBusy(false);
    }
  };

  const items = (data?.items ?? []).filter((s) => {
    if (!q) return true;
    const needle = q.toLowerCase();
    return (
      s.title.toLowerCase().includes(needle) ||
      s.course_code.toLowerCase().includes(needle) ||
      s.course_name.toLowerCase().includes(needle)
    );
  });
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Attendance sessions"
        description="Schedule lectures, run the attendance window, and finalize the register."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <CalendarPlus aria-hidden className="size-4" /> Schedule session
          </Button>
        }
      />

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
          <div className="relative min-w-52 flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter this page by title or course"
              aria-label="Filter sessions"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500"
            />
          </div>
          <select
            value={courseId}
            onChange={(e) => {
              setCourseId(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by course"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
          >
            <option value="">All courses</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as "" | SessionStatus);
              setPage(1);
            }}
            aria-label="Filter by status"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
          >
            <option value="">Any status</option>
            <option value="scheduled">Scheduled</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="closed">Closed</option>
            <option value="finalized">Finalized</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            aria-label="From date"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            aria-label="To date"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
          />
        </div>

        {loading && !data ? (
          <div className="p-10 text-center">
            <Spinner label="Loading sessions" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<CalendarClock aria-hidden className="size-5" />}
            title="No sessions match these filters"
            description="Schedule a session for one of your active courses."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <caption className="sr-only">Attendance sessions</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Session</th>
                  <th scope="col" className="px-4 py-3 font-medium">Scheduled</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Attendance</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((s) => {
                  const marked = s.counts.participants - s.counts.unmarked;
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{s.title}</p>
                        <p className="text-xs text-slate-500">
                          {s.course_code} · {s.course_name}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <p>{formatDateTime(s.scheduled_start)}</p>
                        <p className="text-xs text-slate-500">to {formatDateTime(s.scheduled_end)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={sessionTone(s.status)}>{sessionLabel(s.status)}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-700">
                          {s.counts.present + s.counts.late}/{s.counts.participants} present
                        </p>
                        <p className="text-xs text-slate-500">
                          {marked} marked · {attendanceRate(s.counts).toFixed(0)}% attendance
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="secondary" onClick={() => navigate(`/sessions/${s.id}`)}>
                          Open
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
          <span>
            Page {page} of {lastPage} · {total} sessions
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Schedule session"
        description="The roster includes every student currently enrolled in the course. Students added later join automatically."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="session-form" loading={busy}>
              Schedule
            </Button>
          </>
        }
      >
        <form id="session-form" onSubmit={createSession} className="space-y-4" noValidate>
          {formError && <Alert tone="error">{formError}</Alert>}
          <Select
            label="Course"
            id="session-course"
            value={form.course_id}
            onChange={(e) => setForm({ ...form, course_id: e.target.value })}
            required
          >
            <option value="">Select a course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
              </option>
            ))}
          </Select>
          <Field
            label="Title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Lecture 6 - Transactions"
            required
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Date"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
            <Field
              label="Starts"
              type="time"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
              required
            />
            <Field
              label="Ends"
              type="time"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Late after (minutes)"
              type="number"
              min={0}
              max={240}
              value={form.late_after_min}
              placeholder={defaults ? String(defaults.default_late_after_min) : "10"}
              onChange={(e) => setForm({ ...form, late_after_min: e.target.value })}
              hint="Leave blank to use the application default."
            />
            <Field
              label="Window (minutes)"
              type="number"
              min={1}
              max={480}
              value={form.window_min}
              placeholder={defaults ? String(defaults.default_window_min) : "30"}
              onChange={(e) => setForm({ ...form, window_min: e.target.value })}
              hint="How long after the start marking stays open."
            />
          </div>
        </form>
      </Modal>
    </div>
  );
}
