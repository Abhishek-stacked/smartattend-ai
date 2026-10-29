from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = Field(default="development", pattern="^(development|test|production)$")
    app_timezone: str = "UTC"
    frontend_base_url: str = "http://localhost:5173"
    cors_origins: str = "http://localhost:5173"

    database_url: str
    test_database_url: str | None = None

    session_ttl_minutes: int = Field(default=480, ge=5, le=60 * 24 * 7)
    session_idle_minutes: int = Field(default=60, ge=5, le=60 * 24)
    cookie_secure: bool = False

    biometric_encryption_keys: str = ""

    model_dir: str = "../ai_service/models"
    max_upload_bytes: int = Field(default=2 * 1024 * 1024, ge=64 * 1024, le=10 * 1024 * 1024)

    seed_admin_email: str | None = None
    seed_admin_password: str | None = None

    @field_validator("app_timezone")
    @classmethod
    def _valid_tz(cls, v: str) -> str:
        ZoneInfo(v)
        return v

    @field_validator("database_url", "test_database_url")
    @classmethod
    def _psycopg_driver(cls, v: str | None) -> str | None:
        # Hosted providers (Neon included) hand out driver-less postgresql:// URLs;
        # SQLAlchemy would then look for psycopg2, which this project does not install.
        if v and v.startswith(("postgresql://", "postgres://")):
            return "postgresql+psycopg://" + v.split("://", 1)[1]
        return v

    @model_validator(mode="after")
    def _isolate_test_database(self) -> "Settings":
        if self.app_env == "test":
            if not self.test_database_url:
                raise ValueError("TEST_DATABASE_URL must be set when APP_ENV=test")
            if self.test_database_url == self.database_url:
                raise ValueError("TEST_DATABASE_URL must differ from DATABASE_URL")
            self.database_url = self.test_database_url
        return self

    @model_validator(mode="after")
    def _production_hardening(self) -> "Settings":
        if self.app_env == "production" and not self.biometric_encryption_keys.strip():
            raise ValueError("BIOMETRIC_ENCRYPTION_KEYS must be set when APP_ENV=production")
        return self

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.app_timezone)

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def model_path(self) -> Path:
        p = Path(self.model_dir)
        return p if p.is_absolute() else (BACKEND_DIR / p).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
