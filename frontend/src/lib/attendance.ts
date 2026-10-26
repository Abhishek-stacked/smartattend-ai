import type { AttendanceStatus, SessionCounts, SessionStatus } from "./types";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const SESSION_TONES: Record<SessionStatus, Tone> = {
  scheduled: "info",
  active: "success",
  paused: "warning",
  closed: "neutral",
  finalized: "brand",
  cancelled: "danger",
};

const ATTENDANCE_TONES: Record<AttendanceStatus, Tone> = {
  present: "success",
  late: "warning",
  absent: "danger",
  pending_review: "warning",
  excused: "info",
};

const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  pending_review: "Pending review",
  excused: "Excused",
};

export function sessionTone(status: SessionStatus): Tone {
  return SESSION_TONES[status] ?? "neutral";
}

export function attendanceTone(status: AttendanceStatus): Tone {
  return ATTENDANCE_TONES[status] ?? "neutral";
}

export function attendanceLabel(status: AttendanceStatus | null): string {
  if (!status) return "Not marked";
  return ATTENDANCE_LABELS[status] ?? status;
}

export function sessionLabel(status: SessionStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function attendanceRate(counts: SessionCounts): number {
  const marked = counts.present + counts.late + counts.absent + counts.pending_review + counts.excused;
  if (marked === 0) return 0;
  return ((counts.present + counts.late) / marked) * 100;
}
