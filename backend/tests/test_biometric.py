"""Enrolment, detection and recognition tests.

A scripted analyzer replaces the real models: no participant images are used or stored, and the
tests exercise the backend rules (consent, quality gates, duplicates, thresholds, cooldown,
transactions) deterministically. Real-model behaviour is covered by ai_service/evaluation.
"""

from datetime import timedelta

import numpy as np
import pytest
from sqlalchemy import select

from ai_service import DetectedFace, FaceBox, FrameAnalysis, QualityReport
from app.cli import main as cli_main
from app.core.crypto import EncryptedTemplate, get_cipher
from app.models import AttendanceRecord, AuditLog, BiometricConsent, BiometricTemplate, RecognitionEvent, Student
from app.models.base import utcnow
from app.services import biometric_service
from app.services.biometric_policy import POLICY_VERSION
from tests.conftest import csrf_headers, login
from tests.test_academics import create_faculty_record, create_student_record
from tests.test_sessions import build_course, create_session

IMAGE = None


def _image() -> bytes:
    global IMAGE
    if IMAGE is None:
        import cv2

        ok, buffer = cv2.imencode(".jpg", np.zeros((48, 48, 3), dtype=np.uint8))
        assert ok
        IMAGE = buffer.tobytes()
    return IMAGE


def _unit(seed: int) -> np.ndarray:
    vector = np.random.default_rng(seed).normal(size=128).astype(np.float32)
    return vector / np.linalg.norm(vector)


def _orthogonal(base: np.ndarray, seed: int) -> np.ndarray:
    candidate = np.random.default_rng(seed).normal(size=128).astype(np.float32)
    candidate -= base * float(np.dot(base, candidate))
    return candidate / np.linalg.norm(candidate)


def _face(embedding: np.ndarray | None, *, ok: bool = True, issues: tuple[str, ...] = ()) -> DetectedFace:
    return DetectedFace(
        box=FaceBox(20, 20, 120, 120),
        detector_score=0.97,
        quality=QualityReport(ok, issues, 120.0 if ok else 12.0, 130.0, 120),
        embedding=embedding,
    )


class ScriptedAnalyzer:
    def __init__(self) -> None:
        self.script: list[tuple[DetectedFace, ...]] = []

    def set(self, frames: list[list[DetectedFace]]) -> None:
        self.script = [tuple(faces) for faces in frames]

    def analyze(self, image, policy, *, embed=True) -> FrameAnalysis:
        faces = self.script.pop(0) if self.script else ()
        return FrameAnalysis(faces, image.shape[1], image.shape[0], 7)


@pytest.fixture
def ai(monkeypatch):
    analyzer = ScriptedAnalyzer()
    monkeypatch.setattr(biometric_service, "get_analyzer", lambda: analyzer)
    return analyzer


def consent(client, student_id: int, *, version: str = POLICY_VERSION, confirmed: bool = True):
    return client.post(f"/api/enrollment/{student_id}/consent",
                       json={"policy_version": version, "participant_confirmed": confirmed},
                       headers=csrf_headers(client))


def enroll(client, student_id: int, count: int = 3, *, replace: bool = False):
    files = [("samples", (f"sample-{i}.jpg", _image(), "image/jpeg")) for i in range(count)]
    return client.post(f"/api/enrollment/{student_id}", files=files,
                       data={"replace": "true" if replace else "false"},
                       headers=csrf_headers(client))


def recognize(client, session_id: int, *, content_type: str = "image/jpeg", payload: bytes | None = None):
    return client.post("/api/recognition/recognize",
                       files={"frame": ("frame.jpg", payload if payload is not None else _image(), content_type)},
                       data={"session_id": str(session_id)}, headers=csrf_headers(client))


def active_session(admin_client, db, *, code="CS301"):
    _, course, students = build_course(admin_client, db, code=code)
    session = create_session(admin_client, course["id"]).json()
    started = admin_client.post(f"/api/sessions/{session['id']}/start", headers=csrf_headers(admin_client))
    assert started.status_code == 200, started.text
    return course, students, session


def test_consent_is_required_and_versioned(admin_client, db, ai):
    student = create_student_record(db)

    without = enroll(admin_client, student.id)
    assert without.status_code == 409
    assert without.json()["error"]["code"] == "consent_required"

    refusals = consent(admin_client, student.id, confirmed=False)
    assert refusals.status_code == 422
    assert refusals.json()["error"]["code"] == "consent_required"

    stale = consent(admin_client, student.id, version="0.9")
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "policy_version_mismatch"
    assert stale.json()["error"]["details"]["current_version"] == POLICY_VERSION

    granted = consent(admin_client, student.id)
    assert granted.status_code == 200
    assert granted.json()["status"] == "granted"
    assert granted.json()["capture_method"] == "staff_assisted"

    again = consent(admin_client, student.id)
    assert again.status_code == 200
    assert again.json()["granted_at"] == granted.json()["granted_at"]


