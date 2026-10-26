from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models import AttendanceRecord, AuditLog
from tests.conftest import csrf_headers, login
from tests.test_academics import create_faculty_record, create_student_record


def _iso(delta_hours: int = 1) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=delta_hours)).isoformat()


def create_session(client, course_id, title="Lecture 1", start=None, end=None):
    return client.post("/api/sessions", json={
        "course_id": course_id,
        "title": title,
        "scheduled_start": start or _iso(1),
        "scheduled_end": end or _iso(2),
    }, headers=csrf_headers(client))


def build_course(admin_client, db, *, faculty_login=False, student_login=False, code="CS301"):
    faculty = create_faculty_record(db, employee_id=f"FAC-{code}", email=f"prof.{code.lower()}@example.edu",
                                    with_login=faculty_login)
    course = admin_client.post("/api/courses", json={"code": code, "name": "Database Systems",
                                                     "department": "Computer Science", "term": "2026-27 Odd",
                                                     "faculty_id": faculty.id},
                               headers=csrf_headers(admin_client)).json()
    students = [
        create_student_record(db, "CS21-001", "asha.rao@example.edu", with_login=student_login),
        create_student_record(db, "CS21-002", "bilal.khan@example.edu"),
    ]
    enrolled = admin_client.post(f"/api/courses/{course['id']}/enrollments",
                                 json={"student_ids": [s.id for s in students]},
                                 headers=csrf_headers(admin_client))
    assert enrolled.status_code == 200, enrolled.text
    return faculty, course, students


def test_session_snapshots_roster_and_blocks_overlap(admin_client, db):
    _, course, students = build_course(admin_client, db)
    created = create_session(admin_client, course["id"])
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["status"] == "scheduled"
    assert body["course_code"] == "CS301"
    assert body["counts"]["participants"] == 2
    assert body["counts"]["unmarked"] == 2
    assert body["liveness_policy"] == "off"

    overlap = create_session(admin_client, course["id"], title="Clashing")
    assert overlap.status_code == 409
    assert overlap.json()["error"]["code"] == "session_overlap"

    roster = admin_client.get(f"/api/sessions/{body['id']}/roster").json()
    assert [r["registration_number"] for r in roster] == ["CS21-001", "CS21-002"]
    assert all(r["status"] is None for r in roster)

    patched = admin_client.patch(f"/api/sessions/{body['id']}", json={"title": "Lecture 1 revised"},
                                 headers=csrf_headers(admin_client))
    assert patched.status_code == 200
    assert patched.json()["title"] == "Lecture 1 revised"


def test_late_enrolment_reaches_open_sessions_only(admin_client, db):
    _, course, _ = build_course(admin_client, db)
    scheduled = create_session(admin_client, course["id"]).json()
    past = create_session(admin_client, course["id"], title="Lecture 0", start=_iso(-8), end=_iso(-7)).json()
    admin_client.post(f"/api/sessions/{past['id']}/start", headers=csrf_headers(admin_client))
    admin_client.post(f"/api/sessions/{past['id']}/close", headers=csrf_headers(admin_client))
    admin_client.post(f"/api/sessions/{past['id']}/finalize", headers=csrf_headers(admin_client))

    late = create_student_record(db, "CS21-003", "late.join@example.edu")
    enrolled = admin_client.post(f"/api/courses/{course['id']}/enrollments", json={"student_ids": [late.id]},
                                 headers=csrf_headers(admin_client))
    assert enrolled.status_code == 200, enrolled.text
    assert enrolled.json()["added"] == 1

    open_roster = admin_client.get(f"/api/sessions/{scheduled['id']}/roster").json()
    assert "CS21-003" in [r["registration_number"] for r in open_roster]
    frozen_roster = admin_client.get(f"/api/sessions/{past['id']}/roster").json()
    assert "CS21-003" not in [r["registration_number"] for r in frozen_roster]

    dropped = admin_client.delete(f"/api/courses/{course['id']}/enrollments/{late.id}",
                                  headers=csrf_headers(admin_client))
    assert dropped.status_code == 204
    open_roster = admin_client.get(f"/api/sessions/{scheduled['id']}/roster").json()
    assert "CS21-003" not in [r["registration_number"] for r in open_roster]


