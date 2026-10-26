from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator


class SessionIn(BaseModel):
    course_id: int
    title: str = Field(min_length=2, max_length=120)
    scheduled_start: datetime
    scheduled_end: datetime
    late_after_min: int | None = Field(default=None, ge=0, le=240)
    window_min: int | None = Field(default=None, ge=1, le=480)

    @field_validator("scheduled_start", "scheduled_end")
    @classmethod
    def _aware(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("timestamps must include a timezone")
        return v


class SessionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=120)
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    late_after_min: int | None = Field(default=None, ge=0, le=240)
    window_min: int | None = Field(default=None, ge=1, le=480)

    @field_validator("scheduled_start", "scheduled_end")
    @classmethod
    def _aware(cls, v: datetime | None) -> datetime | None:
        if v is not None and v.tzinfo is None:
            raise ValueError("timestamps must include a timezone")
        return v


class TransitionIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class ReopenIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class SessionCounts(BaseModel):
    participants: int
    present: int
    late: int
    absent: int
    pending_review: int
    excused: int
    unmarked: int


class SessionOut(BaseModel):
    id: int
    course_id: int
    course_code: str
    course_name: str
    faculty_id: int
    faculty_name: str
    title: str
    session_date: date
    scheduled_start: datetime
    scheduled_end: datetime
    late_after: datetime
    attendance_closes_at: datetime
    status: str
    liveness_policy: str
    self_marking_enabled: bool = False
    started_at: datetime | None
    closed_at: datetime | None
    finalized_at: datetime | None
    created_at: datetime
    counts: SessionCounts


class RosterEntry(BaseModel):
    student_id: int
    registration_number: str
    full_name: str
    status: str | None
    source: str | None
    marked_at: datetime | None
    biometric_enrolled: bool
    self_marking_locked: bool = False
    self_marking_lock_reason: str | None = None


class SelfMarkingLockIn(BaseModel):
    locked: bool
    reason: str | None = Field(default=None, max_length=500)


class SelfMarkingSettingIn(BaseModel):
    enabled: bool


class SelfMarkOut(BaseModel):
    session_id: int
    student_id: int
    status: str
    source: str
    marked_at: datetime
    already_marked: bool = False


class AttendanceOut(BaseModel):
    id: int
    session_id: int
    course_id: int
    course_code: str
    course_name: str
    session_title: str
    session_date: date
    session_status: str
    student_id: int
    registration_number: str
    student_name: str
    status: str
    source: str
    marked_at: datetime
    correction_reason: str | None
    corrected_at: datetime | None
    reviewer_id: int | None


class AttendanceDetail(AttendanceOut):
    event: dict | None = None
    history: list[dict] = []


class AttendanceUpdate(BaseModel):
    status: str = Field(pattern="^(present|late|absent|excused)$")
    reason: str = Field(min_length=3, max_length=500)


class ManualMarkIn(BaseModel):
    student_id: int
    status: str = Field(pattern="^(present|late|excused)$")
    reason: str = Field(min_length=3, max_length=500)


class SessionStats(BaseModel):
    session_id: int
    counts: SessionCounts


class StudentSessionOut(BaseModel):
    id: int
    course_id: int
    course_code: str
    course_name: str
    title: str
    session_date: date
    scheduled_start: datetime
    scheduled_end: datetime
    status: str
    record_status: str | None = None
    has_pending_request: bool = False
    self_marking_open: bool = False
    self_marking_message: str | None = None
    self_marking_closes_at: datetime | None = None