def test_enrollment_encrypts_templates_and_hides_them(admin_client, db, ai):
    student = create_student_record(db)
    assert consent(admin_client, student.id).status_code == 200
    embedding = _unit(1)
    ai.set([[_face(embedding)] for _ in range(3)])

    response = enroll(admin_client, student.id)
    assert response.status_code == 200, response.text
    assert response.json()["template_count"] == 3

    rows = db.scalars(select(BiometricTemplate).where(BiometricTemplate.student_id == student.id)).all()
    assert len(rows) == 3
    cipher = get_cipher()
    for row in rows:
        assert row.ciphertext != embedding.tobytes()
        plain = cipher.decrypt(row.student_id, row.model_name, row.model_version,
                               EncryptedTemplate(row.key_id, row.nonce, row.ciphertext))
        assert np.allclose(plain, embedding, atol=1e-6)

    status = admin_client.get(f"/api/enrollment/{student.id}").json()
    assert status["template_count"] == 3
    assert status["consent"]["status"] == "granted"
    assert "embedding" not in str(status)

    audits = db.scalars(select(AuditLog).where(AuditLog.action == "biometric.enroll")).all()
    assert len(audits) == 1
    assert "embedding" not in str(audits[0].after)
    assert "ciphertext" not in str(audits[0].after)


def test_enrollment_quality_gates_and_consistency(admin_client, db, ai):
    student = create_student_record(db)
    assert consent(admin_client, student.id).status_code == 200

    ai.set([[], [], []])
    no_face = enroll(admin_client, student.id)
    assert no_face.status_code == 422
    assert no_face.json()["error"]["code"] == "no_face"

    two = _face(_unit(2))
    ai.set([[two, _face(_unit(3))]] * 3)
    multiple = enroll(admin_client, student.id)
    assert multiple.status_code == 422
    assert multiple.json()["error"]["code"] == "multiple_faces"

    blurred = _face(None, ok=False, issues=("blurry",))
    ai.set([[_face(_unit(4))], [blurred], [_face(_unit(4))]])
    poor = enroll(admin_client, student.id)
    assert poor.status_code == 422
    assert poor.json()["error"]["code"] == "blurry"
    assert poor.json()["error"]["details"]["sample"] == 2

    ai.set([[_face(_unit(5))], [_face(_unit(6))], [_face(_unit(7))]])
    inconsistent = enroll(admin_client, student.id)
    assert inconsistent.status_code == 422
    assert inconsistent.json()["error"]["code"] == "inconsistent_samples"

    assert db.scalars(select(BiometricTemplate)).all() == []


def test_duplicate_identity_is_rejected(admin_client, db, ai):
    _, _, students = build_course(admin_client, db)
    first, second = students
    shared = _unit(8)
    for student in (first, second):
        assert consent(admin_client, student.id).status_code == 200

    ai.set([[_face(shared)] for _ in range(3)])
    assert enroll(admin_client, first.id).status_code == 200

    ai.set([[_face(shared)] for _ in range(3)])
    duplicate = enroll(admin_client, second.id)
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "possible_duplicate_identity"
    assert duplicate.json()["error"]["details"]["matched_student_id"] == first.id


def test_detect_returns_quality_without_storing(admin_client, db, ai):
    ai.set([[_face(None), _face(None)]])
    response = admin_client.post("/api/recognition/detect",
                                 files={"frame": ("frame.jpg", _image(), "image/jpeg")},
                                 headers=csrf_headers(admin_client))
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["faces"]) == 2
    assert body["faces"][0]["quality"]["ok"] is True
    assert set(body["faces"][0]) == {"box", "score", "quality"}
    assert body["processing_ms"] >= 0
    assert db.scalars(select(RecognitionEvent)).all() == []


