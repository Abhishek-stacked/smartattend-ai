from app.models import Faculty, Student
from tests.conftest import csrf_headers, login, make_user


def create_faculty_record(db, employee_id="FAC-CS-001", email="meera.iyer@example.edu", with_login=False):
    faculty = Faculty(employee_id=employee_id, full_name="Meera Iyer", email=email, department="Computer Science",
                      designation="Associate Professor", status="active")
    db.add(faculty)
    db.flush()
    if with_login:
        user = make_user(db, "faculty", email=email)
        faculty.user_id = user.id
    db.commit()
    db.refresh(faculty)
    return faculty


def create_student_record(db, reg="CS21-001", email="asha.rao@example.edu", with_login=False):
    student = Student(registration_number=reg, full_name="Asha Rao", email=email, department="Computer Science",
                      program="B.Sc. Computer Science", enrollment_year=2021, status="active")
    db.add(student)
    db.flush()
    if with_login:
        user = make_user(db, "student", email=email)
        student.user_id = user.id
    db.commit()
    db.refresh(student)
    return student


def create_course(client, faculty_id, code="CS301"):
    return client.post("/api/courses", json={"code": code, "name": "Database Systems", "department": "Computer Science",
                                             "term": "2026-27 Odd", "faculty_id": faculty_id},
                       headers=csrf_headers(client))


def test_admin_manages_students_and_accounts(admin_client, db):
    payload = {"registration_number": "  cs21-001 ", "full_name": "Asha Rao", "email": "Asha.Rao@Example.edu",
               "department": "Computer Science", "program": "B.Sc. Computer Science", "enrollment_year": 2021}
    created = admin_client.post("/api/students", json=payload, headers=csrf_headers(admin_client))
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["registration_number"] == "CS21-001"
    assert body["email"] == "asha.rao@example.edu"
    student_id = body["id"]

    duplicate = admin_client.post("/api/students", json=payload, headers=csrf_headers(admin_client))
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "duplicate_registration_number"

    found = admin_client.get("/api/students", params={"q": "asha"})
    assert found.json()["total"] == 1

    detail = admin_client.get(f"/api/students/{student_id}")
    assert detail.status_code == 200
    assert detail.json()["has_account"] is False
    assert detail.json()["biometric_consented"] is False

    account = admin_client.post(f"/api/students/{student_id}/account", headers=csrf_headers(admin_client))
    assert account.status_code == 200, account.text
    assert "/reset-password?token=" in account.json()["reset"]["reset_url"]
    assert db.get(Student, student_id).user_id == account.json()["user"]["id"]

    again = admin_client.post(f"/api/students/{student_id}/account", headers=csrf_headers(admin_client))
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "account_exists"


def test_admin_sets_student_password_and_creates_account(admin_client, db):
    student = create_student_record(db, "CS21-011", "new.student@example.edu")
    weak = admin_client.post(f"/api/students/{student.id}/password", json={"password": "short"},
                             headers=csrf_headers(admin_client))
    assert weak.status_code == 422
    db.refresh(student)
    assert student.user_id is None

    created = admin_client.post(f"/api/students/{student.id}/password", json={"password": "StudentPassw0rd"},
                                headers=csrf_headers(admin_client))
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["account_created"] is True
    assert body["user"]["email"] == "new.student@example.edu"
    db.refresh(student)
    assert student.user_id == body["user"]["id"]

    updated = admin_client.post(f"/api/students/{student.id}/password", json={"password": "ChangedPassw0rd"},
                                headers=csrf_headers(admin_client))
    assert updated.status_code == 200
    assert updated.json()["account_created"] is False

    admin_client.post("/api/auth/logout", headers=csrf_headers(admin_client))
    assert login(admin_client, "new.student@example.edu", "ChangedPassw0rd").status_code == 200


