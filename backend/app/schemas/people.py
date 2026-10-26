from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models.people import FACULTY_STATUSES, STUDENT_STATUSES
from app.schemas.common import ORMModel


def _upper(value: str) -> str:
    return " ".join(value.strip().upper().split())


class StudentIn(BaseModel):
    registration_number: str = Field(min_length=2, max_length=32)
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    department: str = Field(min_length=2, max_length=80)
    program: str = Field(min_length=2, max_length=80)
    enrollment_year: int = Field(ge=1990, le=2100)

    @field_validator("registration_number")
    @classmethod
    def _reg(cls, v: str) -> str:
        return _upper(v)

    @field_validator("full_name", "department", "program")
    @classmethod
    def _strip(cls, v: str) -> str:
        return " ".join(v.split())


class StudentUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: EmailStr | None = None
    department: str | None = Field(default=None, min_length=2, max_length=80)
    program: str | None = Field(default=None, min_length=2, max_length=80)
    enrollment_year: int | None = Field(default=None, ge=1990, le=2100)
    status: str | None = None

    @field_validator("status")
    @classmethod
    def _status(cls, v: str | None) -> str | None:
        if v is not None and v not in STUDENT_STATUSES:
            raise ValueError("invalid status")
        return v


class ReasonIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class StudentCourse(BaseModel):
    course_id: int
    code: str
    name: str
    term: str
    status: str


class StudentOut(ORMModel):
    id: int
    user_id: int | None
    registration_number: str
    full_name: str
    email: str
    department: str
    program: str
    enrollment_year: int
    status: str
    deactivated_at: datetime | None
    created_at: datetime
    updated_at: datetime


class StudentDetail(StudentOut):
    has_account: bool
    enrollments: list[StudentCourse]
    biometric_consented: bool
    template_count: int


class FacultyIn(BaseModel):
    employee_id: str = Field(min_length=2, max_length=32)
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    department: str = Field(min_length=2, max_length=80)
    designation: str = Field(default="Lecturer", min_length=2, max_length=80)

    @field_validator("employee_id")
    @classmethod
    def _emp(cls, v: str) -> str:
        return _upper(v)


class FacultyUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: EmailStr | None = None
    department: str | None = Field(default=None, min_length=2, max_length=80)
    designation: str | None = Field(default=None, min_length=2, max_length=80)
    status: str | None = None

    @field_validator("status")
    @classmethod
    def _status(cls, v: str | None) -> str | None:
        if v is not None and v not in FACULTY_STATUSES:
            raise ValueError("invalid status")
        return v


class FacultyCourse(BaseModel):
    course_id: int
    code: str
    name: str
    term: str
    status: str
    student_count: int


class FacultyOut(ORMModel):
    id: int
    user_id: int | None
    employee_id: str
    full_name: str
    email: str
    department: str
    designation: str
    status: str
    created_at: datetime
    updated_at: datetime


class FacultyDetail(FacultyOut):
    has_account: bool
    courses: list[FacultyCourse]