def test_recognize_marks_once_and_handles_unknown(admin_client, db, ai):
    _, students, session = active_session(admin_client, db)
    first, second = students
    for student in (first, second):
        assert consent(admin_client, student.id).status_code == 200
    first_embedding, second_embedding = _unit(11), _unit(12)

    ai.set([[_face(first_embedding)] for _ in range(3)])
    assert enroll(admin_client, first.id).status_code == 200
    ai.set([[_face(second_embedding)] for _ in range(3)])
    assert enroll(admin_client, second.id).status_code == 200

    ai.set([[_face(first_embedding)]])
    first_hit = recognize(admin_client, session["id"])
    assert first_hit.status_code == 200, first_hit.text
    result = first_hit.json()["results"][0]
    assert result["outcome"] == "recognized"
    assert result["student"]["id"] == first.id
    assert result["attendance"]["committed"] is True
    assert result["attendance"]["status"] == "present"
    assert result["similarity"] == pytest.approx(1.0, abs=1e-5)

    ai.set([[_face(first_embedding)]])
    again = recognize(admin_client, session["id"]).json()["results"][0]
    assert again["outcome"] == "duplicate"
    assert again["cooldown"] is True
    assert again["attendance"]["committed"] is False

    ai.set([[_face(_unit(99))]])
    unknown = recognize(admin_client, session["id"]).json()["results"][0]
    assert unknown["outcome"] == "unknown"
    assert unknown["attendance"] is None

    records = db.scalars(select(AttendanceRecord).where(AttendanceRecord.session_id == session["id"])).all()
    assert len(records) == 1
    assert records[0].source == "automated"
    assert records[0].recognition_event_id is not None

    events = db.scalars(select(RecognitionEvent).where(RecognitionEvent.session_id == session["id"])).all()
    outcomes = [e.outcome for e in events]
    assert outcomes.count("recognized") == 1
    assert outcomes.count("unknown") == 1


def test_uncertain_matches_are_queued_not_marked(admin_client, db, ai):
    _, students, session = active_session(admin_client, db)
    first = students[0]
    assert consent(admin_client, first.id).status_code == 200
    base = _unit(13)
    ai.set([[_face(base)] for _ in range(3)])
    assert enroll(admin_client, first.id).status_code == 200

    near = 0.39 * base + np.sqrt(1 - 0.39**2) * _orthogonal(base, 14)
    ai.set([[_face(near.astype(np.float32))]])
    low = recognize(admin_client, session["id"]).json()["results"][0]
    assert low["outcome"] == "low_confidence"
    assert low["student"] is None
    assert low["attendance"] is None

    assert db.scalars(select(AttendanceRecord)).all() == []
    event = db.scalars(select(RecognitionEvent)).one()
    assert event.outcome == "low_confidence"
    assert event.review_status == "pending"
    assert event.threshold_used == pytest.approx(0.42)


def test_recognition_requires_active_owned_session(admin_client, db, ai):
    _, course, students = build_course(admin_client, db, faculty_login=True)
    session = create_session(admin_client, course["id"]).json()

    ai.set([[ _face(_unit(15)) ]])
    scheduled = recognize(admin_client, session["id"])
    assert scheduled.status_code == 409
    assert scheduled.json()["error"]["code"] == "session_not_active"

    faculty = create_faculty_record(db, employee_id="FAC-OTHER", email="other@example.edu", with_login=True)
    other_course = admin_client.post("/api/courses", json={"code": "CS999", "name": "Other",
                                                           "department": "Computer Science",
                                                           "term": "2026-27 Odd", "faculty_id": faculty.id},
                                     headers=csrf_headers(admin_client)).json()
    foreign = create_session(admin_client, other_course["id"], start="2030-01-01T09:00:00Z",
                             end="2030-01-01T10:00:00Z").json()
    admin_client.post(f"/api/sessions/{foreign['id']}/start", headers=csrf_headers(admin_client))

    login(admin_client, faculty.email)
    assert recognize(admin_client, session["id"]).status_code == 404


def test_student_can_withdraw_and_delete_own_templates(admin_client, db, ai):
    _, _, students = build_course(admin_client, db, student_login=True)
    student = students[0]
    assert consent(admin_client, student.id).status_code == 200
    ai.set([[_face(_unit(16))] for _ in range(3)])
    assert enroll(admin_client, student.id).status_code == 200

    login(admin_client, student.email)
    status = admin_client.get(f"/api/enrollment/{student.id}")
    assert status.status_code == 200
    assert status.json()["template_count"] == 3

    removed = admin_client.post(f"/api/biometrics/{student.id}/delete",
                                json={"withdraw_consent": True, "reason": "Prefer manual roll call"},
                                headers=csrf_headers(admin_client))
    assert removed.status_code == 200, removed.text
    assert removed.json() == {"deleted_templates": 3, "consent_withdrawn": True}

    after = admin_client.get(f"/api/enrollment/{student.id}").json()
    assert after["template_count"] == 0
    assert after["consent"]["status"] == "withdrawn"
    assert db.scalars(select(BiometricTemplate)).all() == []


