from sqlalchemy import select

from app.models import CourseEnrollment, Faculty, Student, User
from tests.conftest import csrf_headers, login, make_user


def create_faculty(db, employee_id, email, with_login=False):
    row = Faculty(employee_id=employee_id, full_name=f"Faculty {employee_id}", email=email,
                  department="Computer Science", designation="Lecturer", status="active")
    db.add(row)
    db.flush()
    if with_login:
        row.user_id = make_user(db, "faculty", email=email).id
    db.commit()
    db.refresh(row)
    return row


def create_student(db, reg, email, with_login=False):
    row = Student(registration_number=reg, full_name=f"Student {reg}", email=email,
                  department="Computer Science", program="B.Sc. Computer Science",
                  enrollment_year=2021, status="active")
    db.add(row)
    db.flush()
    if with_login:
        row.user_id = make_user(db, "student", email=email).id
    db.commit()
    db.refresh(row)
    return row


def removal_requests(course_id, faculty_id, student_id, user_id, other_student_id):
    return [
        ("POST", f"/api/students/{student_id}/deactivate", {"reason": "Removed by a non-admin"}),
        ("PATCH", f"/api/students/{student_id}", {"status": "inactive"}),
        ("POST", f"/api/faculty/{faculty_id}/deactivate", {"reason": "Removed by a non-admin"}),
        ("PATCH", f"/api/faculty/{faculty_id}", {"status": "inactive"}),
        ("DELETE", f"/api/courses/{course_id}/enrollments/{student_id}", None),
        ("PATCH", f"/api/users/{user_id}", {"is_active": False}),
        ("POST", f"/api/users/{user_id}/reset-link", None),
        ("POST", "/api/users", {"email": "intruder.admin@example.edu", "full_name": "Intruder Admin"}),
        ("POST", f"/api/biometrics/{other_student_id}/delete",
         {"withdraw_consent": True, "reason": "Erased by someone else"}),
    ]


def attempt(client, requests):
    results = []
    for method, url, body in requests:
        response = client.request(method, url, json=body, headers=csrf_headers(client))
        results.append((method, url, response.status_code))
    return results


def assert_all_forbidden(client, requests):
    for method, url, status in attempt(client, requests):
        assert status == 403, f"{method} {url} returned {status}, expected 403"


def test_only_the_admin_can_deactivate_people_or_drop_them_from_the_site(admin_client, admin_user, db):
    owner = create_faculty(db, "FAC-CS-101", "owner@example.edu", with_login=True)
    target_faculty = create_faculty(db, "FAC-CS-102", "target.faculty@example.edu")
    target_student = create_student(db, "CS21-101", "target.student@example.edu", with_login=True)
    bystander = create_student(db, "CS21-102", "bystander@example.edu")

    created = admin_client.post(
        "/api/courses",
        json={"code": "CS401", "name": "Distributed Systems", "department": "Computer Science",
              "term": "2026-27 Odd", "faculty_id": owner.id},
        headers=csrf_headers(admin_client),
    )
    assert created.status_code == 201, created.text
    course_id = created.json()["id"]
    enrolled = admin_client.post(f"/api/courses/{course_id}/enrollments", json={"student_ids": [target_student.id]},
                                 headers=csrf_headers(admin_client))
    assert enrolled.status_code == 200, enrolled.text

    student_user = db.scalar(select(User).where(User.email == target_student.email))
    requests = removal_requests(course_id, target_faculty.id, target_student.id, student_user.id, bystander.id)

    assert login(admin_client, owner.email).status_code == 200
    assert_all_forbidden(admin_client, requests)

    assert login(admin_client, target_student.email).status_code == 200
    assert_all_forbidden(admin_client, requests)

    db.refresh(target_student)
    db.refresh(target_faculty)
    db.refresh(student_user)
    assert target_student.status == "active" and target_student.deactivated_at is None
    assert target_faculty.status == "active"
    assert student_user.is_active is True
    enrollment = db.scalar(select(CourseEnrollment).where(
        CourseEnrollment.course_id == course_id, CourseEnrollment.student_id == target_student.id))
    assert enrollment is not None and enrollment.status == "active"
    assert db.scalar(select(User).where(User.email == "intruder.admin@example.edu")) is None

    assert login(admin_client, admin_user.email).status_code == 200
    deactivated = admin_client.post(f"/api/students/{target_student.id}/deactivate",
                                    json={"reason": "Left the programme"},
                                    headers=csrf_headers(admin_client))
    assert deactivated.status_code == 200, deactivated.text
    assert deactivated.json()["status"] == "inactive"
