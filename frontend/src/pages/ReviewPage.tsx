import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Flag, ShieldAlert } from "lucide-react";
import { api, ApiError, query } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type {
  AttendanceStatus,
  LivenessStatus,
  Page,
  ResolveEventResponse,
  ReviewEvent,
  ReviewStatus,
} from "../lib/types";
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

const PAGE_SIZE = 20;

const OUTCOME_LABELS: Record<string, string> = {
  recognized: "Recognised",
  unknown: "No match",
  low_confidence: "Uncertain match",
  poor_quality: "Quality rejected",
  no_face: "No face",
  multiple_faces: "Multiple faces",
  liveness_failed: "Liveness failed",
  duplicate: "Already recorded",
  not_eligible: "Not eligible",
  error: "System error",
};

const OUTCOME_TONES: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  recognized: "success",
  unknown: "warning",
  low_confidence: "warning",
  poor_quality: "neutral",
  no_face: "neutral",
  multiple_faces: "warning",
  liveness_failed: "danger",
  duplicate: "info",
  not_eligible: "danger",
  error: "danger",
};

const LIVENESS_LABELS: Record<LivenessStatus, string> = {
  not_required: "Not required",
  not_enabled: "Model off",
  passed: "Passed",
  failed: "Failed",
  inconclusive: "Inconclusive",
  error: "Error",
};

const LIVENESS_TONES: Record<LivenessStatus, "success" | "warning" | "danger" | "neutral"> = {
  not_required: "neutral",
  not_enabled: "warning",
  passed: "success",
  failed: "danger",
  inconclusive: "warning",
  error: "danger",
};

