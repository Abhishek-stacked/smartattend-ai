export type Role = "admin" | "faculty" | "student";

export interface Me {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  student_id: number | null;
  faculty_id: number | null;
  last_login_at: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface AdminUser {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  locked: boolean;
  last_login_at: string | null;
  created_at: string;
  student_id: number | null;
  faculty_id: number | null;
}

export interface ResetLink {
  reset_url: string;
  expires_at: string;
  note: string;
}

export interface ClientSettings {
  liveness_policy: "off" | "flag" | "enforce";
  frame_interval_ms: number;
  min_face_px: number;
  default_late_after_min: number;
  default_window_min: number;
  faculty_can_correct: boolean;
  timezone: string;
}

export interface Student {
  id: number;
  user_id: number | null;
  registration_number: string;
  full_name: string;
  email: string;
  department: string;
  program: string;
  enrollment_year: number;
  status: "active" | "inactive" | "graduated" | "suspended";
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudentCourse {
  course_id: number;
  code: string;
  name: string;
  term: string;
  status: "active" | "dropped";
}

export interface StudentDetail extends Student {
  has_account: boolean;
  enrollments: StudentCourse[];
  biometric_consented: boolean;
  template_count: number;
}

export interface Faculty {
  id: number;
  user_id: number | null;
  employee_id: string;
  full_name: string;
  email: string;
  department: string;
  designation: string;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

export interface FacultyCourse {
  course_id: number;
  code: string;
  name: string;
  term: string;
  status: string;
  student_count: number;
}

export interface FacultyDetail extends Faculty {
  has_account: boolean;
  courses: FacultyCourse[];
}

export interface Course {
  id: number;
  code: string;
  name: string;
  department: string;
  term: string;
  faculty_id: number | null;
  faculty_name: string | null;
  status: "active" | "archived";
  student_count: number;
  created_at: string;
}

export interface RosterStudent {
  student_id: number;
  registration_number: string;
  full_name: string;
  email: string;
  department: string;
  status: string;
  enrolled_at: string;
  biometric_enrolled: boolean;
}

export type SessionStatus = "scheduled" | "active" | "paused" | "closed" | "finalized" | "cancelled";

export interface SessionCounts {
  participants: number;
  present: number;
  late: number;
  absent: number;
  pending_review: number;
  excused: number;
  unmarked: number;
}

export interface AttendanceSession {
  id: number;
  course_id: number;
  course_code: string;
  course_name: string;
  faculty_id: number;
  faculty_name: string;
  title: string;
  session_date: string;
  scheduled_start: string;
  scheduled_end: string;
  late_after: string;
  attendance_closes_at: string;
  status: SessionStatus;
  liveness_policy: "off" | "flag" | "enforce";
  self_marking_enabled: boolean;
  started_at: string | null;
  closed_at: string | null;
  finalized_at: string | null;
  created_at: string;
  counts: SessionCounts;
}

export type AttendanceStatus = "present" | "late" | "absent" | "pending_review" | "excused";
export type AttendanceSource = "automated" | "manual" | "system" | "self_reported";

export interface RosterEntry {
  student_id: number;
  registration_number: string;
  full_name: string;
  status: AttendanceStatus | null;
  source: AttendanceSource | null;
  marked_at: string | null;
  biometric_enrolled: boolean;
  self_marking_locked: boolean;
  self_marking_lock_reason: string | null;
}

export interface AttendanceRecord {
  id: number;
  session_id: number;
  course_id: number;
  course_code: string;
  course_name: string;
  session_title: string;
  session_date: string;
  session_status: SessionStatus;
  student_id: number;
  registration_number: string;
  student_name: string;
  status: AttendanceStatus;
  source: AttendanceSource;
  marked_at: string;
  correction_reason: string | null;
  corrected_at: string | null;
  reviewer_id: number | null;
}

export interface RecognitionEventSummary {
  id: number;
  occurred_at: string;
  outcome: string;
  similarity: number | null;
  second_similarity: number | null;
  threshold_used: number | null;
  liveness_status: string;
  liveness_score: number | null;
  model_name: string | null;
  model_version: string | null;
  processing_ms: number | null;
  review_status: string;
}

export interface AttendanceHistoryEntry {
  id: number;
  occurred_at: string;
  action: string;
  actor_name: string | null;
  actor_role: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
}

export interface AttendanceDetail extends AttendanceRecord {
  event: RecognitionEventSummary | null;
  history: AttendanceHistoryEntry[];
}

export interface PolicySection {
  heading: string;
  body: string;
}

export interface BiometricPolicy {
  policy_version: string;
  title: string;
  sections: PolicySection[];
  retention_days: number;
}

export interface ConsentRecord {
  status: "granted" | "withdrawn";
  policy_version: string;
  capture_method: string;
  granted_at: string | null;
  withdrawn_at: string | null;
}

export interface EnrollmentStatus {
  student_id: number;
  consent: ConsentRecord | null;
  template_count: number;
  model: string;
  model_version: string;
  enrolled_at: string | null;
}

export interface FaceQuality {
  ok: boolean;
  issues: string[];
  blur: number;
  brightness: number;
  face_px: number;
}

export interface DetectedFace {
  box: [number, number, number, number];
  score: number;
  quality: FaceQuality;
}

export interface DetectResponse {
  faces: DetectedFace[];
  width: number;
  height: number;
  processing_ms: number;
}

export type RecognitionOutcome =
  | "recognized"
  | "unknown"
  | "low_confidence"
  | "poor_quality"
  | "multiple_faces"
  | "not_eligible"
  | "liveness_failed"
  | "duplicate"
  | "error";

export interface FaceResult {
  box: number[];
  outcome: RecognitionOutcome;
  student: { id: number; full_name: string; registration_number: string } | null;
  similarity: number | null;
  threshold_used: number | null;
  liveness: { status: string; score: number | null };
  attendance: { committed: boolean; record_id: number | null; status: string | null } | null;
  event_id: number | null;
  message: string;
  cooldown: boolean;
}

export interface RecognizeResponse {
  results: FaceResult[];
  processing_ms: number;
  message?: string | null;
}

export interface EnrollResponse {
  student_id: number;
  template_count: number;
  model: string;
  model_version: string;
  enrolled_at: string;
}

export type ReviewStatus = "not_required" | "pending" | "resolved" | "dismissed";

export type LivenessStatus =
  | "not_required"
  | "not_enabled"
  | "passed"
  | "failed"
  | "inconclusive"
  | "error";

export interface ReviewEvent {
  id: number;
  occurred_at: string;
  outcome: RecognitionOutcome;
  review_status: ReviewStatus;
  session_id: number | null;
  session_title: string | null;
  course_id: number | null;
  course_code: string | null;
  course_name: string | null;
  student_id: number | null;
  student_name: string | null;
  registration_number: string | null;
  similarity: number | null;
  second_similarity: number | null;
  threshold_used: number | null;
  liveness_status: LivenessStatus;
  liveness_score: number | null;
  liveness_model: string | null;
  quality: Record<string, unknown> | null;
  error_code: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface ResolveEventResponse {
  event_id: number;
  review_status: ReviewStatus;
  record_id: number | null;
  record_status: AttendanceStatus | null;
}

export interface StudentSession {
  id: number;
  course_id: number;
  course_code: string;
  course_name: string;
  title: string;
  session_date: string;
  scheduled_start: string;
  scheduled_end: string;
  status: SessionStatus;
  record_status: AttendanceStatus | null;
  has_pending_request: boolean;
  self_marking_open: boolean;
  self_marking_message: string | null;
  self_marking_closes_at: string | null;
}

export interface SelfMarkResult {
  session_id: number;
  student_id: number;
  status: AttendanceStatus;
  source: AttendanceSource;
  marked_at: string;
  already_marked: boolean;
}

export type CorrectionStatus = "pending" | "approved" | "rejected" | "withdrawn";
export type CorrectionType = "correction" | "manual_attendance";

export interface CorrectionRequest {
  id: number;
  student_id: number;
  student_name: string;
  registration_number: string;
  session_id: number;
  course_code: string;
  course_name: string;
  session_title: string;
  session_date: string;
  session_status: SessionStatus;
  attendance_record_id: number | null;
  current_status: AttendanceStatus | null;
  request_type: CorrectionType;
  requested_status: "present" | "late" | "excused";
  reason: string;
  status: CorrectionStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewer_note: string | null;
}


export interface ReportSummary {
  scope: Role;
  date_from: string | null;
  date_to: string | null;
  courses: number;
  sessions: number;
  participants: number;
  records: number;
  present: number;
  late: number;
  absent: number;
  pending_review: number;
  excused: number;
  unmarked: number;
  attendance_rate: number;
  pending_reviews: number;
  pending_corrections: number;
  active_sessions: number;
  generated_at: string;
}

export interface MeSummary extends ReportSummary {
  student_id: number;
  registration_number: string;
}

export type TrendGranularity = "day" | "week" | "month";

export interface TrendPoint {
  bucket: string;
  label: string;
  present: number;
  late: number;
  absent: number;
  excused: number;
  pending_review: number;
  total: number;
  rate: number;
}

export interface CourseComparison {
  course_id: number;
  code: string;
  name: string;
  present: number;
  late: number;
  absent: number;
  excused: number;
  pending_review: number;
  total: number;
  rate: number;
}

export interface Trends {
  granularity: TrendGranularity;
  date_from: string | null;
  date_to: string | null;
  series: TrendPoint[];
  distribution: Record<AttendanceStatus, number>;
  courses: CourseComparison[];
}

export interface ActivityEvent {
  id: number;
  occurred_at: string;
  outcome: RecognitionOutcome;
  course_code: string | null;
  session_title: string | null;
  student_name: string | null;
  liveness_status: LivenessStatus;
  review_status: ReviewStatus;
}

export interface ActivitySession {
  id: number;
  title: string;
  course_code: string;
  session_date: string;
  status: SessionStatus;
  counts: SessionCounts;
}

export interface Activity {
  events: ActivityEvent[];
  sessions: ActivitySession[];
  pending_reviews: number;
  pending_corrections: number;
}

export type ReportType =
  | "daily"
  | "weekly"
  | "monthly"
  | "course"
  | "student"
  | "faculty"
  | "late"
  | "absence"
  | "exceptions"
  | "corrections";

export interface ReportColumn {
  key: string;
  label: string;
  align: "left" | "right";
}

export interface ReportTable {
  type: ReportType;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  total: number;
  page: number;
  page_size: number;
  date_from: string | null;
  date_to: string | null;
  summary: Record<string, number>;
}
