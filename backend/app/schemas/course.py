from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.models.course import COURSE_STATUSES


class CourseIn(BaseModel):
    code: str = Field(min_length=2, max_length=20)
    name: str = Field(min_length=2, max_length=120)
    department: str = Field(min_length=2, max_length=80)
    term: str = Field(min_length=2, max_length=20)
    faculty_id: int | None = None

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        return " ".join(v.strip().upper().split())


class CourseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    department: str | None = Field(default=None, min_length=2, max_length=80)
    term: str | None = Field(default=None, min_length=2, max_length=20)
    faculty_id: int | None = None
    status: str | None = None

    @field_validator("status")
    @classmethod
    def _status(cls, v: str | None) -> str | None:
        if v is not None and v not in COURSE_STATUSES:
            raise ValueError("invalid status")
        return v


class CourseOut(BaseModel):
    id: int
    code: str
    name: str
    department: str
    term: str
    faculty_id: int | None
    faculty_name: str | None
    status: str
    student_count: int
    created_at: datetime


class EnrollmentIn(BaseModel):
    student_ids: list[int] = Field(min_length=1, max_length=500)


class RosterStudent(BaseModel):
    student_id: int
    registration_number: str
    full_name: str
    email: str
    department: str
    status: str
    enrolled_at: datetime
    biometric_enrolled: bool


class EnrollmentResult(BaseModel):
    added: int
    already_enrolled: int
    skipped_inactive: int
    items: list[RosterStudent]
