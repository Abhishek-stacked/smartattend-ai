"""Liveness policy, recognition review and correction-request tests.

Synthetic frames and a scripted liveness detector keep the tests deterministic: no participant
images are used, and no liveness pass is ever fabricated by the application.
"""

import numpy as np
import pytest
from sqlalchemy import select

from ai_service.liveness import LivenessResult
from app.models import AttendanceRecord, AuditLog, CorrectionRequest, RecognitionEvent
from app.models.base import utcnow
from app.services import biometric_service
from tests.conftest import PASSWORD, csrf_headers, login
from tests.test_academics import create_faculty_record, create_student_record
from tests.test_biometric import (
    ScriptedAnalyzer,
    _face,
    _image,
    _orthogonal,
    _unit,
    active_session,
    consent,
    enroll,
    recognize,
)
from tests.test_sessions import build_course, create_session


class ScriptedLiveness:
    def __init__(self) -> None:
        self.available_flag = True
        self.script: list[list[LivenessResult]] = []
        self.calls = 0

    def available(self) -> bool:
        return self.available_flag

    def verify(self, image, boxes, threshold):
        self.calls += 1
        if self.script:
            return self.script.pop(0)
        return [LivenessResult("not_enabled", None) for _ in boxes]


@pytest.fixture
def ai(monkeypatch):
    analyzer = ScriptedAnalyzer()
    monkeypatch.setattr(biometric_service, "get_analyzer", lambda: analyzer)
    return analyzer


@pytest.fixture
def liveness(monkeypatch):
    detector = ScriptedLiveness()
    monkeypatch.setattr(biometric_service, "get_liveness_detector", lambda: detector)
    return detector


def set_policy(client, policy: str) -> None:
    response = client.patch("/api/settings", json={"liveness_policy": policy},
                            headers=csrf_headers(client))
    assert response.status_code == 200, response.text


def _enrolled_session(admin_client, db, *, code="CS301"):
    _, students, session = active_session(admin_client, db, code=code)
    student = students[0]
    assert consent(admin_client, student.id).status_code == 200
    return student, session


def _verify_frame(client):
    return client.post("/api/liveness/verify",
                       files={"frame": ("frame.jpg", _image(), "image/jpeg")},
                       headers=csrf_headers(client))


def test_liveness_verify_reports_each_face_or_not_enabled(admin_client, db, ai, liveness):
    ai.set([[_face(None), _face(None)]])
    liveness.script = [[LivenessResult("passed", 0.9312), LivenessResult("failed", 0.1201)]]
    response = _verify_frame(admin_client)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["available"] is True
    assert body["threshold"] == pytest.approx(0.80)
    assert body["model"] == "MiniFASNetV2"
    assert [f["status"] for f in body["faces"]] == ["passed", "failed"]
    assert body["faces"][1]["score"] == pytest.approx(0.1201)
    assert "did not pass" in body["faces"][1]["message"]
    assert db.scalars(select(RecognitionEvent)).all() == []

    liveness.available_flag = False
    ai.set([[_face(None)]])
    missing = _verify_frame(admin_client).json()
    assert missing["available"] is False
    assert missing["faces"][0]["status"] == "not_enabled"
    assert missing["message"]


def test_flag_policy_records_failed_liveness_and_queues_review(admin_client, db, ai, liveness):
    set_policy(admin_client, "flag")
    student, session = _enrolled_session(admin_client, db)
    assert session["liveness_policy"] == "flag"
    embedding = _unit(31)
    ai.set([[_face(embedding)] for _ in range(3)])
    assert enroll(admin_client, student.id).status_code == 200

    liveness.script = [[LivenessResult("failed", 0.15)]]
    ai.set([[_face(embedding)]])
    result = recognize(admin_client, session["id"]).json()["results"][0]
    assert result["outcome"] == "recognized"
    assert result["attendance"]["committed"] is True
    assert result["liveness"] == {"status": "failed", "score": 0.15}
    assert "flagged" in result["message"]

    event = db.scalars(select(RecognitionEvent)).one()
    assert event.review_status == "pending"
    assert event.liveness_status == "failed"
    assert event.error_code == "liveness_failed"
    assert event.matched_student_id == student.id

    queue = admin_client.get("/api/recognition/events", params={"status": "pending"}).json()
    assert queue["total"] == 1
    assert queue["items"][0]["liveness_status"] == "failed"

    resolved = admin_client.post(f"/api/recognition/events/{event.id}/resolve",
                                 json={"action": "dismiss", "note": "Student verified in person"},
                                 headers=csrf_headers(admin_client))
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["review_status"] == "dismissed"
    db.refresh(event)
    assert event.review_status == "dismissed"
    assert db.scalars(select(AuditLog).where(AuditLog.action == "recognition.resolve")).one()

    again = admin_client.post(f"/api/recognition/events/{event.id}/resolve",
                              json={"action": "dismiss", "note": "Duplicate attempt"},
                              headers=csrf_headers(admin_client))
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "already_reviewed"