const REVIEW_LABELS: Record<ReviewStatus, string> = {
  not_required: "Not required",
  pending: "Pending",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

const ACTIONS: Array<{ value: string; label: string; status: AttendanceStatus | null }> = [
  { value: "mark_present", label: "Mark present", status: "present" },
  { value: "mark_late", label: "Mark late", status: "late" },
  { value: "dismiss", label: "Dismiss (no attendance change)", status: null },
];

export function ReviewPage() {
  const [status, setStatus] = useState<ReviewStatus | "">("pending");
  const [outcome, setOutcome] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<ReviewEvent> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [selected, setSelected] = useState<ReviewEvent | null>(null);
  const [action, setAction] = useState("mark_present");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api<Page<ReviewEvent>>(
      `/recognition/events${query({ status, outcome, page, page_size: PAGE_SIZE })}`,
      { signal: controller.signal },
    )
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Unable to load the review queue.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [status, outcome, page, refreshKey]);

  const reload = useCallback(() => setRefreshKey((key) => key + 1), []);

  const openResolve = (event: ReviewEvent) => {
    setSelected(event);
    setAction(event.student_id === null ? "dismiss" : "mark_present");
    setNote("");
    setActionError(null);
  };

  const resolve = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await api<ResolveEventResponse>(`/recognition/events/${selected.id}/resolve`, {
        method: "POST",
        body: { action, note: note.trim() },
      });
      const label = ACTIONS.find((item) => item.value === action)?.label ?? "Resolved";
      setNotice(
        result.record_status
          ? `${label}: ${selected.course_code ?? "session"} marked ${result.record_status}.`
          : `${label}: event closed with no attendance change.`,
      );
      setSelected(null);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Unable to resolve the event.");
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Recognition review"
        description="Uncertain matches and failed liveness checks. A staff member decides; nothing is marked on a guess."
      />

      <Alert tone="info" className="mb-4" title="No images are stored">
        Frames are analysed in memory. Confirm the person's identity in front of you before marking attendance from
        an uncertain event.
      </Alert>

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
              setStatus(e.target.value as ReviewStatus | "");
              setPage(1);
            }}
            aria-label="Filter by review status"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
          >
            <option value="pending">Pending review</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
            <option value="">Any review status</option>
          </select>
          <select
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by outcome"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
          >
            <option value="">Any outcome</option>
            <option value="low_confidence">Uncertain match</option>
            <option value="liveness_failed">Liveness failed</option>
            <option value="multiple_faces">Multiple faces</option>
            <option value="recognized">Recognised</option>
          </select>
          <span className="ml-auto text-sm text-slate-500">{total} events</span>
        </div>

        {loading && !data ? (
          <div className="p-10 text-center">
            <Spinner label="Loading review queue" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Flag aria-hidden className="size-5" />}
            title={status === "pending" ? "Nothing waiting for review" : "No events for these filters"}
            description="Uncertain identities and failed liveness checks appear here until a staff member resolves them."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <caption className="sr-only">Recognition events awaiting review</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">When</th>
                  <th scope="col" className="px-4 py-3 font-medium">Session</th>
                  <th scope="col" className="px-4 py-3 font-medium">Outcome</th>
                  <th scope="col" className="px-4 py-3 font-medium">Candidate</th>
                  <th scope="col" className="px-4 py-3 font-medium">Scores</th>
                  <th scope="col" className="px-4 py-3 font-medium">Review</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((event) => (
                  <tr key={event.id} className="align-top hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatDateTime(event.occurred_at)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{event.course_code ?? "—"}</p>
                      <p className="text-xs text-slate-500">{event.session_title ?? "Session removed"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <Badge tone={OUTCOME_TONES[event.outcome] ?? "neutral"}>
                          {OUTCOME_LABELS[event.outcome] ?? event.outcome}
                        </Badge>
                        <Badge tone={LIVENESS_TONES[event.liveness_status]}>
                          Liveness: {LIVENESS_LABELS[event.liveness_status]}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {event.student_name ? (
                        <>
                          <p className="font-medium text-slate-900">{event.student_name}</p>
                          <p className="text-xs text-slate-500">{event.registration_number}</p>
                        </>
                      ) : (
                        <span className="text-slate-400">No candidate</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <p>
                        Similarity{" "}
                        {event.similarity !== null ? event.similarity.toFixed(3) : "—"}
                        {event.threshold_used !== null && ` / ${event.threshold_used.toFixed(2)}`}
                      </p>
                      {event.second_similarity !== null && <p>Runner-up {event.second_similarity.toFixed(3)}</p>}
                      {event.liveness_score !== null && <p>Liveness score {event.liveness_score.toFixed(3)}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        tone={
                          event.review_status === "pending"
                            ? "warning"
                            : event.review_status === "resolved"
                              ? "success"
                              : "neutral"
                        }
                      >
                        {REVIEW_LABELS[event.review_status]}
                      </Badge>
                      {event.review_note && <p className="mt-1 max-w-52 text-xs text-slate-500">{event.review_note}</p>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {event.review_status === "pending" ? (
                        <Button size="sm" variant="secondary" onClick={() => openResolve(event)}>
                          Resolve
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400">
                          {event.reviewed_at ? formatDateTime(event.reviewed_at) : "—"}
                        </span>
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
            Page {page} of {lastPage} · {total} events
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
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="Resolve recognition event"
        description={
          selected
            ? `${selected.course_code ?? "Session"} · ${selected.session_title ?? ""} · ${OUTCOME_LABELS[selected.outcome] ?? selected.outcome}`
            : undefined
        }
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Cancel
            </Button>
            <Button type="submit" form="resolve-event" loading={busy}>
              Save decision
            </Button>
          </>
        }
      >
        {selected && (
          <form id="resolve-event" onSubmit={resolve} className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              <p className="flex items-start gap-2">
                <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <span>
                  Only a confident visual identification should become attendance. The camera did not store a photo,
                  so verify the person in front of you or check another source.
                </span>
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-slate-500">Candidate</dt>
                  <dd className="text-slate-800">
                    {selected.student_name ?? "None recorded"}
                    {selected.registration_number ? ` · ${selected.registration_number}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Liveness</dt>
                  <dd className="text-slate-800">
                    {LIVENESS_LABELS[selected.liveness_status]}
                    {selected.liveness_score !== null ? ` (${selected.liveness_score.toFixed(3)})` : ""}
                  </dd>
                </div>
              </dl>
            </div>

            {actionError && <Alert tone="error">{actionError}</Alert>}

            <Select label="Decision" value={action} onChange={(e) => setAction(e.target.value)}>
              {ACTIONS.map((item) => (
                <option key={item.value} value={item.value} disabled={item.status !== null && !selected.student_id}>
                  {item.label}
                  {item.status !== null && !selected.student_id ? " — no candidate" : ""}
                </option>
              ))}
            </Select>
            {!selected.student_id && (
              <p className="text-xs text-slate-500">
                No candidate identity was recorded for this event. Use manual attendance on the session roster.
              </p>
            )}
            <Textarea
              label="Review note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required
              minLength={5}
              hint="Required and kept in the audit log with your account."
              placeholder="What did you check before deciding?"
            />
          </form>
        )}
      </Modal>
    </div>
  );
}
