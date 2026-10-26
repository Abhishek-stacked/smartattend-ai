import { useEffect, useState } from "react";
import { Download, RefreshCw, Table2 } from "lucide-react";
import { api, ApiError, download, query } from "../lib/api";
import { cx, percent } from "../lib/format";
import type { Course, CorrectionStatus, Page, ReportColumn, ReportTable, ReportType } from "../lib/types";
import { Alert, Button, Card, EmptyState, PageHeader, Spinner } from "../components/ui";

const PAGE_SIZE = 25;

const REPORT_GROUPS: Array<{ label: string; options: Array<{ value: ReportType; label: string }> }> = [
  {
    label: "Summaries",
    options: [
      { value: "daily", label: "Daily attendance" },
      { value: "weekly", label: "Weekly attendance" },
      { value: "monthly", label: "Monthly attendance" },
    ],
  },
  {
    label: "Breakdowns",
    options: [
      { value: "course", label: "By course" },
      { value: "student", label: "By student" },
      { value: "faculty", label: "By faculty" },
    ],
  },
  {
    label: "Exception lists",
    options: [
      { value: "late", label: "Late arrivals" },
      { value: "absence", label: "Absences" },
      { value: "exceptions", label: "Pending review records" },
      { value: "corrections", label: "Correction requests" },
    ],
  },
];

const REPORT_TITLES: Record<ReportType, string> = {
  daily: "Daily attendance",
  weekly: "Weekly attendance",
  monthly: "Monthly attendance",
  course: "Attendance by course",
  student: "Attendance by student",
  faculty: "Attendance by faculty",
  late: "Late arrivals",
  absence: "Absences",
  exceptions: "Pending review records",
  corrections: "Correction requests",
};

const CORRECTION_STATUSES: Array<{ value: CorrectionStatus; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
];

function cellText(column: ReportColumn, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (column.key === "rate") return percent(Number(value));
  return String(value);
}

export function ReportsPage() {
  const [type, setType] = useState<ReportType>("daily");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [courseId, setCourseId] = useState("");
  const [status, setStatus] = useState<CorrectionStatus | "">("");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  const [courses, setCourses] = useState<Course[]>([]);
  const [report, setReport] = useState<ReportTable | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);

  const invalidRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);

  useEffect(() => {
    api<Page<Course>>(`/courses${query({ page_size: 100 })}`)
      .then((result) => setCourses(result.items))
      .catch(() => setCourses([]));
  }, []);

  useEffect(() => {
    if (invalidRange) return;
    const controller = new AbortController();
    setLoading(true);
    setNotice(null);
    api<ReportTable>(
      `/reports/attendance${query({
        type,
        date_from: dateFrom,
        date_to: dateTo,
        course_id: courseId,
        status: type === "corrections" ? status : "",
        page,
        page_size: PAGE_SIZE,
      })}`,
      { signal: controller.signal },
    )
      .then((result) => {
        setReport(result);
        setError(null);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Unable to build this report.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [type, dateFrom, dateTo, courseId, status, page, refreshKey, invalidRange]);

  const exportReport = async (fmt: "csv" | "pdf") => {
    setExporting(fmt);
    setError(null);
    setNotice(null);
    try {
      const filename = await download(
        `/reports/export${query({
          type,
          fmt,
          date_from: dateFrom,
          date_to: dateTo,
          course_id: courseId,
          status: type === "corrections" ? status : "",
        })}`,
        `smartattend-${type}.${fmt}`,
      );
      setNotice(`Downloaded ${filename}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The export could not be generated.");
    } finally {
      setExporting(null);
    }
  };

  const lastPage = report ? Math.max(1, Math.ceil(report.total / PAGE_SIZE)) : 1;
  const summary = report?.summary ?? {};
  const showRate = typeof summary.rate === "number";

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Every figure is queried from attendance records in your scope — nothing is precomputed or invented."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              loading={exporting === "csv"}
              disabled={exporting !== null || !report || report.total === 0}
              onClick={() => exportReport("csv")}
            >
              <Download aria-hidden className="size-3.5" /> CSV
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={exporting === "pdf"}
              disabled={exporting !== null || !report || report.total === 0}
              onClick={() => exportReport("pdf")}
            >
              <Download aria-hidden className="size-3.5" /> PDF
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Refresh report"
              onClick={() => setRefreshKey((key) => key + 1)}
            >
              <RefreshCw aria-hidden className="size-3.5" />
            </Button>
          </>
        }
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
      {invalidRange && (
        <Alert tone="warning" className="mb-4">
          The start date must be on or before the end date.
        </Alert>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as ReportType);
              setStatus("");
              setPage(1);
            }}
            aria-label="Report type"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
          >
            {REPORT_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <select
            value={courseId}
            onChange={(event) => {
              setCourseId(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by course"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
          >
            <option value="">All courses</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.code} · {course.name}
              </option>
            ))}
          </select>

          {type === "corrections" && (
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as CorrectionStatus | "");
                setPage(1);
              }}
              aria-label="Filter by request status"
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
            >
              <option value="">Any request status</option>
              {CORRECTION_STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}

          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPage(1);
              }}
              aria-label="From date"
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 shadow-sm"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                setPage(1);
              }}
              aria-label="To date"
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 shadow-sm"
            />
          </label>

          {(dateFrom || dateTo || courseId || status) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
                setCourseId("");
                setStatus("");
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        {!report ? (
          <div className="p-10 text-center">
            <Spinner label="Building report" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 text-xs text-slate-600">
              <span>
                <span className="font-semibold text-slate-900">{REPORT_TITLES[report.type]}</span>
                {" · "}
                {report.total} row(s)
                {typeof summary.records === "number" && summary.records !== report.total
                  ? ` covering ${summary.records} record(s)`
                  : ""}
                {showRate ? ` · attendance ${percent(summary.rate)}` : ""}
              </span>
              {loading && <Spinner label="Updating" />}
            </div>

            {report.total === 0 ? (
              <EmptyState
                icon={<Table2 aria-hidden className="size-5" />}
                title="No rows for these filters"
                description="Widen the date range or clear the filters. Only records in your scope are counted."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">{REPORT_TITLES[report.type]}</caption>
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      {report.columns.map((column) => (
                        <th
                          key={column.key}
                          scope="col"
                          className={cx("whitespace-nowrap px-4 py-2.5 font-medium", column.align === "right" && "text-right")}
                        >
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.rows.map((row, index) => (
                      <tr key={index} className="hover:bg-slate-50/60">
                        {report.columns.map((column) => (
                          <td
                            key={column.key}
                            className={cx(
                              "px-4 py-2.5 text-slate-700",
                              column.align === "right" && "whitespace-nowrap text-right tabular-nums",
                              column.key === "reason" && "min-w-64 whitespace-normal text-slate-600",
                            )}
                          >
                            {cellText(column, row[column.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
              <span>
                Page {report.page} of {lastPage} · {report.total} rows
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page >= lastPage}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <p className="mt-3 text-xs text-slate-500">
        Exports use the same filters and role scope as this table, are capped at 10,000 rows, and neutralise
        spreadsheet formulas in CSV cells.
      </p>
    </div>
  );
}
