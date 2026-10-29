from sqlalchemy import select

from app.core.security import verify_password
from app.models import AuditLog, AuthSession, User
from tests.conftest import PASSWORD, csrf_headers, login, make_user


def test_health_reports_database(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["database"] == "ok"
    assert "face_detection" in r.json()["models"]


def test_login_sets_httponly_session_and_csrf_cookies(client, admin_user):
    r = login(client, admin_user.email)
    assert r.status_code == 200
    assert r.json()["role"] == "admin"
    cookies = {c.name: c for c in client.cookies.jar}
    assert cookies["sa_session"].secure is False
    assert "HttpOnly" in cookies["sa_session"]._rest
    assert "HttpOnly" not in cookies["sa_csrf"]._rest
    assert cookies["sa_session"]._rest["SameSite"] == "lax"
    assert client.get("/api/auth/me").json()["email"] == admin_user.email


def test_login_failure_is_generic(client, admin_user):
    wrong = client.post("/api/auth/login", json={"email": admin_user.email, "password": "WrongPass123"})
    unknown = client.post("/api/auth/login", json={"email": "nobody@example.edu", "password": "WrongPass123"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    assert wrong.json()["error"]["code"] == "invalid_credentials"


def test_account_locks_after_repeated_failures(client, admin_user):
    for _ in range(5):
        assert client.post("/api/auth/login", json={"email": admin_user.email, "password": "WrongPass123"}).status_code == 401
    blocked = client.post("/api/auth/login", json={"email": admin_user.email, "password": PASSWORD})
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "account_locked"
    assert blocked.json()["error"]["details"]["retry_after_s"] > 0


def test_inactive_user_cannot_login(client, db):
    user = make_user(db, "student", is_active=False)
    assert login(client, user.email).status_code == 401


def test_login_rate_limit(client):
    codes = [client.post("/api/auth/login", json={"email": f"nobody{i}@example.edu", "password": "WrongPass123"}).status_code
             for i in range(11)]
    assert codes[:10] == [401] * 10
    assert codes[10] == 429


def test_state_changing_request_requires_csrf_header(admin_client, db):
    target = make_user(db, "student")
    path = f"/api/users/{target.id}"
    assert admin_client.patch(path, json={"full_name": "Nope"}).json()["error"]["code"] == "csrf_failed"
    ok = admin_client.patch(path, json={"full_name": "Renamed Person"}, headers=csrf_headers(admin_client))
    assert ok.status_code == 200 and ok.json()["full_name"] == "Renamed Person"


def test_unauthenticated_and_role_enforcement(client, student_user):
    assert client.get("/api/auth/me").status_code == 401
    login(client, student_user.email)
    assert client.get("/api/users").status_code == 403
    assert client.get("/api/settings").status_code == 403


def test_logout_revokes_session(client, admin_user):
    login(client, admin_user.email)
    assert client.post("/api/auth/logout", headers=csrf_headers(client)).status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_change_password_revokes_other_sessions(app_instance, client, admin_user):
    from fastapi.testclient import TestClient

    other = TestClient(app_instance)
    login(client, admin_user.email)
    login(other, admin_user.email)
    r = client.post("/api/auth/change-password",
                    json={"current_password": PASSWORD, "new_password": "BrandNewPass1"},
                    headers=csrf_headers(client))
    assert r.status_code == 200
    assert other.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me").status_code == 200
    other.close()


def test_weak_password_is_rejected(client, admin_user):
    login(client, admin_user.email)
    r = client.post("/api/auth/change-password",
                    json={"current_password": PASSWORD, "new_password": "short"},
                    headers=csrf_headers(client))
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "weak_password"


def test_session_token_is_stored_hashed(db, client, admin_user):
    login(client, admin_user.email)
    raw = client.cookies.get("sa_session")
    rows = db.scalars(select(AuthSession)).all()
    assert len(rows) == 1
    assert rows[0].token_hash != raw
    assert len(rows[0].token_hash) == 64


def test_deactivated_user_sessions_are_revoked(app_instance, admin_client, db):
    from fastapi.testclient import TestClient

    victim = make_user(db, "faculty")
    other = TestClient(app_instance)
    assert login(other, victim.email).status_code == 200
    assert other.get("/api/auth/me").status_code == 200
    r = admin_client.patch(f"/api/users/{victim.id}", json={"is_active": False}, headers=csrf_headers(admin_client))
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert other.get("/api/auth/me").status_code == 401
    other.close()


def test_only_the_primary_admin_can_create_administrators(client, admin_user, db):
    assert login(client, admin_user.email).status_code == 200
    first = client.post("/api/users", json={"email": "delegate.admin@example.edu", "full_name": "Delegate Admin"},
                        headers=csrf_headers(client))
    assert first.status_code == 201, first.text

    secondary = make_user(db, "admin", email="secondary.admin@example.edu")
    assert login(client, secondary.email).status_code == 200
    denied = client.post("/api/users", json={"email": "third.admin@example.edu", "full_name": "Third Admin"},
                         headers=csrf_headers(client))
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "forbidden"
    assert db.scalar(select(User).where(User.email == "third.admin@example.edu")) is None


def test_admin_cannot_deactivate_self(admin_client, admin_user):
    r = admin_client.patch(f"/api/users/{admin_user.id}", json={"is_active": False}, headers=csrf_headers(admin_client))
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "cannot_deactivate_self"


def test_admin_creation_reset_flow_is_single_use(client, admin_user, db):
    login(client, admin_user.email)
    created = client.post("/api/users", json={"email": "new.admin@example.edu", "full_name": "New Admin"},
                          headers=csrf_headers(client))
    assert created.status_code == 201
    token = created.json()["reset"]["reset_url"].split("token=", 1)[1]
    new_user = db.scalar(select(User).where(User.email == "new.admin@example.edu"))
    assert not verify_password(new_user.password_hash, "anything")

    bad = client.post("/api/auth/reset-password", json={"token": token, "new_password": "weak"})
    assert bad.status_code == 422

    ok = client.post("/api/auth/reset-password", json={"token": token, "new_password": "FreshPassw0rd"})
    assert ok.status_code == 200
    client.post("/api/auth/logout", headers=csrf_headers(client))
    assert login(client, "new.admin@example.edu", "FreshPassw0rd").status_code == 200

    client.post("/api/auth/logout", headers=csrf_headers(client))
    reused = client.post("/api/auth/reset-password", json={"token": token, "new_password": "AnotherPassw0rd"})
    assert reused.status_code == 400
    assert reused.json()["error"]["code"] == "invalid_reset_token"


def test_admin_sets_password_without_reset_link(admin_client, db):
    target = make_user(db, "student")
    weak = admin_client.post(f"/api/users/{target.id}/password", json={"password": "short"},
                             headers=csrf_headers(admin_client))
    assert weak.status_code == 422
    assert weak.json()["error"]["code"] == "weak_password"

    r = admin_client.post(f"/api/users/{target.id}/password", json={"password": "AdminSetPassw0rd"},
                          headers=csrf_headers(admin_client))
    assert r.status_code == 204
    db.refresh(target)
    assert verify_password(target.password_hash, "AdminSetPassw0rd")

    admin_client.post("/api/auth/logout", headers=csrf_headers(admin_client))
    assert login(admin_client, target.email, "AdminSetPassw0rd").status_code == 200


def test_admin_set_password_cancels_outstanding_reset_link(admin_client, db):
    created = admin_client.post("/api/users", json={"email": "reset.target@example.edu", "full_name": "Reset Target"},
                                headers=csrf_headers(admin_client))
    token = created.json()["reset"]["reset_url"].split("token=", 1)[1]
    target = db.scalar(select(User).where(User.email == "reset.target@example.edu"))

    r = admin_client.post(f"/api/users/{target.id}/password", json={"password": "DirectPassw0rd"},
                          headers=csrf_headers(admin_client))
    assert r.status_code == 204

    stale = admin_client.post("/api/auth/reset-password", json={"token": token, "new_password": "AnotherPassw0rd"})
    assert stale.status_code == 400
    assert stale.json()["error"]["code"] == "invalid_reset_token"

    admin_client.post("/api/auth/logout", headers=csrf_headers(admin_client))
    assert login(admin_client, "reset.target@example.edu", "DirectPassw0rd").status_code == 200


def test_non_admin_cannot_set_passwords(client, db):
    login(client, make_user(db, "faculty", email="faculty.setter@example.edu").email)
    target = make_user(db, "student")
    r = client.post(f"/api/users/{target.id}/password", json={"password": "AdminSetPassw0rd"},
                    headers=csrf_headers(client))
    assert r.status_code == 403


def test_duplicate_email_is_conflict(admin_client, db):
    existing = make_user(db, "faculty")
    r = admin_client.post("/api/users", json={"email": existing.email, "full_name": "Clone"},
                          headers=csrf_headers(admin_client))
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "email_exists"


def test_login_events_are_audited(db, client, admin_user):
    login(client, admin_user.email)
    login(client, admin_user.email, "WrongPass123")
    actions = [a for a in db.scalars(select(AuditLog.action).order_by(AuditLog.id))]
    assert "auth.login" in actions and "auth.login_failed" in actions


def test_users_list_search_and_pagination(admin_client, db):
    make_user(db, "faculty", email="searchable.faculty@example.edu")
    r = admin_client.get("/api/users", params={"q": "searchable", "role": "faculty"})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1 and body["items"][0]["role"] == "faculty"
    paged = admin_client.get("/api/users", params={"page": 2, "page_size": 1})
    assert paged.json()["page"] == 2 and len(paged.json()["items"]) == 1