def test_lifecycle_and_finalize_generates_absences(admin_client, db):
    _, course, students = build_course(admin_client, db)
    session = create_session(admin_client, course["id"]).json()
    sid = session["id"]

    started = admin_client.post(f"/api/sessions/{sid}/start", headers=csrf_headers(admin_client))
    assert started.status_code == 200
    assert started.json()["status"] == "active"

    marked = admin_client.post(f"/api/sessions/{sid}/attendance",
                               json={"student_id": students[0].id, "status": "present", "reason": "Roll call"},
                               headers=csrf_headers(admin_client))
    assert marked.status_code == 201, marked.text
    assert marked.json()["status"] == "present"
    assert marked.json()["source"] == "manual"

    duplicate = admin_client.post(f"/api/sessions/{sid}/attendance",
                                  json={"student_id": students[0].id, "status": "late", "reason": "Roll call"},
                                  headers=csrf_headers(admin_client))
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "duplicate_attendance"

    outsider = db.execute(select(AttendanceRecord).where(AttendanceRecord.session_id == sid)).scalars().all()
    assert len(outsider) == 1

    paused = admin_client.post(f"/api/sessions/{sid}/pause", headers=csrf_headers(admin_client))
    assert paused.json()["status"] == "paused"
    resumed = admin_client.post(f"/api/sessions/{sid}/resume", headers=csrf_headers(admin_client))
    assert resumed.json()["status"] == "active"
    closed = admin_client.post(f"/api/sessions/{sid}/close", headers=csrf_headers(admin_client))
    assert closed.json()["status"] == "closed"

    finalized = admin_client.post(f"/api/sessions/{sid}/finalize", headers=csrf_headers(admin_client))
    assert finalized.status_code == 200, finalized.text
    assert finalized.json()["status"] == "finalized"
    assert finalized.json()["counts"] == {"participants": 2, "present": 1, "late": 0, "absent": 1,
                                          "pending_review": 0, "excused": 0, "unmarked": 0}

    records = admin_client.get("/api/attendance", params={"session_id": sid}).json()["items"]
    absent = [r for r in records if r["status"] == "absent"]
    assert len(absent) == 1 and absent[0]["source"] == "system"

    assert db.scalar(select(AuditLog.id).where(AuditLog.action == "session.finalize")) is not None
    assert db.scalar(select(AuditLog.id).where(AuditLog.action == "attendance.manual")) is not None


def test_transition_guards_and_reopen(admin_client, db):
    _, course, _ = build_course(admin_client, db)
    sid = create_session(admin_client, course["id"]).json()["id"]

    early = admin_client.post(f"/api/sessions/{sid}/finalize", headers=csrf_headers(admin_client))
    assert early.status_code == 400
    assert early.json()["error"]["code"] == "invalid_transition"

    admin_client.post(f"/api/sessions/{sid}/start", headers=csrf_headers(admin_client))
    twice = admin_client.post(f"/api/sessions/{sid}/start", headers=csrf_headers(admin_client))
    assert twice.status_code == 400
    cancel_active = admin_client.post(f"/api/sessions/{sid}/cancel", json={}, headers=csrf_headers(admin_client))
    assert cancel_active.status_code == 400

    admin_client.post(f"/api/sessions/{sid}/close", headers=csrf_headers(admin_client))
    no_reason = admin_client.post(f"/api/sessions/{sid}/reopen", json={"reason": ""},
                                  headers=csrf_headers(admin_client))
    assert no_reason.status_code == 422

    reopened = admin_client.post(f"/api/sessions/{sid}/reopen", json={"reason": "Camera failure"},
                                 headers=csrf_headers(admin_client))
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "active"
    assert reopened.json()["closed_at"] is None


def test_faculty_only_reaches_own_sessions(admin_client, db):
    faculty, course, students = build_course(admin_client, db, faculty_login=True)
    mine = create_session(admin_client, course["id"]).json()

    other_faculty = create_faculty_record(db, "FAC-CS-002", "arun.verma@example.edu")
    other_course = admin_client.post("/api/courses", json={"code": "CS302", "name": "Operating Systems",
                                                           "department": "Computer Science", "term": "2026-27 Odd",
                                                           "faculty_id": other_faculty.id},
                                     headers=csrf_headers(admin_client)).json()
    theirs = create_session(admin_client, other_course["id"], title="Scheduling", start=_iso(5), end=_iso(6)).json()

    assert login(admin_client, faculty.email).status_code == 200
    listed = admin_client.get("/api/sessions").json()
    assert [s["id"] for s in listed["items"]] == [mine["id"]]
    assert admin_client.get(f"/api/sessions/{theirs['id']}").status_code == 404

    admin_client.post(f"/api/sessions/{mine['id']}/start", headers=csrf_headers(admin_client))
    marked = admin_client.post(f"/api/sessions/{mine['id']}/attendance",
                               json={"student_id": students[1].id, "status": "late", "reason": "Arrived late"},
                               headers=csrf_headers(admin_client))
    assert marked.status_code == 201, marked.text

    blocked = admin_client.post(f"/api/sessions/{theirs['id']}/start", headers=csrf_headers(admin_client))
    assert blocked.status_code == 404


