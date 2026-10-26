from datetime import date, datetime

from pydantic import BaseModel, Field


class RecognitionEventOut(BaseModel):
    id: int
    occurred_at: datetime
    outcome: str
    review_status: str
    session_id: int | None
    session_title: str | None
    course_id: int | None
    course_code: str | None
    course_name: str | None
    student_id: int | None
    student_name: str | None
    registration_number: str | None
    similarity: float | None
    second_similarity: float | None
    threshold_used: float | None
    liveness_status: str
    liveness_score: float | None
    liveness_model: str | None
    quality: dict | None
    error_code: str | None
    reviewed_at: datetime | None
    review_note: str | None


class ResolveEventIn(BaseModel):
    action: str = Field(pattern="^(mark_present|mark_late|dismiss)$")
    note: str = Field(min_length=5, max_length=500)


class ResolveEventOut(BaseModel):
    event_id: int
    review_status: str
    record_id: int | None = None
    record_status: str | None = None


class CorrectionRequestIn(BaseModel):
    session_id: int
    requested_status: str = Field(pattern="^(present|late|excused)$")
    reason: str = Field(min_length=5, max_length=500)


class CorrectionActionIn(BaseModel):
    note: str = Field(min_length=5, max_length=500)


class CorrectionWithdrawIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class CorrectionOut(BaseModel):
    id: int
    student_id: int
    student_name: str
    registration_number: str
    session_id: int
    course_code: str
    course_name: str
    session_title: str
    session_date: date
    session_status: str
    attendance_record_id: int | None
    current_status: str | None
    request_type: str
    requested_status: str
    reason: str
    status: str
    created_at: datetime
    reviewed_at: datetime | None
    reviewer_note: str | None
