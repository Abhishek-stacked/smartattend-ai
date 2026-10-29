import os
import uuid

os.environ["APP_ENV"] = "test"
os.environ["COOKIE_SECURE"] = "false"
os.environ["PRIMARY_ADMIN_EMAIL"] = "admin@example.edu"

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import inspect, text  # noqa: E402

from app.core.config import BACKEND_DIR, get_settings  # noqa: E402
from app.core.database import SessionLocal, engine  # noqa: E402
from app.core.ratelimit import limiter  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Role, User  # noqa: E402
from app.models.user import ROLE_IDS  # noqa: E402
from app.services import settings_service  # noqa: E402

PASSWORD = "TestPassw0rd!23"
_KEEP = {"roles", "application_settings", "alembic_version"}


@pytest.fixture(scope="session", autouse=True)
def migrated_database():
    settings = get_settings()
    assert settings.app_env == "test"
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.attributes["database_url"] = settings.database_url
    config.attributes["configure_logger"] = False
    command.upgrade(config, "head")
    yield


@pytest.fixture(autouse=True)
def clean_database(migrated_database):
    with engine.begin() as conn:
        tables = [t for t in inspect(conn).get_table_names() if t not in _KEEP]
        if tables:
            conn.execute(text(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE"))
    with SessionLocal() as db:
        settings_service.seed_defaults(db)
        db.commit()
    limiter.reset()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def app_instance():
    return app


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


def make_user(db, role: str = "admin", email: str | None = None, password: str = PASSWORD,
              is_active: bool = True) -> User:
    user = User(
        email=email or f"{role}-{uuid.uuid4().hex[:10]}@example.edu",
        full_name=f"Test {role.title()}",
        role_id=ROLE_IDS[role],
        password_hash=hash_password(password),
        is_active=is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def login(client: TestClient, email: str, password: str = PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def csrf_headers(client: TestClient) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies.get("sa_csrf", "")}


@pytest.fixture
def admin_user(db):
    return make_user(db, "admin", email="admin@example.edu")


@pytest.fixture
def student_user(db):
    return make_user(db, "student")


@pytest.fixture
def admin_client(client, admin_user):
    assert login(client, admin_user.email).status_code == 200
    return client


def role_names(db):
    return {r.name for r in db.query(Role).all()}