def test_student_enrols_own_face_but_not_another_student(admin_client, db, ai):
    first = create_student_record(db, reg="CS21-101", email="self.enrol@example.edu", with_login=True)
    second = create_student_record(db, reg="CS21-102", email="other.enrol@example.edu", with_login=True)
    login(admin_client, first.email)

    ai.set([[_face(None)]])
    detected = admin_client.post("/api/recognition/detect",
                                 files={"frame": ("frame.jpg", _image(), "image/jpeg")},
                                 headers=csrf_headers(admin_client))
    assert detected.status_code == 200, detected.text
    assert len(detected.json()["faces"]) == 1

    assert admin_client.get(f"/api/enrollment/{second.id}").status_code == 403
    assert consent(admin_client, second.id).status_code == 403
    assert enroll(admin_client, second.id).status_code == 403

    granted = consent(admin_client, first.id)
    assert granted.status_code == 200, granted.text
    assert granted.json()["capture_method"] == "self_service"

    ai.set([[_face(_unit(71))] for _ in range(3)])
    saved = enroll(admin_client, first.id)
    assert saved.status_code == 200, saved.text
    assert saved.json()["template_count"] == 3

    status = admin_client.get(f"/api/enrollment/{first.id}").json()
    assert status["template_count"] == 3
    assert status["consent"]["capture_method"] == "self_service"

    audit = db.scalars(select(AuditLog).where(AuditLog.action == "biometric.enroll")).one()
    assert audit.actor_user_id == first.user_id
    assert audit.actor_role == "student"


def test_upload_and_image_validation(admin_client, db, ai):
    _, _, session = active_session(admin_client, db)

    wrong_type = admin_client.post("/api/recognition/recognize",
                                   files={"frame": ("frame.txt", b"hello", "text/plain")},
                                   data={"session_id": str(session["id"])},
                                   headers=csrf_headers(admin_client))
    assert wrong_type.status_code == 415

    garbage = recognize(admin_client, session["id"], payload=b"not-an-image")
    assert garbage.status_code == 422
    assert garbage.json()["error"]["code"] == "invalid_image"

    from app.core.config import get_settings

    oversized = recognize(admin_client, session["id"], payload=b"0" * (get_settings().max_upload_bytes + 1))
    assert oversized.status_code == 413
    assert oversized.json()["error"]["code"] == "file_too_large"


def test_policy_is_versioned_and_readable_by_students(admin_client, db):
    student = create_student_record(db, with_login=True)
    login(admin_client, student.email)
    policy = admin_client.get("/api/privacy/policy")
    assert policy.status_code == 200
    body = policy.json()
    assert body["policy_version"] == POLICY_VERSION
    assert len(body["sections"]) >= 5
    assert body["retention_days"] >= 0


def test_inactive_student_is_flagged_not_eligible(admin_client, db, ai):
    _, students, session = active_session(admin_client, db)
    student = students[0]
    assert consent(admin_client, student.id).status_code == 200
    embedding = _unit(51)
    ai.set([[_face(embedding)] for _ in range(3)])
    assert enroll(admin_client, student.id).status_code == 200

    db.get(Student, student.id).status = "inactive"
    db.commit()

    ai.set([[_face(embedding)]])
    result = recognize(admin_client, session["id"]).json()["results"][0]
    assert result["outcome"] == "not_eligible"
    assert result["attendance"] is None
    assert "not eligible" in result["message"].lower()
    assert db.scalars(select(AttendanceRecord)).all() == []

    event = db.scalars(select(RecognitionEvent).where(RecognitionEvent.session_id == session["id"])).one()
    assert event.outcome == "not_eligible"
    assert event.matched_student_id == student.id
    assert event.liveness_status == "not_required"


def test_retention_purge_deletes_expired_templates(admin_client, db, ai):
    student = create_student_record(db)
    assert consent(admin_client, student.id).status_code == 200
    ai.set([[_face(_unit(61))] for _ in range(3)])
    assert enroll(admin_client, student.id).status_code == 200

    row = db.get(Student, student.id)
    row.status = "inactive"
    row.deactivated_at = utcnow() - timedelta(days=31)
    db.commit()

    assert cli_main(["purge-biometrics", "--dry-run"]) == 0
    assert len(db.scalars(select(BiometricTemplate).where(BiometricTemplate.student_id == student.id)).all()) == 3
    assert cli_main(["purge-biometrics"]) == 2
    assert len(db.scalars(select(BiometricTemplate).where(BiometricTemplate.student_id == student.id)).all()) == 3

    assert cli_main(["purge-biometrics", "--yes"]) == 0
    assert db.scalars(select(BiometricTemplate).where(BiometricTemplate.student_id == student.id)).all() == []
    consents = db.scalars(select(BiometricConsent).where(BiometricConsent.student_id == student.id)).all()
    assert [row.status for row in consents] == ["withdrawn"]
    audit = db.scalars(select(AuditLog).where(AuditLog.action == "biometric.delete")).all()
    assert audit and audit[-1].reason.startswith("retention purge")