def test_enforce_policy_never_marks_failed_liveness(admin_client, db, ai, liveness):
    set_policy(admin_client, "enforce")
    student, session = _enrolled_session(admin_client, db)
    assert session["liveness_policy"] == "enforce"
    embedding = _unit(32)
    ai.set([[_face(embedding)] for _ in range(3)])
    assert enroll(admin_client, student.id).status_code == 200

    liveness.script = [[LivenessResult("inconclusive", None)]]
    ai.set([[_face(embedding)]])
    result = recognize(admin_client, session["id"]).json()["results"][0]
    assert result["outcome"] == "liveness_failed"
    assert result["attendance"] is None
    assert db.scalars(select(AttendanceRecord)).all() == []

    event = db.scalars(select(RecognitionEvent)).one()
    assert event.review_status == "pending"
    assert event.outcome == "liveness_failed"

    approved = admin_client.post(f"/api/recognition/events/{event.id}/resolve",
                                 json={"action": "mark_present", "note": "Identity checked at the door"},
                                 headers=csrf_headers(admin_client))
    assert approved.status_code == 200, approved.text
    assert approved.json()["record_status"] == "present"
    record = db.scalars(select(AttendanceRecord)).one()
    assert record.student_id == student.id
    assert record.source == "manual"
    assert record.recognition_event_id == event.id
    db.refresh(event)
    assert event.review_status == "resolved"
    assert event.review_note == "Identity checked at the door"


def test_enforce_without_model_reports_unavailable(admin_client, db, ai, liveness):
    set_policy(admin_client, "enforce")
    student, session = _enrolled_session(admin_client, db)
    embedding = _unit(33)
    ai.set([[_face(embedding)] for _ in range(3)])
    assert enroll(admin_client, student.id).status_code == 200

    liveness.available_flag = False
    ai.set([[_face(embedding)]])
    result = recognize(admin_client, session["id"]).json()["results"][0]
    assert result["outcome"] == "error"
    assert result["liveness"]["status"] == "not_enabled"
    assert "Liveness is enforced" in result["message"]
    assert db.scalars(select(AttendanceRecord)).all() == []
    event = db.scalars(select(RecognitionEvent)).one()
    assert event.error_code == "liveness_unavailable"
    assert event.review_status == "not_required"


def test_flag_without_model_records_but_reports_unavailable(admin_client, db, ai, liveness):
    set_policy(admin_client, "flag")
    student, session = _enrolled_session(admin_client, db)
    embedding = _unit(34)
    ai.set([[_face(embedding)] for _ in range(3)])
    assert enroll(admin_client, student.id).status_code == 200

    liveness.available_flag = False
    ai.set([[_face(embedding)]])
    result = recognize(admin_client, session["id"]).json()["results"][0]
    assert result["outcome"] == "recognized"
    assert result["attendance"]["committed"] is True
    assert result["liveness"]["status"] == "not_enabled"
    assert "liveness unavailable" in result["message"]
    event = db.scalars(select(RecognitionEvent)).one()
    assert event.review_status == "not_required"
    assert event.liveness_status == "not_enabled"


def test_uncertain_identity_can_be_marked_only_by_review(admin_client, db, ai):
    student, session = _enrolled_session(admin_client, db)
    base = _unit(35)
    ai.set([[_face(base)] for _ in range(3)])
    assert enroll(admin_client, student.id).status_code == 200

    near = 0.39 * base + np.sqrt(1 - 0.39**2) * _orthogonal(base, 36)
    ai.set([[_face(near.astype(np.float32))]])
    result = recognize(admin_client, session["id"]).json()["results"][0]
    assert result["outcome"] == "low_confidence"
    assert result["attendance"] is None
    event = db.scalars(select(RecognitionEvent)).one()
    assert event.matched_student_id == student.id
    assert event.review_status == "pending"

    resolved = admin_client.post(f"/api/recognition/events/{event.id}/resolve",
                                 json={"action": "mark_late", "note": "Seen at the back of the room"},
                                 headers=csrf_headers(admin_client))
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["record_status"] == "late"
    record = db.scalars(select(AttendanceRecord)).one()
    assert record.status == "late"
    assert record.source == "manual"


