from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditLog, User

_SENSITIVE = {"password", "password_hash", "token", "token_hash", "embedding", "ciphertext", "nonce", "csrf"}


def _scrub(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: ("[redacted]" if any(s in k.lower() for s in _SENSITIVE) else _scrub(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def record(
    db: Session,
    *,
    actor: User | None,
    action: str,
    entity_type: str,
    entity_id: Any = None,
    before: dict | None = None,
    after: dict | None = None,
    reason: str | None = None,
    request: Request | None = None,
) -> AuditLog:
    """Adds an audit row to the current transaction (caller commits)."""
    entry = AuditLog(
        actor_user_id=actor.id if actor else None,
        actor_role=actor.role_name if actor else None,
        action=action,
        entity_type=entity_type,
        entity_id=None if entity_id is None else str(entity_id),
        before=_scrub(before) if before is not None else None,
        after=_scrub(after) if after is not None else None,
        reason=reason,
        ip_address=(request.client.host if request and request.client else None),
        request_id=(getattr(request.state, "request_id", None) if request else None),
    )
    db.add(entry)
    return entry


def snapshot(obj: Any, fields: tuple[str, ...]) -> dict:
    return {f: _scrub(getattr(obj, f)) for f in fields}