def test_student_visibility_is_self_only(admin_client, db):
    own = create_student_record(db, "CS21-001", "asha.rao@example.edu", with_login=True)
    other = create_student_record(db, "CS21-002", "bilal.khan@example.edu")
    assert login(admin_client, own.email).status_code == 200

    assert admin_client.get(f"/api/students/{own.id}").status_code == 200
    assert admin_client.get(f"/api/students/{other.id}").status_code == 404
    assert admin_client.get("/api/students").status_code == 403


def test_faculty_scope_limits_courses_and_writes(admin_client, db):
    mine = create_faculty_record(db, "FAC-CS-001", "meera.iyer@example.edu", with_login=True)
    theirs = create_faculty_record(db, "FAC-CS-002", "arun.verma@example.edu")
    own_course = create_course(admin_client, mine.id, "CS301").json()
    other_course = create_course(admin_client, theirs.id, "CS302").json()

    login(admin_client, mine.email)
    listed = admin_client.get("/api/courses")
    assert [c["code"] for c in listed.json()["items"]] == ["CS301"]
    assert admin_client.get(f"/api/courses/{own_course['id']}").status_code == 200
    assert admin_client.get(f"/api/courses/{other_course['id']}").status_code == 404

    blocked = admin_client.post("/api/courses", json={"code": "CS999", "name": "Nope", "department": "CS",
                                                      "term": "2026-27"}, headers=csrf_headers(admin_client))
    assert blocked.status_code == 403
    assert admin_client.get("/api/faculty").status_code == 403


def test_enrollment_is_idempotent_and_drop_is_honoured(admin_client, db):
    faculty = create_faculty_record(db)
    a = create_student_record(db, "CS21-001", "asha.rao@example.edu")
    b = create_student_record(db, "CS21-002", "bilal.khan@example.edu")
    inactive = create_student_record(db, "CS21-003", "chen.wei@example.edu")
    inactive.status = "inactive"
    db.commit()
    course = create_course(admin_client, faculty.id).json()

    first = admin_client.post(f"/api/courses/{course['id']}/enrollments", json={"student_ids": [a.id, b.id, inactive.id]},
                              headers=csrf_headers(admin_client))
    assert first.status_code == 200, first.text
    assert first.json()["added"] == 2
    assert first.json()["skipped_inactive"] == 1

    second = admin_client.post(f"/api/courses/{course['id']}/enrollments", json={"student_ids": [a.id]},
                               headers=csrf_headers(admin_client))
    assert second.json()["already_enrolled"] == 1
    assert second.json()["added"] == 0

    roster = admin_client.get(f"/api/courses/{course['id']}/enrollments").json()
    assert roster["total"] == 2

    dropped = admin_client.delete(f"/api/courses/{course['id']}/enrollments/{a.id}",
                                  headers=csrf_headers(admin_client))
    assert dropped.status_code == 204
    assert admin_client.get(f"/api/courses/{course['id']}/enrollments").json()["total"] == 1


def test_course_update_and_invalid_faculty(admin_client, db):
    faculty = create_faculty_record(db)
    course = create_course(admin_client, faculty.id).json()
    patched = admin_client.patch(f"/api/courses/{course['id']}", json={"name": "Advanced Databases"},
                                 headers=csrf_headers(admin_client))
    assert patched.status_code == 200
    assert patched.json()["name"] == "Advanced Databases"

    invalid = admin_client.post("/api/courses", json={"code": "CS310", "name": "Bad", "department": "CS",
                                                      "term": "2026-27", "faculty_id": 9999},
                                headers=csrf_headers(admin_client))
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "invalid_faculty"


def test_faculty_detail_lists_courses_with_student_counts(admin_client, db):
    faculty = create_faculty_record(db, employee_id="FAC-CS-777", email="nisha.rao@example.edu")
    create_course(admin_client, faculty.id, code="CS310")

    detail = admin_client.get(f"/api/faculty/{faculty.id}")
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["employee_id"] == "FAC-CS-777"
    assert body["has_account"] is False
    assert [(c["code"], c["student_count"]) for c in body["courses"]] == [("CS310", 0)]
