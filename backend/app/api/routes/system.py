from typing import Any

from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import current_user, require_roles
from app.core.config import get_settings
from app.core.database import get_db
from app.models import User
from app.models.user import ROLE_ADMIN
from app.services import settings_service

router = APIRouter(tags=["system"])

MODEL_FILES = {
    "face_detection": "face_detection_yunet_2023mar.onnx",
    "face_recognition": "face_recognition_sface_2021dec.onnx",
    "liveness": "minifasnet_v2_2.7_80x80.onnx",
}


def _describe(values: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for key, spec in settings_service.SPECS.items():
        out.append({
            "key": key,
            "value": values[key],
            "default": spec.default,
            "type": spec.kind.__name__,
            "min": spec.min,
            "max": spec.max,
            "choices": list(spec.choices) if spec.choices else None,
            "description": spec.description,
        })
    return out


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict[str, Any]:
    try:
        db.execute(text("SELECT 1"))
        database = "ok"
    except Exception:
        database = "unavailable"
    model_dir = get_settings().model_path
    models = {name: ("present" if (model_dir / f).is_file() else "missing") for name, f in MODEL_FILES.items()}
    return {"status": "ok" if database == "ok" else "degraded", "database": database, "models": models}


@router.get("/settings")
def get_settings_route(_: User = Depends(require_roles(ROLE_ADMIN)), db: Session = Depends(get_db)):
    return {"items": _describe(settings_service.get_all(db))}


@router.patch("/settings")
def update_settings(request: Request, changes: dict[str, Any] = Body(..., examples=[{"recognition_threshold": 0.45}]),
                    actor: User = Depends(require_roles(ROLE_ADMIN)), db: Session = Depends(get_db)):
    values = settings_service.update(db, changes, actor, request)
    return {"items": _describe(values)}


@router.get("/settings/client")
def client_settings(_: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    return settings_service.client_settings(db) | {"timezone": get_settings().app_timezone}