def test_faculty_corrections_can_be_disabled(admin_client, db):
    faculty, course, students = build_course(admin_client, db, faculty_login=True)
    sid = create_session(admin_client, course["id"]).json()["id"]
    admin_client.post(f"/api/sessions/{sid}/start", headers=csrf_headers(admin_client))
    admin_client.post(f"/api/sessions/{sid}/attendance",
                      json={"student_id": students[0].id, "status": "present", "reason": "Roll call"},
                      headers=csrf_headers(admin_client))
    records = admin_client.get("/api/attendance", params={"session_id": sid}).json()["items"]
    record_id = records[0]["id"]

    disabled = admin_client.patch("/api/settings", json={"faculty_can_correct": False},
                                  headers=csrf_headers(admin_client))
    assert disabled.status_code == 200

    assert login(admin_client, faculty.email).status_code == 200
    blocked = admin_client.patch(f"/api/attendance/{record_id}", json={"status": "excused", "reason": "Medical"},
                                 headers=csrf_headers(admin_client))
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "forbidden"


def test_faculty_can_correct_own_records(admin_client, db):
    faculty, course, students = build_course(admin_client, db, faculty_login=True)
    sid = create_session(admin_client, course["id"]).json()["id"]
    admin_client.post(f"/api/sessions/{sid}/start", headers=csrf_headers(admin_client))
    admin_client.post(f"/api/sessions/{sid}/attendance",
                      json={"student_id": students[0].id, "status": "present", "reason": "Roll call"},
                      headers=csrf_headers(admin_client))
    record_id = admin_client.get("/api/attendance", params={"session_id": sid}).json()["items"][0]["id"]

    login(admin_client, faculty.email)
    corrected = admin_client.patch(f"/api/attendance/{record_id}", json={"status": "excused", "reason": "Medical leave"},
                                   headers=csrf_headers(admin_client))
    assert corrected.status_code == 200, corrected.text
    body = corrected.json()
    assert body["status"] == "excused"
    assert body["correction_reason"] == "Medical leave"
    assert [h["action"] for h in body["history"]] == ["attendance.manual", "attendance.update"]


def test_student_sees_only_own_attendance(admin_client, db):
    _, course, students = build_course(admin_client, db, student_login=True)
    sid = create_session(admin_client, course["id"]).json()["id"]
    admin_client.post(f"/api/sessions/{sid}/start", headers=csrf_headers(admin_client))
    admin_client.post(f"/api/sessions/{sid}/attendance",
                      json={"student_id": students[0].id, "status": "present", "reason": "Roll call"},
                      headers=csrf_headers(admin_client))
    admin_client.post(f"/api/sessions/{sid}/close", headers=csrf_headers(admin_client))
    admin_client.post(f"/api/sessions/{sid}/finalize", headers=csrf_headers(admin_client))

    assert login(admin_client, students[0].email).status_code == 200
    listing = admin_client.get("/api/attendance", params={"student_id": students[1].id})
    assert listing.status_code == 200
    assert listing.json()["total"] == 1
    assert listing.json()["items"][0]["student_id"] == students[0].id

    record_id = listing.json()["items"][0]["id"]
    assert admin_client.get(f"/api/attendance/{record_id}").status_code == 200
    assert admin_client.patch(f"/api/attendance/{record_id}", json={"status": "late", "reason": "self service"},
                              headers=csrf_headers(admin_client)).status_code == 403
    assert admin_client.post(f"/api/sessions/{sid}/attendance",
                             json={"student_id": students[0].id, "status": "present", "reason": "self"},
                             headers=csrf_headers(admin_client)).status_code == 403
    assert admin_client.get(f"/api/sessions/{sid}").status_code == 403
