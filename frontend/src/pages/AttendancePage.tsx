import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ClipboardCheck, History, Search } from "lucide-react";
import { api, ApiError, query } from "../lib/api";
import { formatDate, formatDateTime, roleLabel } from "../lib/format";
import { attendanceLabel, attendanceTone } from "../lib/attendance";
import type {
  AttendanceDetail,
  AttendanceRecord,
  AttendanceStatus,
  Course,
  Page,
} from "../lib/types";
import { useAuth } from "../context/AuthContext";
import { useDebounced } from "../hooks/useDebounced";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "../components/ui";

const PAGE_SIZE = 15;

const SOURCE_TONE: Record<AttendanceRecord["source"], "brand" | "info" | "neutral"> = {
  automated: "brand",
  manual: "info",
  system: "neutral",
  self_reported: "brand",
};

export function AttendancePage() {
  const { user } = useAuth();
  const isStaff = user?.role === "admin" || user?.role === "faculty";

  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");
  const [status, setStatus] = useState<"" | AttendanceStatus>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 250);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<AttendanceRecord> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [detail, setDetail] = useState<AttendanceDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState<number | null>(null);
  const [correctStatus, setCorrectStatus] = useState<AttendanceStatus>("present");
  const [correctReason, setCorrectReason] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [correctionStatus, setCorrectionStatus] = useState<"present" | "late" | "excused">("present");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [correctionNotice, setCorrectionNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isStaff) return;
    api<Page<Course>>(`/courses${query({ page_size: 100 })}`)
      .then((result) => setCourses(result.items))
      .catch(() => setCourses([]));
  }, [isStaff]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api<Page<AttendanceRecord>>(
      `/attendance${query({ course_id: courseId, status, date_from: dateFrom, date_to: dateTo, page, page_size: PAGE_SIZE })}`,
      { signal: controller.signal },
    )
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Unable to load attendance records.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [courseId, status, dateFrom, dateTo, page, refreshKey, isStaff]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  const openDetail = async (record: AttendanceRecord) => {
    setDetailBusy(record.id);
    setDetailError(null);
    try {
      const result = await api<AttendanceDetail>(`/attendance/${record.id}`);
      setDetail(result);
      setCorrectStatus(result.status);
      setCorrectReason("");
      setCorrectionStatus(result.status === "present" ? "late" : "present");
      setCorrectionReason("");
      setCorrectionNotice(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load the record.");
    } finally {
      setDetailBusy(null);
    }
  };

  const correct = async (event: FormEvent) => {
    event.preventDefault();
    if (!detail) return;
    setCorrecting(true);
    setDetailError(null);
    try {
      const updated = await api<AttendanceDetail>(`/attendance/${detail.id}`, {
        method: "PATCH",
        body: { status: correctStatus, reason: correctReason.trim() },
      });
      setDetail(updated);
      setCorrectReason("");
      reload();
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "Unable to correct the record.");
    } finally {
      setCorrecting(false);
    }
  };

  const requestCorrection = async (event: FormEvent) => {
    event.preventDefault();
    if (!detail) return;
    setCorrectionBusy(true);
    setDetailError(null);
    setCorrectionNotice(null);
    try {
      await api("/corrections", {
        method: "POST",
        body: {
          session_id: detail.session_id,
          requested_status: correctionStatus,
          reason: correctionReason.trim(),
        },
      });
      setCorrectionReason("");
      setCorrectionNotice("Correction request submitted. Your faculty will review it.");
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "Unable to submit the correction request.");
    } finally {
      setCorrectionBusy(false);
    }
  };

  const canRequestCorrection = detail
    ? detail.session_status === "active" || detail.session_status === "closed" || detail.session_status === "finalized"
    : false;

  const items = (data?.items ?? []).filter((r) => {
    if (!q) return true;
    const needle = q.toLowerCase();
    return (
      r.student_name.toLowerCase().includes(needle) ||
      r.registration_number.toLowerCase().includes(needle) ||
      r.course_code.toLowerCase().includes(needle) ||
      r.session_title.toLowerCase().includes(needle)
    );
  });
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Attendance records"
        description={
          isStaff
            ? "Official records across your courses. Every change keeps a before/after audit trail."
            : "Your attendance history. Contact your faculty if a record looks wrong."
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
              placeholder="Filter this page by student, course or session"
              aria-label="Filter records"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500"
            />
          </div>
          {isStaff && (
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
          )}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as "" | AttendanceStatus);
              setPage(1);
            }}
            aria-label="Filter by status"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
          >
            <option value="">Any status</option>
            <option value="present">Present</option>
            <option value="late">Late</option>
            <option value="absent">Absent</option>
            <option value="excused">Excused</option>
            <option value="pending_review">Pending review</option>
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
            <Spinner label="Loading records" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck aria-hidden className="size-5" />}
            title="No attendance records"
            description={
              isStaff
                ? "Records appear here once sessions are started and students are marked."
                : "You have no attendance records for these filters yet."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <caption className="sr-only">Attendance records</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Date</th>
                  {isStaff && <th scope="col" className="px-4 py-3 font-medium">Student</th>}
                  <th scope="col" className="px-4 py-3 font-medium">Course / session</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Marked</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 text-slate-600">{formatDate(r.session_date)}</td>
                    {isStaff && (
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{r.student_name}</p>
                        <p className="text-xs text-slate-500">{r.registration_number}</p>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <p className="text-slate-800">{r.course_code}</p>
                      <p className="text-xs text-slate-500">{r.session_title}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={attendanceTone(r.status)}>{attendanceLabel(r.status)}</Badge>
                        <Badge tone={SOURCE_TONE[r.source]}>{r.source}</Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <p>{formatDateTime(r.marked_at)}</p>
                      {r.corrected_at && <p className="text-xs text-amber-700">Corrected</p>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="secondary" loading={detailBusy === r.id} onClick={() => openDetail(r)}>
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
          <span>
            Page {page} of {lastPage} · {total} records
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
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.course_code} · ${detail.session_title}` : "Record"}
        description={detail ? `${detail.student_name} · ${formatDate(detail.session_date)}` : undefined}
        size="lg"
      >
        {detail && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={attendanceTone(detail.status)}>{attendanceLabel(detail.status)}</Badge>
              <Badge tone={SOURCE_TONE[detail.source]}>{detail.source}</Badge>
              <span className="text-xs text-slate-500">Marked {formatDateTime(detail.marked_at)}</span>
              {detail.correction_reason && (
                <span className="text-xs text-amber-700">Correction: {detail.correction_reason}</span>
              )}
            </div>

            {detail.event && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Recognition event
                </h3>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-slate-500">Outcome</dt>
                    <dd className="text-slate-800">{detail.event.outcome}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Similarity</dt>
                    <dd className="text-slate-800">
                      {detail.event.similarity !== null ? detail.event.similarity.toFixed(3) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Threshold</dt>
                    <dd className="text-slate-800">
                      {detail.event.threshold_used !== null ? detail.event.threshold_used.toFixed(2) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Liveness</dt>
                    <dd className="text-slate-800">{detail.event.liveness_status}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Model</dt>
                    <dd className="text-slate-800">
                      {detail.event.model_name ?? "—"} {detail.event.model_version ?? ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Processing</dt>
                    <dd className="text-slate-800">
                      {detail.event.processing_ms !== null ? `${detail.event.processing_ms} ms` : "—"}
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <History aria-hidden className="size-4" /> Audit history
              </h3>
              {detail.history.length === 0 ? (
                <p className="text-sm text-slate-500">No audit entries for this record.</p>
              ) : (
                <ol className="space-y-2">
                  {detail.history.map((entry) => (
                    <li key={entry.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-slate-800">{entry.action}</span>
                        <span className="text-xs text-slate-500">{formatDateTime(entry.occurred_at)}</span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {entry.actor_name ?? "System"}
                        {entry.actor_role ? ` · ${roleLabel(entry.actor_role)}` : ""}
                        {entry.reason ? ` · ${entry.reason}` : ""}
                      </p>
                      {entry.before && entry.after && (
                        <p className="mt-1 text-xs text-slate-600">
                          {String(entry.before.status ?? "—")} → {String(entry.after.status ?? "—")}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {isStaff && (
              <form onSubmit={correct} className="space-y-3 rounded-lg border border-slate-200 p-3">
                <h3 className="text-sm font-semibold text-slate-900">Record correction</h3>
                {detailError && <Alert tone="error">{detailError}</Alert>}
                <Select
                  label="New status"
                  value={correctStatus}
                  onChange={(e) => setCorrectStatus(e.target.value as AttendanceStatus)}
                >
                  <option value="present">Present</option>
                  <option value="late">Late</option>
                  <option value="absent">Absent</option>
                  <option value="excused">Excused</option>
                  <option value="pending_review">Pending review</option>
                </Select>
                <Textarea
                  label="Reason"
                  value={correctReason}
                  onChange={(e) => setCorrectReason(e.target.value)}
                  required
                  minLength={3}
                  hint="Required and captured in the audit log."
                />
                <div className="flex justify-end">
                  <Button type="submit" loading={correcting}>
                    Save correction
                  </Button>
                </div>
              </form>
            )}

            {!isStaff && (
              <form onSubmit={requestCorrection} className="space-y-3 rounded-lg border border-slate-200 p-3">
                <h3 className="text-sm font-semibold text-slate-900">Request a correction</h3>
                <p className="text-xs text-slate-500">
                  Requests are reviewed by faculty before any change is applied. Once per session while one is pending.
                </p>
                {detailError && <Alert tone="error">{detailError}</Alert>}
                {correctionNotice && <Alert tone="success">{correctionNotice}</Alert>}
                <Select
                  label="Requested status"
                  value={correctionStatus}
                  onChange={(e) => setCorrectionStatus(e.target.value as "present" | "late" | "excused")}
                >
                  <option value="present">Present</option>
                  <option value="late">Late</option>
                  <option value="excused">Excused</option>
                </Select>
                <Textarea
                  label="Reason"
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  required
                  minLength={5}
                  hint="At least 5 characters. Shared with the reviewing faculty member."
                />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-500">
                    {canRequestCorrection
                      ? "This session is closed to new recognition; a request is still possible."
                      : "This session has not started yet."}
                  </span>
                  <Button type="submit" loading={correctionBusy} disabled={!canRequestCorrection}>
                    Submit request
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
