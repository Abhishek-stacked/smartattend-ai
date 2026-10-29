"""Deployment hardening and operational-path tests.

Covers production configuration guards, CSRF/session boundaries, pagination validation,
faculty lifecycle, audit metadata and the first-admin bootstrap command.
"""

from datetime import timedelta

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.cli import main as cli_main
from app.core.config import Settings, get_settings
from app.core.security import verify_password
from app.models import AuditLog, AuthSession, User
from app.models.base import utcnow
from tests.conftest import PASSWORD, csrf_headers, login

VALID_KEY = "k1:" + "A" * 43 + "="


def test_production_refuses_to_boot_without_template_keys():
    with pytest.raises(ValidationError, match="BIOMETRIC_ENCRYPTION_KEYS"):
        Settings(app_env="production", database_url="postgresql+psycopg://u:p@localhost/db",
                 biometric_encryption_keys="")

    configured = Settings(app_env="production", database_url="postgresql+psycopg://u:p@localhost/db",
                          biometric_encryption_keys=VALID_KEY)
    assert configured.is_production is True


def test_driverless_postgres_urls_are_coerced_to_psycopg():
    settings = Settings(app_env="development", database_url="postgresql://u:p@ep-x.neon.tech/db?sslmode=require")
    assert settings.database_url == "postgresql+psycopg://u:p@ep-x.neon.tech/db?sslmode=require"

    legacy = Settings(app_env="development", database_url="postgres://u:p@localhost/db")
    assert legacy.database_url == "postgresql+psycopg://u:p@localhost/db"

    explicit = Settings(app_env="development", database_url="postgresql+psycopg://u:p@localhost/db")
    assert explicit.database_url == "postgresql+psycopg://u:p@localhost/db"


def test_csrf_is_required_for_unsafe_methods(admin_client, admin_user):
    body = {"full_name": "Renamed Administrator"}
    url = f"/api/users/{admin_user.id}"

    missing = admin_client.patch(url, json=body)
    assert missing.status_code == 403
    assert missing.json()["error"]["code"] == "csrf_failed"

    mismatched = admin_client.patch(url, json=body, headers={"X-CSRF-Token": "not-the-cookie-value"})
    assert mismatched.status_code == 403
    assert mismatched.json()["error"]["code"] == "csrf_failed"

    assert admin_client.get("/api/auth/me").status_code == 200
    accepted = admin_client.patch(url, json=body, headers=csrf_headers(admin_client))
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["full_name"] == "Renamed Administrator"


def test_expired_and_idle_sessions_are_rejected(admin_client, admin_user, db):
    old = db.scalar(select(AuthSession).where(AuthSession.user_id == admin_user.id))
    old.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    assert admin_client.get("/api/auth/me").status_code == 401

    relogin = login(admin_client, admin_user.email)
    assert relogin.status_code == 200
    idle = db.scalars(
        select(AuthSession).where(AuthSession.user_id == admin_user.id).order_by(AuthSession.id.desc())
    ).first()
    assert idle is not None
    idle.last_seen_at = utcnow() - timedelta(minutes=get_settings().session_idle_minutes + 1)
    db.commit()

    assert admin_client.get("/api/auth/me").status_code == 401
    db.refresh(idle)
    assert idle.revoked_at is not None


def test_pagination_bounds_are_validated(admin_client):
    assert admin_client.get("/api/users", params={"page_size": 101}).status_code == 422
    assert admin_client.get("/api/users", params={"page": 0}).status_code == 422
    within = admin_client.get("/api/users", params={"page_size": 100, "page": 1})
    assert within.status_code == 200


def test_admin_manages_faculty_accounts_and_deactivation(admin_client, db):
    payload = {
        "employee_id": "FAC-CS-901",
        "full_name": "Nisha Rao",
        "email": "nisha.rao@example.edu",
        "department": "Computer Science",
        "designation": "Assistant Professor",
    }
    created = admin_client.post("/api/faculty", json=payload, headers=csrf_headers(admin_client))
    assert created.status_code == 201, created.text
    faculty_id = created.json()["id"]
    assert created.json()["status"] == "active"

    duplicate = admin_client.post("/api/faculty", json=payload, headers=csrf_headers(admin_client))
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "duplicate_employee_id"

    account = admin_client.post(f"/api/faculty/{faculty_id}/account", headers=csrf_headers(admin_client))
    assert account.status_code == 200, account.text
    assert "/reset-password?token=" in account.json()["reset"]["reset_url"]
    user_id = account.json()["user"]["id"]
    assert admin_client.post(f"/api/faculty/{faculty_id}/account",
                             headers=csrf_headers(admin_client)).status_code == 409

    updated = admin_client.patch(f"/api/faculty/{faculty_id}", json={"designation": "Professor"},
                                 headers=csrf_headers(admin_client))
    assert updated.status_code == 200
    assert updated.json()["designation"] == "Professor"

    deactivated = admin_client.post(f"/api/faculty/{faculty_id}/deactivate",
                                    json={"reason": "Retired from the department"},
                                    headers=csrf_headers(admin_client))
    assert deactivated.status_code == 200
    assert deactivated.json()["status"] == "inactive"
    assert db.get(User, user_id).is_active is False
    listed = admin_client.get("/api/faculty", params={"status": "inactive"}).json()
    assert [row["employee_id"] for row in listed["items"]] == ["FAC-CS-901"]

    audit = db.scalars(select(AuditLog).where(AuditLog.action == "faculty.deactivate")).one()
    assert audit.reason == "Retired from the department"
    assert audit.before["status"] == "active"
    assert audit.after["status"] == "inactive"


def test_audit_rows_capture_actor_request_and_target(admin_client, db, admin_user):
    response = admin_client.patch(
        f"/api/users/{admin_user.id}",
        json={"full_name": "Audited Administrator"},
        headers={**csrf_headers(admin_client), "X-Request-ID": "audit-test-12345678"},
    )
    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "audit-test-12345678"

    entry = db.scalars(
        select(AuditLog).where(AuditLog.action == "user.update").order_by(AuditLog.id.desc())
    ).first()
    assert entry is not None
    assert entry.actor_user_id == admin_user.id
    assert entry.actor_role == "admin"
    assert entry.entity_id == str(admin_user.id)
    assert entry.request_id == "audit-test-12345678"
    assert entry.ip_address
    assert entry.after["full_name"] == "Audited Administrator"


def test_create_admin_cli_bootstraps_without_echoing_the_password(monkeypatch, db):
    answers = iter(["BootstrapPassw0rd!", "BootstrapPassw0rd!"])
    monkeypatch.setattr("app.cli.getpass.getpass", lambda _prompt: next(answers))

    assert cli_main(["create-admin", "--email", "bootstrap@example.edu", "--name", "Bootstrap Admin"]) == 0
    user = db.scalar(select(User).where(User.email == "bootstrap@example.edu"))
    assert user is not None and user.role_name == "admin"
    assert verify_password(user.password_hash, "BootstrapPassw0rd!")
    assert db.scalars(select(AuditLog).where(AuditLog.action == "user.create_admin")).one()

    assert cli_main(["create-admin", "--email", "bootstrap@example.edu"]) == 1

    weak = iter(["short", "short"])
    monkeypatch.setattr("app.cli.getpass.getpass", lambda _prompt: next(weak))
    assert cli_main(["create-admin", "--email", "weak@example.edu"]) == 2
    assert db.scalar(select(User).where(User.email == "weak@example.edu")) is None
