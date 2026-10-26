import csv
import io
from datetime import datetime, timezone

from tests.conftest import csrf_headers, login
from tests.test_academics import create_faculty_record, create_student_record


def _window(day: int, hour: int = 12) -> tuple[str, str]:
    start = datetime(2026, 3, day, hour, 0, tzinfo=timezone.utc)
    end = datetime(2026, 3, day, hour + 1, 0, tzinfo=timezone.utc)
    return start.isoformat(), end.isoformat()


def _course(admin_client, db, code, faculty_email, students):
    faculty = create_faculty_record(db, employee_id=f"FAC-{code}", email=faculty_email, with_login=True)
    course = admin_client.post("/api/courses", json={
        "code": code, "name": f"{code} Systems", "department": "Computer Science",
        "term": "2026-27 Even", "faculty_id": faculty.id,
    }, headers=csrf_headers(admin_client)).json()
    enrolled = admin_client.post(f"/api/courses/{course['id']}/enrollments",
                                 json={"student_ids": [student.id for student in students]},
                                 headers=csrf_headers(admin_client))
    assert enrolled.status_code == 200, enrolled.text
    return faculty, course


def _session(admin_client, course_id, title, day, hour=12):
    start, end = _window(day, hour)
    session = admin_client.post("/api/sessions", json={
        "course_id": course_id, "title": title, "scheduled_start": start, "scheduled_end": end,
    }, headers=csrf_headers(admin_client))
    assert session.status_code == 201, session.text
    return session.json()


def _run(admin_client, session_id, marks=()):
    assert admin_client.post(f"/api/sessions/{session_id}/start",
                             headers=csrf_headers(admin_client)).status_code == 200
    for student_id, status in marks:
        marked = admin_client.post(f"/api/sessions/{session_id}/attendance", json={
            "student_id": student_id, "status": status, "reason": "Roll call",
        }, headers=csrf_headers(admin_client))
        assert marked.status_code == 201, marked.text
    assert admin_client.post(f"/api/sessions/{session_id}/close",
                             headers=csrf_headers(admin_client)).status_code == 200
    assert admin_client.post(f"/api/sessions/{session_id}/finalize",
                             headers=csrf_headers(admin_client)).status_code == 200


def _dataset(admin_client, db):
    student_a1 = create_student_record(db, "CS21-001", "asha.rao@example.edu", with_login=True)
    student_a2 = create_student_record(db, "CS21-002", "bilal.khan@example.edu")
    student_b1 = create_student_record(db, "CS21-010", "chitra.n@example.edu", with_login=True)
    faculty_a, course_a = _course(admin_client, db, "CS301", "meera.iyer@example.edu", [student_a1, student_a2])
    faculty_b, course_b = _course(admin_client, db, "CS302", "ravi.menon@example.edu", [student_b1])

    first = _session(admin_client, course_a["id"], "Relational model", day=2)
    _run(admin_client, first["id"], [(student_a1.id, "present")])
    second = _session(admin_client, course_a["id"], "Normalisation", day=9)
    _run(admin_client, second["id"], [(student_a1.id, "late")])
    other = _session(admin_client, course_b["id"], "Process scheduling", day=2, hour=14)
    _run(admin_client, other["id"], [(student_b1.id, "present")])
    return {
        "student_a1": student_a1, "student_a2": student_a2, "student_b1": student_b1,
        "faculty_a": faculty_a, "faculty_b": faculty_b,
        "course_a": course_a, "course_b": course_b,
        "session_a1": first, "session_a2": second, "session_b": other,
    }


