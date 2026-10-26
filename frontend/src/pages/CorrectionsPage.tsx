import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ClipboardPen, FilePenLine, Inbox } from "lucide-react";
import { api, ApiError, query } from "../lib/api";
import { formatDate, formatDateTime } from "../lib/format";
import { attendanceLabel, attendanceTone, sessionLabel } from "../lib/attendance";
import type {
  CorrectionRequest,
  CorrectionStatus,
  Page,
  StudentSession,
} from "../lib/types";
import { useAuth } from "../context/AuthContext";
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

const STATUS_LABELS: Record<CorrectionStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const STATUS_TONES: Record<CorrectionStatus, "warning" | "success" | "danger" | "neutral"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  withdrawn: "neutral",
};

const TYPE_LABELS = {
  correction: "Correct record",
  manual_attendance: "Missing record",
};

export function CorrectionsPage() {
  const { user } = useAuth();
  const isStudent = user?.role === "student";

  const [status, setStatus] = useState<"" | CorrectionStatus>(isStudent ? "" : "pending");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<CorrectionRequest> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const [creating, setCreating] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [requestedStatus, setRequestedStatus] = useState<"present" | "late" | "excused">("present");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [selected, setSelected] = useState<CorrectionRequest | null>(null);
  const [mode, setMode] = useState<"approve" | "reject" | "withdraw">("approve");
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (isStudent) setStatus("");
  }, [isStudent]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api<Page<CorrectionRequest>>(
      `/corrections${query({ status, page, page_size: PAGE_SIZE })}`,
      { signal: controller.signal },
    )
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Unable to load correction requests.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [status, page, refreshKey]);

  const loadSessions = useCallback(async () => {
    if (!isStudent) return;
    try {
      setSessions(await api<StudentSession[]>("/sessions/mine"));
    } catch {
      setSessions([]);
    }
  }, [isStudent]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions, refreshKey]);

  const reload = useCallback(() => setRefreshKey((key) => key + 1), []);

  const openCreate = () => {
    setCreating(true);
    setSessionId("");
    setRequestedStatus("present");
    setReason("");
    setFormError(null);
  };

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api<CorrectionRequest>("/corrections", {
        method: "POST",
        body: { session_id: Number(sessionId), requested_status: requestedStatus, reason: reason.trim() },
      });
      setCreating(false);
      setNotice("Request sent. Your official record stays unchanged until a staff member reviews it.");
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Unable to send the request.");
    } finally {
      setBusy(false);
    }
  };

  const openAction = (request: CorrectionRequest, nextMode: "approve" | "reject" | "withdraw") => {
    setSelected(request);
    setMode(nextMode);
    setNote("");
    setActionError(null);
  };

  const submitAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    try {
      const path =
        mode === "withdraw"
          ? `/corrections/${selected.id}/withdraw`
          : `/corrections/${selected.id}/${mode}`;
      const body = mode === "withdraw" ? { reason: note.trim() || null } : { note: note.trim() };
      await api<CorrectionRequest>(path, { method: "POST", body });
      setNotice(
        mode === "approve"
          ? `Request approved. The record was set to ${attendanceLabel(selected.requested_status).toLowerCase()}.`
          : mode === "reject"
            ? "Request rejected. The record was not changed."
            : "Request withdrawn.",
      );
      setSelected(null);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Unable to complete the action.");
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectableSessions = sessions.filter(
    (s) => !s.has_pending_request && (s.status === "active" || s.status === "closed" || s.status === "finalized"),
  );

  return (
    <div>
      <PageHeader
        title="Correction requests"
        description={
          isStudent
            ? "Raise a correction when a record is wrong. The official record changes only after staff approval."
            : "Student disputes for your courses. Approving applies the change and its audit entry together."
        }
        actions={
          isStudent ? (
            <Button onClick={openCreate}>
              <ClipboardPen aria-hidden className="size-4" /> New request
            </Button>
          ) : undefined
        }
      />

      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as "" | CorrectionStatus);
              setPage(1);
            }}
            aria-label="Filter by request status"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="">Any status</option>
          </select>
          <span className="ml-auto text-sm text-slate-500">{total} requests</span>
        </div>

        {loading && !data ? (
          <div className="p-10 text-center">
            <Spinner label="Loading correction requests" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={isStudent ? <FilePenLine aria-hidden className="size-5" /> : <Inbox aria-hidden className="size-5" />}
            title={isStudent ? "No correction requests" : "No requests for these filters"}
            description={
              isStudent
                ? "If a record is missing or wrong, raise a request and your faculty will review it."
                : "Student requests appear here for review. Records stay unchanged until you approve one."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <caption className="sr-only">Attendance correction requests</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Date</th>
                  {!isStudent && <th scope="col" className="px-4 py-3 font-medium">Student</th>}
                  <th scope="col" className="px-4 py-3 font-medium">Course / session</th>
                  <th scope="col" className="px-4 py-3 font-medium">Change</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((request) => (
                  <tr key={request.id} className="align-top hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatDate(request.session_date)}
                      <p className="text-xs text-slate-400">{formatDateTime(request.created_at)}</p>
                    </td>
                    {!isStudent && (
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{request.student_name}</p>
                        <p className="text-xs text-slate-500">{request.registration_number}</p>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{request.course_code}</p>
                      <p className="text-xs text-slate-500">{request.session_title}</p>
                      <p className="text-xs text-slate-400">Session {sessionLabel(request.session_status).toLowerCase()}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-slate-500">{TYPE_LABELS[request.request_type]}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {request.current_status ? (
                          <Badge tone={attendanceTone(request.current_status)}>
                            {attendanceLabel(request.current_status)}
                          </Badge>
                        ) : (
                          <Badge tone="neutral">Not marked</Badge>
                        )}
                        <span className="text-slate-400">→</span>
                        <Badge tone={attendanceTone(request.requested_status)}>
                          {attendanceLabel(request.requested_status)}
                        </Badge>
                      </div>
                      <p className="mt-1 max-w-64 text-xs text-slate-500">{request.reason}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONES[request.status]}>{STATUS_LABELS[request.status]}</Badge>
                      {request.reviewer_note && (
                        <p className="mt-1 max-w-52 text-xs text-slate-500">{request.reviewer_note}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {request.status === "pending" &&
                        (isStudent ? (
                          <Button size="sm" variant="secondary" onClick={() => openAction(request, "withdraw")}>
                            Withdraw
                          </Button>
                        ) : (
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" onClick={() => openAction(request, "approve")}>
                              Approve
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => openAction(request, "reject")}>
                              Reject
                            </Button>
                          </div>
                        ))}
                      {request.status !== "pending" && request.reviewed_at && (
                        <span className="text-xs text-slate-400">{formatDateTime(request.reviewed_at)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
          <span>
            Page {page} of {lastPage} · {total} requests
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
        open={creating}
        onClose={() => setCreating(false)}
        title="New correction request"
        description="Your official record stays unchanged until a staff member reviews this request."
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" form="new-correction" loading={busy}>
              Send request
            </Button>
          </>
        }
      >
        <form id="new-correction" onSubmit={submitCreate} className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}
          {selectableSessions.length === 0 ? (
            <Alert tone="info">
              No sessions are available. Requests can be raised once you are on a session roster and the session has
              started.
            </Alert>
          ) : (
            <>
              <Select
                label="Session"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                required
                hint="Only sessions you are enrolled in, without another pending request."
              >
                <option value="">Choose a session…</option>
                {selectableSessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {formatDate(session.session_date)} · {session.course_code} · {session.title} ·{" "}
                    {attendanceLabel(session.record_status)}
                  </option>
                ))}
              </Select>
              <Select
                label="Requested status"
                value={requestedStatus}
                onChange={(e) => setRequestedStatus(e.target.value as "present" | "late" | "excused")}
              >
                <option value="present">Present</option>
                <option value="late">Late</option>
                <option value="excused">Excused</option>
              </Select>
              <Textarea
                label="What happened?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                minLength={5}
                hint="Shared with the reviewer and kept with the request."
              />
            </>
          )}
        </form>
      </Modal>

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={
          mode === "approve" ? "Approve correction" : mode === "reject" ? "Reject correction" : "Withdraw request"
        }
        description={
          selected
            ? `${selected.course_code} · ${selected.session_title} · ${attendanceLabel(selected.current_status)} → ${attendanceLabel(selected.requested_status)}`
            : undefined
        }
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="correction-action"
              variant={mode === "reject" ? "danger" : "primary"}
              loading={busy}
            >
              {mode === "approve" ? "Approve and apply" : mode === "reject" ? "Reject request" : "Withdraw request"}
            </Button>
          </>
        }
      >
        {selected && (
          <form id="correction-action" onSubmit={submitAction} className="space-y-4">
            {actionError && <Alert tone="error">{actionError}</Alert>}
            {mode === "approve" && (
              <Alert tone="warning" title="This changes the official record">
                The record will be set to {attendanceLabel(selected.requested_status).toLowerCase()} and the change
                will be attributed to your account in the audit log.
              </Alert>
            )}
            {mode === "withdraw" ? (
              <Textarea
                label="Reason (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                hint="Kept with the withdrawn request."
              />
            ) : (
              <Textarea
                label="Review note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required
                minLength={5}
                hint="Required and kept in the audit log."
              />
            )}
          </form>
        )}
      </Modal>
    </div>
  );
}