def test_review_queue_is_scoped_for_faculty(admin_client, db, admin_user):
    faculty_a, course_a, _ = build_course(admin_client, db, faculty_login=True, code="CS401")
    session_a = create_session(admin_client, course_a["id"]).json()
    faculty_b = create_faculty_record(db, employee_id="FAC-B", email="prof.b@example.edu")
    course_b = admin_client.post("/api/courses", json={
        "code": "CS402", "name": "Networks", "department": "Computer Science",
        "term": "2026-27 Odd", "faculty_id": faculty_b.id,
    }, headers=csrf_headers(admin_client)).json()
    session_b = create_session(admin_client, course_b["id"], title="Lecture B").json()

    for session in (session_a, session_b):
        db.add(RecognitionEvent(session_id=session["id"], occurred_at=utcnow(), outcome="low_confidence",
                                liveness_status="not_required", review_status="pending"))
    db.commit()

    login(admin_client, faculty_a.email)
    own = admin_client.get("/api/recognition/events", params={"status": "pending"}).json()
    assert own["total"] == 1
    assert own["items"][0]["session_id"] == session_a["id"]
    foreign = db.scalars(select(RecognitionEvent).where(
        RecognitionEvent.session_id == session_b["id"])).one()
    denied = admin_client.post(f"/api/recognition/events/{foreign.id}/resolve",
                               json={"action": "dismiss", "note": "Not my course"},
                               headers=csrf_headers(admin_client))
    assert denied.status_code == 404

    login(admin_client, admin_user.email)
    all_events = admin_client.get("/api/recognition/events", params={"status": "pending"}).json()
    assert all_events["total"] == 2


def _closed_session(admin_client, db, *, student_login=True):
    _, course, students = build_course(admin_client, db, student_login=student_login)
    session = create_session(admin_client, course["id"]).json()
    assert admin_client.post(f"/api/sessions/{session['id']}/start",
                             headers=csrf_headers(admin_client)).status_code == 200
    assert admin_client.post(f"/api/sessions/{session['id']}/close",
                             headers=csrf_headers(admin_client)).status_code == 200
    assert admin_client.post(f"/api/sessions/{session['id']}/finalize",
                             headers=csrf_headers(admin_client)).status_code == 200
    return students[0], session


def test_student_correction_is_reviewed_and_applied_atomically(admin_client, db, admin_user):
    student, session = _closed_session(admin_client, db)
    login(admin_client, student.email)

    mine = admin_client.get("/api/sessions/mine").json()
    assert len(mine) == 1
    assert mine[0]["record_status"] == "absent"

    created = admin_client.post("/api/corrections", json={
        "session_id": session["id"], "requested_status": "present",
        "reason": "I attended but the roll call missed me",
    }, headers=csrf_headers(admin_client))
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["request_type"] == "correction"
    assert body["current_status"] == "absent"
    assert body["status"] == "pending"
    request_id = body["id"]

    duplicate = admin_client.post("/api/corrections", json={
        "session_id": session["id"], "requested_status": "late", "reason": "Second attempt",
    }, headers=csrf_headers(admin_client))
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "request_pending"

    assert admin_client.post(f"/api/corrections/{request_id}/approve", json={"note": "x" * 5},
                             headers=csrf_headers(admin_client)).status_code == 403

    login(admin_client, admin_user.email)
    queue = admin_client.get("/api/corrections", params={"status": "pending"}).json()
    assert queue["total"] == 1

    approved = admin_client.post(f"/api/corrections/{request_id}/approve",
                                 json={"note": "Verified against the seating plan"},
                                 headers=csrf_headers(admin_client))
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert approved.json()["current_status"] == "present"
    record = db.scalars(select(AttendanceRecord).where(
        AttendanceRecord.session_id == session["id"], AttendanceRecord.student_id == student.id)).one()
    assert record.status == "present"
    assert record.correction_reason == "Verified against the seating plan"
    actions = {log.action for log in db.scalars(select(AuditLog)).all()}
    assert {"correction.approve", "attendance.update"} <= actions