def test_summary_and_trends_are_derived_from_records(admin_client, db):
    data = _dataset(admin_client, db)

    summary = admin_client.get("/api/reports/summary")
    assert summary.status_code == 200, summary.text
    body = summary.json()
    assert body["scope"] == "admin"
    assert (body["courses"], body["sessions"], body["participants"], body["records"]) == (2, 3, 5, 5)
    assert (body["present"], body["late"], body["absent"], body["pending_review"], body["excused"]) == (2, 1, 2, 0, 0)
    assert body["unmarked"] == 0
    assert body["attendance_rate"] == 60.0
    assert body["active_sessions"] == 0

    narrowed = admin_client.get("/api/reports/summary", params={"course_id": data["course_b"]["id"]}).json()
    assert (narrowed["sessions"], narrowed["records"], narrowed["present"], narrowed["attendance_rate"]) == (1, 1, 1, 100.0)

    daily = admin_client.get("/api/reports/trends", params={"granularity": "day"}).json()
    assert [point["bucket"] for point in daily["series"]] == ["2026-03-02", "2026-03-09"]
    assert [point["total"] for point in daily["series"]] == [3, 2]
    assert daily["series"][1]["rate"] == 50.0
    assert daily["distribution"] == {"present": 2, "late": 1, "absent": 2, "excused": 0, "pending_review": 0}
    assert [(row["code"], row["total"]) for row in daily["courses"]] == [("CS301", 4), ("CS302", 1)]

    weekly = admin_client.get("/api/reports/trends", params={"granularity": "week"}).json()
    assert [point["bucket"] for point in weekly["series"]] == ["2026-W10", "2026-W11"]

    monthly = admin_client.get("/api/reports/trends", params={"granularity": "month"}).json()
    assert len(monthly["series"]) == 1 and monthly["series"][0]["total"] == 5


def test_faculty_and_student_scope(admin_client, db, admin_user):
    data = _dataset(admin_client, db)

    login(admin_client, "meera.iyer@example.edu")
    faculty = admin_client.get("/api/reports/summary")
    assert faculty.status_code == 200, faculty.text
    assert (faculty.json()["sessions"], faculty.json()["records"], faculty.json()["scope"]) == (2, 4, "faculty")
    assert faculty.json()["attendance_rate"] == 50.0
    foreign = admin_client.get("/api/reports/summary", params={"course_id": data["course_b"]["id"]})
    assert foreign.status_code == 404

    login(admin_client, "asha.rao@example.edu")
    mine = admin_client.get("/api/me/summary")
    assert mine.status_code == 200, mine.text
    assert mine.json()["registration_number"] == "CS21-001"
    assert (mine.json()["sessions"], mine.json()["present"], mine.json()["late"]) == (2, 1, 1)
    assert mine.json()["attendance_rate"] == 100.0
    records = admin_client.get("/api/me/attendance")
    assert records.status_code == 200 and records.json()["total"] == 2
    assert {row["course_code"] for row in records.json()["items"]} == {"CS301"}
    assert admin_client.get("/api/reports/summary").status_code == 403
    assert admin_client.get("/api/reports/export", params={"type": "student"}).status_code == 403

    login(admin_client, admin_user.email)


def test_grouped_and_detail_reports(admin_client, db):
    data = _dataset(admin_client, db)

    students = admin_client.get("/api/reports/attendance", params={"type": "student"}).json()
    assert students["total"] == 3
    by_registration = {row["registration"]: row for row in students["rows"]}
    assert by_registration["CS21-001"]["total"] == 2
    assert by_registration["CS21-001"]["rate"] == 100.0
    assert by_registration["CS21-002"]["absent"] == 2

    paged = admin_client.get("/api/reports/attendance", params={"type": "student", "page": 3, "page_size": 1}).json()
    assert (len(paged["rows"]), paged["total"]) == (1, 3)

    late = admin_client.get("/api/reports/attendance", params={"type": "late"}).json()
    assert late["total"] == 1
    assert late["rows"][0]["status"] == "Late"
    assert late["rows"][0]["registration"] == "CS21-001"

    absences = admin_client.get("/api/reports/attendance", params={"type": "absence"}).json()
    assert absences["total"] == 2
    assert {row["session"] for row in absences["rows"]} == {"Relational model", "Normalisation"}

    courses = admin_client.get("/api/reports/attendance", params={"type": "course"}).json()
    rows = {row["course"]: row for row in courses["rows"]}
    assert rows["CS301"]["total"] == 4 and rows["CS301"]["rate"] == 50.0
    assert rows["CS302"]["total"] == 1 and rows["CS302"]["rate"] == 100.0

    filtered = admin_client.get("/api/reports/attendance", params={
        "type": "course", "date_from": "2026-03-05", "date_to": "2026-03-10",
    }).json()
    assert [row["course"] for row in filtered["rows"]] == ["CS301"]

    assert data["course_a"]["code"] == "CS301"


