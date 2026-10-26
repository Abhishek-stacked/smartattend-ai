from sqlalchemy import select

from app.models import ApplicationSetting, AuditLog
from app.services import settings_service
from tests.conftest import csrf_headers


def test_settings_require_admin(client, student_user):
    from tests.conftest import login
    login(client, student_user.email)
    assert client.get("/api/settings").status_code == 403


def test_admin_can_read_settings_with_metadata(admin_client):
    r = admin_client.get("/api/settings")
    assert r.status_code == 200
    items = {i["key"]: i for i in r.json()["items"]}
    assert items["recognition_threshold"]["value"] == 0.42
    assert items["liveness_policy"]["choices"] == ["off", "flag", "enforce"]
    assert items["recognition_threshold"]["min"] == 0.2


def test_settings_update_is_persisted_and_audited(admin_client, db, admin_user):
    r = admin_client.patch("/api/settings", json={"liveness_policy": "flag", "recognition_threshold": 0.46},
                           headers=csrf_headers(admin_client))
    assert r.status_code == 200
    values = {i["key"]: i["value"] for i in r.json()["items"]}
    assert values["liveness_policy"] == "flag" and values["recognition_threshold"] == 0.46

    db.expire_all()
    assert db.get(ApplicationSetting, "liveness_policy").value == "flag"
    audit = db.scalar(select(AuditLog).where(AuditLog.action == "settings.update").order_by(AuditLog.id.desc()))
    assert audit.actor_user_id == admin_user.id
    assert audit.after["liveness_policy"] == "flag"


def test_invalid_settings_are_rejected(admin_client):
    h = csrf_headers(admin_client)
    assert admin_client.patch("/api/settings", json={"liveness_policy": "sometimes"}, headers=h).status_code == 422
    assert admin_client.patch("/api/settings", json={"recognition_threshold": 5}, headers=h).status_code == 422
    assert admin_client.patch("/api/settings", json={"unknown_key": 1}, headers=h).status_code == 422
    assert admin_client.patch("/api/settings", json={}, headers=h).status_code == 422
    bad_range = admin_client.patch("/api/settings", json={"brightness_min": 200, "brightness_max": 100}, headers=h)
    assert bad_range.status_code == 422


def test_brightness_bounds_compare_against_stored_values(admin_client, db):
    h = csrf_headers(admin_client)
    assert admin_client.patch("/api/settings", json={"brightness_max": 240}, headers=h).status_code == 200
    r = admin_client.patch("/api/settings", json={"brightness_min": 245}, headers=h)
    assert r.status_code == 422


def test_client_settings_expose_only_nonsensitive_keys(client, student_user):
    from tests.conftest import login
    login(client, student_user.email)
    body = client.get("/api/settings/client").json()
    expected = {k for k, spec in settings_service.SPECS.items() if spec.client_visible} | {"timezone"}
    assert set(body) == expected
    assert "recognition_threshold" not in body
    assert "liveness_policy" in body and "frame_interval_ms" in body
