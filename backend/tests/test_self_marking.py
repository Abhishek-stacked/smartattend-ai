from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models import AttendanceRecord, AuditLog
from tests.conftest import csrf_headers, login
from tests.test_sessions import build_course


def _iso(minutes: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def create_session(client, course_id, *, start_min: float, end_min: float, title="Lecture 1"):
    return client.post("/api/sessions", json={
        "course_id": course_id,
        "title": title,
        "scheduled_start": _iso(start_min),
        "scheduled_end": _iso(end_min),
    }, headers=csrf_headers(client))


def enable_self_marking(admin_client, session_id):
    return admin_client.patch(f"/api/sessions/{session_id}/self-marking", json={"enabled": True},
                              headers=csrf_headers(admin_client))


def lock_student(admin_client, session_id, student_id, locked=True, reason=None):
    return admin_client.patch(f"/api/sessions/{session_id}/participants/{student_id}/self-marking",
                              json={"locked": locked, "reason": reason},
                              headers=csrf_headers(admin_client))


def test_student_self_marks_inside_the_window(admin_client, db):
    _, course, students = build_course(admin_client, db, student_login=True)
    session = create_session(admin_client, course["id"], start_min=-5, end_min=60).json()
    sid = session["id"]
    assert session["self_marking_enabled"] is False

    enabled = enable_self_marking(admin_client, sid)
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["self_marking_enabled"] is True

    assert login(admin_client, students[0].email).status_code == 200
    marked = admin_client.post(f"/api/sessions/{sid}/self-mark", headers=csrf_headers(admin_client))
    assert marked.status_code == 200, marked.text
    body = marked.json()
    assert body["status"] == "present"
    assert body["source"] == "self_reported"
    assert body["already_marked"] is False

    record = db.execute(
        select(AttendanceRecord).where(AttendanceRecord.session_id == sid)
    ).scalars().one()
    assert record.source == "self_reported"
    assert record.student_id == students[0].id
    assert db.scalar(select(AuditLog.id).where(AuditLog.action == "attendance.self_mark")) is not None


def test_self_marking_is_rejected_outside_the_window(admin_client, db):
    _, course, students = build_course(admin_client, db, student_login=True)
    future = create_session(admin_client, course["id"], start_min=10, end_min=60, title="Later").json()
    past = create_session(admin_client, course["id"], start_min=-90, end_min=-60, title="Earlier").json()
    for session in (future, past):
        enable_self_marking(admin_client, session["id"])

    assert login(admin_client, students[0].email).status_code == 200
    for session in (future, past):
        blocked = admin_client.post(f"/api/sessions/{session['id']}/self-mark", headers=csrf_headers(admin_client))
        assert blocked.status_code == 403, blocked.text
        assert blocked.json()["error"]["code"] == "self_marking_closed"

    assert db.execute(select(AttendanceRecord)).scalars().all() == []


def test_self_marking_requires_the_session_switch(admin_client, db):
    _, course, students = build_course(admin_client, db, student_login=True)
    session = create_session(admin_client, course["id"], start_min=-5, end_min=60).json()

    assert login(admin_client, students[0].email).status_code == 200
    blocked = admin_client.post(f"/api/sessions/{session['id']}/self-mark", headers=csrf_headers(admin_client))
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "self_marking_closed"


def test_admin_can_lock_one_student_out(admin_client, admin_user, db):
    _, course, students = build_course(admin_client, db, student_login=True)
    session = create_session(admin_client, course["id"], start_min=-5, end_min=60).json()
    sid = session["id"]
    enable_self_marking(admin_client, sid)

    locked = lock_student(admin_client, sid, students[0].id, reason="Suspected proxy attendance")
    assert locked.status_code == 200, locked.text
    entry = [r for r in locked.json() if r["student_id"] == students[0].id][0]
    assert entry["self_marking_locked"] is True
    assert entry["self_marking_lock_reason"] == "Suspected proxy attendance"

    assert login(admin_client, students[0].email).status_code == 200
    blocked = admin_client.post(f"/api/sessions/{sid}/self-mark", headers=csrf_headers(admin_client))
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "self_marking_closed"

    assert login(admin_client, admin_user.email).status_code == 200
    unlocked = lock_student(admin_client, sid, students[0].id, locked=False)
    assert unlocked.status_code == 200
    assert all(not r["self_marking_locked"] for r in unlocked.json())

    assert login(admin_client, students[0].email).status_code == 200
    allowed = admin_client.post(f"/api/sessions/{sid}/self-mark", headers=csrf_headers(admin_client))
    assert allowed.status_code == 200, allowed.text


def test_self_mark_never_overwrites_an_existing_record(admin_client, db):
    _, course, students = build_course(admin_client, db, student_login=True)
    session = create_session(admin_client, course["id"], start_min=-5, end_min=60).json()
    sid = session["id"]
    enable_self_marking(admin_client, sid)
    admin_client.post(f"/api/sessions/{sid}/start", headers=csrf_headers(admin_client))

    admin_client.post(f"/api/sessions/{sid}/attendance",
                      json={"student_id": students[0].id, "status": "late", "reason": "Verified by faculty"},
                      headers=csrf_headers(admin_client))

    assert login(admin_client, students[0].email).status_code == 200
    marked = admin_client.post(f"/api/sessions/{sid}/self-mark", headers=csrf_headers(admin_client))
    assert marked.status_code == 200, marked.text
    assert marked.json()["already_marked"] is True
    assert marked.json()["source"] == "manual"
    assert marked.json()["status"] == "late"


def test_repeat_self_mark_is_idempotent(admin_client, db):
    _, course, students = build_course(admin_client, db, student_login=True)
    session = create_session(admin_client, course["id"], start_min=-5, end_min=60).json()
    sid = session["id"]
    enable_self_marking(admin_client, sid)

    assert login(admin_client, students[0].email).status_code == 200
    first = admin_client.post(f"/api/sessions/{sid}/self-mark", headers=csrf_headers(admin_client))
    assert first.status_code == 200
    second = admin_client.post(f"/api/sessions/{sid}/self-mark", headers=csrf_headers(admin_client))
    assert second.status_code == 200
    assert second.json()["already_marked"] is True
    assert second.json()["marked_at"] == first.json()["marked_at"]

    records = db.execute(select(AttendanceRecord).where(AttendanceRecord.session_id == sid)).scalars().all()
    assert len(records) == 1


def test_arrival_after_the_late_cutoff_is_recorded_as_late(admin_client, db):
    _, course, students = build_course(admin_client, db, student_login=True)
    session = create_session(admin_client, course["id"], start_min=-20, end_min=60).json()
    sid = session["id"]
    enable_self_marking(admin_client, sid)

    assert login(admin_client, students[0].email).status_code == 200
    marked = admin_client.post(f"/api/sessions/{sid}/self-mark", headers=csrf_headers(admin_client))
    assert marked.status_code == 200, marked.text
    assert marked.json()["status"] == "late"


def test_paused_and_closed_sessions_refuse_self_marking(admin_client, db):
    _, course, students = build_course(admin_client, db, student_login=True)
    session = create_session(admin_client, course["id"], start_min=-5, end_min=60).json()
    sid = session["id"]
    enable_self_marking(admin_client, sid)

    admin_client.post(f"/api/sessions/{sid}/start", headers=csrf_headers(admin_client))
    admin_client.post(f"/api/sessions/{sid}/pause", headers=csrf_headers(admin_client))

    assert login(admin_client, students[0].email).status_code == 200
    paused = admin_client.post(f"/api/sessions/{sid}/self-mark", headers=csrf_headers(admin_client))
    assert paused.status_code == 403
    assert paused.json()["error"]["code"] == "self_marking_closed"

    admin_client.post(f"/api/sessions/{sid}/resume", headers=csrf_headers(admin_client))
    admin_client.post(f"/api/sessions/{sid}/close", headers=csrf_headers(admin_client))
    closed = admin_client.post(f"/api/sessions/{sid}/self-mark", headers=csrf_headers(admin_client))
    assert closed.status_code == 403


def test_student_session_list_reports_the_self_marking_state(admin_client, admin_user, db):
    _, course, students = build_course(admin_client, db, student_login=True)
    open_session = create_session(admin_client, course["id"], start_min=-5, end_min=60, title="Open").json()
    later_session = create_session(admin_client, course["id"], start_min=120, end_min=180, title="Later").json()
    enable_self_marking(admin_client, open_session["id"])

    assert login(admin_client, students[0].email).status_code == 200
    listing = admin_client.get("/api/sessions/mine").json()
    by_id = {row["id"]: row for row in listing}
    assert by_id[open_session["id"]]["self_marking_open"] is True
    assert by_id[open_session["id"]]["self_marking_message"] is None
    assert by_id[open_session["id"]]["self_marking_closes_at"] is not None
    assert by_id[later_session["id"]]["self_marking_open"] is False
    assert by_id[later_session["id"]]["self_marking_message"] == "Self-marking is not enabled for this session"

    assert login(admin_client, admin_user.email).status_code == 200
    enable_self_marking(admin_client, later_session["id"])
    assert login(admin_client, students[0].email).status_code == 200
    listing = admin_client.get("/api/sessions/mine").json()
    by_id = {row["id"]: row for row in listing}
    assert by_id[later_session["id"]]["self_marking_open"] is False
    assert by_id[later_session["id"]]["self_marking_message"] == "Self-marking opens when the session starts"


def test_only_admin_toggles_self_marking(admin_client, db):
    faculty, course, students = build_course(admin_client, db, faculty_login=True)
    session = create_session(admin_client, course["id"], start_min=-5, end_min=60).json()
    sid = session["id"]

    admin_client.post("/api/auth/logout", headers=csrf_headers(admin_client))
    assert login(admin_client, faculty.email).status_code == 200
    blocked = admin_client.patch(f"/api/sessions/{sid}/self-marking", json={"enabled": True},
                                 headers=csrf_headers(admin_client))
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "forbidden"


def test_students_cannot_self_mark_on_behalf_of_others(admin_client, db):
    _, course, students = build_course(admin_client, db, student_login=True)
    session = create_session(admin_client, course["id"], start_min=-5, end_min=60).json()
    sid = session["id"]
    enable_self_marking(admin_client, sid)

    assert login(admin_client, students[0].email).status_code == 200
    marked = admin_client.post(f"/api/sessions/{sid}/self-mark", headers=csrf_headers(admin_client))
    assert marked.status_code == 200
    assert marked.json()["student_id"] == students[0].id

    records = db.execute(select(AttendanceRecord).where(AttendanceRecord.session_id == sid)).scalars().all()
    assert [r.student_id for r in records] == [students[0].id]
