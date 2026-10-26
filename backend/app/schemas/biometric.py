from datetime import datetime

from pydantic import BaseModel, Field


class PolicySectionOut(BaseModel):
    heading: str
    body: str


class PolicyOut(BaseModel):
    policy_version: str
    title: str
    sections: list[PolicySectionOut]
    retention_days: int


class ConsentIn(BaseModel):
    policy_version: str = Field(min_length=1, max_length=20)
    participant_confirmed: bool


class ConsentOut(BaseModel):
    status: str
    policy_version: str
    capture_method: str
    granted_at: datetime | None = None
    withdrawn_at: datetime | None = None


class EnrollmentStatusOut(BaseModel):
    student_id: int
    consent: ConsentOut | None = None
    template_count: int
    model: str
    model_version: str
    enrolled_at: datetime | None = None


class EnrollOut(BaseModel):
    student_id: int
    template_count: int
    model: str
    model_version: str
    enrolled_at: datetime


class DeleteTemplatesIn(BaseModel):
    withdraw_consent: bool = False
    reason: str = Field(min_length=3, max_length=500)


class QualityOut(BaseModel):
    ok: bool
    issues: list[str]
    blur: float
    brightness: float
    face_px: int


class DetectFaceOut(BaseModel):
    box: list[int]
    score: float
    quality: QualityOut


class DetectOut(BaseModel):
    faces: list[DetectFaceOut]
    width: int
    height: int
    processing_ms: int


class LivenessOut(BaseModel):
    status: str
    score: float | None = None


class LivenessFaceOut(BaseModel):
    box: list[int]
    status: str
    score: float | None = None
    message: str


class LivenessVerifyOut(BaseModel):
    faces: list[LivenessFaceOut]
    available: bool
    threshold: float
    model: str
    model_version: str
    processing_ms: int
    message: str | None = None


class StudentSummaryOut(BaseModel):
    id: int
    full_name: str
    registration_number: str


class AttendanceCommitOut(BaseModel):
    committed: bool
    record_id: int | None = None
    status: str | None = None


class FaceResultOut(BaseModel):
    box: list[int]
    outcome: str
    student: StudentSummaryOut | None = None
    similarity: float | None = None
    threshold_used: float | None = None
    liveness: LivenessOut
    attendance: AttendanceCommitOut | None = None
    event_id: int | None = None
    message: str
    cooldown: bool = False


class RecognizeOut(BaseModel):
    results: list[FaceResultOut]
    processing_ms: int
    message: str | None = None