def test_manual_attendance_request_and_withdrawal(admin_client, db, admin_user):
    _, course, students = build_course(admin_client, db, student_login=True)
    student = students[0]
    session = create_session(admin_client, course["id"]).json()
    assert admin_client.post(f"/api/sessions/{session['id']}/start",
                             headers=csrf_headers(admin_client)).status_code == 200

    login(admin_client, student.email)
    created = admin_client.post("/api/corrections", json={
        "session_id": session["id"], "requested_status": "late",
        "reason": "Arrived late and the camera station was closed",
    }, headers=csrf_headers(admin_client))
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["request_type"] == "manual_attendance"
    assert body["current_status"] is None
    request_id = body["id"]

    withdrawn = admin_client.post(f"/api/corrections/{request_id}/withdraw",
                                  json={"reason": "Found my record"},
                                  headers=csrf_headers(admin_client))
    assert withdrawn.status_code == 200
    assert withdrawn.json()["status"] == "withdrawn"
    assert db.scalars(select(CorrectionRequest)).one().status == "withdrawn"
    assert db.scalars(select(AttendanceRecord)).all() == []

    recreated = admin_client.post("/api/corrections", json={
        "session_id": session["id"], "requested_status": "present",
        "reason": "Please check the camera log",
    }, headers=csrf_headers(admin_client))
    assert recreated.status_code == 201

    login(admin_client, admin_user.email)
    approved = admin_client.post(f"/api/corrections/{recreated.json()['id']}/approve",
                                 json={"note": "Camera log confirms the arrival"},
                                 headers=csrf_headers(admin_client))
    assert approved.status_code == 200, approved.text
    record = db.scalars(select(AttendanceRecord)).one()
    assert record.status == "present"
    assert record.source == "manual"
    assert record.marked_by_user_id is not None


def test_student_cannot_request_or_read_another_students_session(admin_client, db):
    other_course_student = create_student_record(db, "CS21-099", "other.course@example.edu", with_login=True)
    _, course, students = build_course(admin_client, db, student_login=True)
    student = students[0]
    session = create_session(admin_client, course["id"]).json()
    admin_client.post(f"/api/sessions/{session['id']}/start", headers=csrf_headers(admin_client))

    login(admin_client, other_course_student.email)
    mine = admin_client.get("/api/sessions/mine").json()
    assert mine == []
    denied = admin_client.post("/api/corrections", json={
        "session_id": session["id"], "requested_status": "present",
        "reason": "Not on this roster",
    }, headers=csrf_headers(admin_client))
    assert denied.status_code == 404

    login(admin_client, student.email)
    created = admin_client.post("/api/corrections", json={
        "session_id": session["id"], "requested_status": "present",
        "reason": "Present in class today",
    }, headers=csrf_headers(admin_client)).json()

    login(admin_client, other_course_student.email)
    assert admin_client.get(f"/api/corrections/{created['id']}").status_code == 404
    assert admin_client.get("/api/corrections").json()["total"] == 0


def test_rejected_correction_leaves_the_record_unchanged(admin_client, db, admin_user):
    _, course, students = build_course(admin_client, db, student_login=True)
    student = students[0]
    session = create_session(admin_client, course["id"]).json()
    assert admin_client.post(f"/api/sessions/{session['id']}/start",
                             headers=csrf_headers(admin_client)).status_code == 200
    marked = admin_client.post(f"/api/sessions/{session['id']}/attendance",
                               json={"student_id": student.id, "status": "present", "reason": "Roll call"},
                               headers=csrf_headers(admin_client))
    assert marked.status_code == 201, marked.text

    login(admin_client, student.email)
    created = admin_client.post("/api/corrections", json={
        "session_id": session["id"], "requested_status": "late",
        "reason": "The camera station recorded the wrong time",
    }, headers=csrf_headers(admin_client))
    assert created.status_code == 201, created.text
    assert created.json()["request_type"] == "correction"
    assert created.json()["current_status"] == "present"

    login(admin_client, admin_user.email, PASSWORD)
    rejected = admin_client.post(f"/api/corrections/{created.json()['id']}/reject",
                                 json={"note": "The session log matches the camera event"},
                                 headers=csrf_headers(admin_client))
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["status"] == "rejected"
    assert rejected.json()["reviewer_note"] == "The session log matches the camera event"
    assert rejected.json()["current_status"] == "present"

    record = db.scalars(select(AttendanceRecord).where(AttendanceRecord.session_id == session["id"])).one()
    assert record.status == "present"
    assert record.correction_reason is None
    actions = {row.action for row in db.scalars(select(AuditLog)).all()}
    assert "correction.reject" in actions
    assert "attendance.update" not in actions

    assert admin_client.get("/api/corrections", params={"status": "pending"}).json()["total"] == 0
    rejected_queue = admin_client.get("/api/corrections", params={"status": "rejected"}).json()
    assert rejected_queue["total"] == 1
    second = admin_client.post(f"/api/corrections/{created.json()['id']}/reject",
                               json={"note": "Again"}, headers=csrf_headers(admin_client))
    assert second.status_code == 409
