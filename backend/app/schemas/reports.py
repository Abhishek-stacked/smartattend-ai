from datetime import date, datetime
from typing import Any

from pydantic import BaseModel


class SummaryOut(BaseModel):
    scope: str
    date_from: date | None
    date_to: date | None
    courses: int
    sessions: int
    participants: int
    records: int
    present: int
    late: int
    absent: int
    pending_review: int
    excused: int
    unmarked: int
    attendance_rate: float
    pending_reviews: int
    pending_corrections: int
    active_sessions: int
    generated_at: datetime


class MeSummaryOut(SummaryOut):
    student_id: int
    registration_number: str


class TrendPoint(BaseModel):
    bucket: str
    label: str
    present: int
    late: int
    absent: int
    excused: int
    pending_review: int
    total: int
    rate: float


class CourseComparison(BaseModel):
    course_id: int
    code: str
    name: str
    present: int
    late: int
    absent: int
    excused: int
    pending_review: int
    total: int
    rate: float


class TrendsOut(BaseModel):
    granularity: str
    date_from: date | None
    date_to: date | None
    series: list[TrendPoint]
    distribution: dict[str, int]
    courses: list[CourseComparison]


class ActivityEventOut(BaseModel):
    id: int
    occurred_at: datetime
    outcome: str
    course_code: str | None
    session_title: str | None
    student_name: str | None
    liveness_status: str
    review_status: str


class ActivitySessionOut(BaseModel):
    id: int
    title: str
    course_code: str
    session_date: date
    status: str
    counts: dict[str, int]


class ActivityOut(BaseModel):
    events: list[ActivityEventOut]
    sessions: list[ActivitySessionOut]
    pending_reviews: int
    pending_corrections: int


class ReportColumn(BaseModel):
    key: str
    label: str
    align: str = "left"


class ReportOut(BaseModel):
    type: str
    columns: list[ReportColumn]
    rows: list[dict[str, Any]]
    total: int
    page: int
    page_size: int
    date_from: date | None
    date_to: date | None
    summary: dict[str, Any] = {}