def test_corrections_report_and_request_validation(admin_client, db, admin_user):
    data = _dataset(admin_client, db)

    login(admin_client, "asha.rao@example.edu")
    created = admin_client.post("/api/corrections", json={
        "session_id": data["session_a1"]["id"], "requested_status": "excused",
        "reason": "=HYPERLINK(\"https://example.invalid\",\"open\")",
    }, headers=csrf_headers(admin_client))
    assert created.status_code == 201, created.text

    login(admin_client, "meera.iyer@example.edu")
    queue = admin_client.get("/api/reports/attendance", params={"type": "corrections"}).json()
    assert queue["total"] == 1
    row = queue["rows"][0]
    assert (row["requested"], row["status"], row["current"]) == ("Excused", "Pending", "Present")

    login(admin_client, "ravi.menon@example.edu")
    assert admin_client.get("/api/reports/attendance", params={"type": "corrections"}).json()["total"] == 0

    login(admin_client, admin_user.email)
    assert admin_client.get("/api/reports/attendance", params={"type": "nope"}).status_code == 422
    assert admin_client.get("/api/reports/attendance",
                            params={"type": "corrections", "status": "nope"}).status_code == 422
    assert admin_client.get("/api/reports/summary",
                            params={"date_from": "2026-03-10", "date_to": "2026-03-01"}).status_code == 422


def test_exports_protect_formulas_and_render_pdf(admin_client, db, admin_user):
    data = _dataset(admin_client, db)

    login(admin_client, "asha.rao@example.edu")
    admin_client.post("/api/corrections", json={
        "session_id": data["session_a2"]["id"], "requested_status": "present",
        "reason": "=cmd|' /C calc'!A0",
    }, headers=csrf_headers(admin_client))
    login(admin_client, admin_user.email)

    exported = admin_client.get("/api/reports/export", params={"type": "corrections", "fmt": "csv"})
    assert exported.status_code == 200, exported.text
    assert exported.headers["content-type"].startswith("text/csv")
    assert 'filename="smartattend-corrections-' in exported.headers["content-disposition"]
    text = exported.content.decode("utf-8-sig")
    assert text.startswith("Requested,")
    assert "\r\n" in text
    rows = list(csv.DictReader(io.StringIO(text)))
    assert rows[0]["Reason"].startswith("'=cmd")

    pdf = admin_client.get("/api/reports/export", params={"type": "student", "fmt": "pdf"})
    assert pdf.status_code == 200, pdf.text
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")
    assert len(pdf.content) > 1000

    assert admin_client.get("/api/reports/export",
                            params={"type": "student", "fmt": "xlsx"}).status_code == 422
    assert admin_client.get("/api/reports/export", params={"type": "nope", "fmt": "csv"}).status_code == 422


def test_activity_lists_recent_sessions_with_counts(admin_client, db):
    data = _dataset(admin_client, db)

    activity = admin_client.get("/api/reports/activity")
    assert activity.status_code == 200, activity.text
    body = activity.json()
    assert body["events"] == []
    assert [row["id"] for row in body["sessions"]] == [
        data["session_a2"]["id"], data["session_b"]["id"], data["session_a1"]["id"],
    ]
    assert body["sessions"][0]["counts"]["participants"] == 2
    assert body["sessions"][0]["counts"]["absent"] == 1
    assert body["sessions"][0]["counts"]["late"] == 1
