from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import ApplicationSetting, User
from app.services import audit_service


@dataclass(frozen=True)
class SettingSpec:
    default: Any
    kind: type
    min: float | None = None
    max: float | None = None
    choices: tuple[str, ...] | None = None
    client_visible: bool = False
    description: str = ""


SPECS: dict[str, SettingSpec] = {
    "recognition_threshold": SettingSpec(0.42, float, 0.2, 0.95, description="Cosine similarity needed to accept a match"),
    "low_confidence_margin": SettingSpec(0.07, float, 0.0, 0.3, description="Band below threshold flagged for review"),
    "ambiguity_margin": SettingSpec(0.05, float, 0.0, 0.3, description="Minimum gap between best and second-best match"),
    "liveness_policy": SettingSpec("off", str, choices=("off", "flag", "enforce"), client_visible=True,
                                   description="Liveness use for new sessions (experimental model)"),
    "liveness_threshold": SettingSpec(0.80, float, 0.5, 0.99, description="Real-face score needed to pass liveness"),
    "frame_interval_ms": SettingSpec(1000, int, 300, 5000, client_visible=True, description="Camera frame sampling period"),
    "recognition_cooldown_s": SettingSpec(30, int, 0, 600, description="Suppress repeated events for the same person"),
    "max_faces_per_frame": SettingSpec(5, int, 1, 10, description="More faces than this are flagged for review"),
    "min_face_px": SettingSpec(80, int, 40, 400, client_visible=True, description="Minimum face box size in pixels"),
    "blur_threshold": SettingSpec(60.0, float, 5.0, 500.0, description="Minimum Laplacian variance of the face crop"),
    "brightness_min": SettingSpec(50, int, 0, 255, description="Minimum mean brightness of the face crop"),
    "brightness_max": SettingSpec(210, int, 0, 255, description="Maximum mean brightness of the face crop"),
    "default_late_after_min": SettingSpec(10, int, 0, 240, client_visible=True, description="Minutes after start before arrivals are late"),
    "default_window_min": SettingSpec(30, int, 1, 480, client_visible=True, description="Minutes after start that marking is allowed"),
    "faculty_can_correct": SettingSpec(True, bool, client_visible=True, description="Faculty may correct records in own courses"),
    "biometric_retention_days": SettingSpec(30, int, 0, 3650, description="Days after deactivation before templates are purged"),
}


def _coerce(key: str, value: Any) -> Any:
    spec = SPECS.get(key)
    if spec is None:
        raise AppError(422, "unknown_setting", f"Unknown setting '{key}'")
    try:
        if spec.kind is bool:
            if not isinstance(value, bool):
                raise TypeError
            v: Any = value
        elif spec.kind is int:
            if isinstance(value, bool) or float(value) != int(value):
                raise TypeError
            v = int(value)
        elif spec.kind is float:
            if isinstance(value, bool):
                raise TypeError
            v = float(value)
        else:
            v = str(value)
    except (TypeError, ValueError):
        raise AppError(422, "invalid_setting", f"'{key}' must be of type {spec.kind.__name__}")
    if spec.choices and v not in spec.choices:
        raise AppError(422, "invalid_setting", f"'{key}' must be one of {', '.join(spec.choices)}")
    if spec.min is not None and v < spec.min or spec.max is not None and v > spec.max:
        raise AppError(422, "invalid_setting", f"'{key}' must be between {spec.min} and {spec.max}")
    return v


def get_all(db: Session) -> dict[str, Any]:
    stored = {s.key: s.value for s in db.scalars(select(ApplicationSetting))}
    return {k: stored.get(k, spec.default) for k, spec in SPECS.items()}


def get(db: Session, key: str) -> Any:
    row = db.get(ApplicationSetting, key)
    return row.value if row is not None else SPECS[key].default


def client_settings(db: Session) -> dict[str, Any]:
    values = get_all(db)
    return {k: v for k, v in values.items() if SPECS[k].client_visible}


def update(db: Session, changes: dict[str, Any], actor: User, request=None) -> dict[str, Any]:
    if not changes:
        raise AppError(422, "invalid_setting", "No settings were provided")
    current = get_all(db)
    merged = dict(current)
    for key, value in changes.items():
        merged[key] = _coerce(key, value)
    if merged["brightness_min"] >= merged["brightness_max"]:
        raise AppError(422, "invalid_setting", "brightness_min must be lower than brightness_max")
    before = {k: current[k] for k in changes}
    for key in changes:
        row = db.get(ApplicationSetting, key)
        if row is None:
            db.add(ApplicationSetting(key=key, value=merged[key], updated_by_user_id=actor.id))
        else:
            row.value = merged[key]
            row.updated_by_user_id = actor.id
    audit_service.record(db, actor=actor, action="settings.update", entity_type="application_settings",
                         before=before, after={k: merged[k] for k in changes}, request=request)
    db.commit()
    return merged


def seed_defaults(db: Session) -> None:
    existing = set(db.scalars(select(ApplicationSetting.key)))
    for key, spec in SPECS.items():
        if key not in existing:
            db.add(ApplicationSetting(key=key, value=spec.default))
