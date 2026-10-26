from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.access import faculty_id_or_none, staff_scope
from app.api.deps import PageParams, page_params
from app.core.database import get_db
from app.models import User
from app.models.attendance import LIVENESS_STATUSES, RECOGNITION_OUTCOMES, REVIEW_STATUSES
from app.models.user import ROLE_ADMIN
from app.schemas.common import Page, paginate
from app.schemas.review import RecognitionEventOut, ResolveEventIn, ResolveEventOut
from app.services import review_service

router = APIRouter(prefix="/recognition", tags=["review"])


@router.get("/events", response_model=Page[RecognitionEventOut])
def list_events(
    status_filter: str | None = Query(None, alias="status"),
    session_id: int | None = None,
    outcome: str | None = None,
    liveness_status: str | None = None,
    paging: PageParams = Depends(page_params),
    actor: User = Depends(staff_scope),
    db: Session = Depends(get_db),
):
    if status_filter and status_filter not in REVIEW_STATUSES:
        status_filter = "__invalid__"
    if outcome and outcome not in RECOGNITION_OUTCOMES:
        outcome = "__invalid__"
    if liveness_status and liveness_status not in LIVENESS_STATUSES:
        liveness_status = "__invalid__"
    scope = None if actor.role_name == ROLE_ADMIN else faculty_id_or_none(actor)
    stmt = review_service.search_events(
        db, faculty_id=scope, review_status=status_filter, session_id=session_id,
        outcome=outcome, liveness_status=liveness_status,
    )
    items, total = paginate(db, stmt, paging.page, paging.page_size)
    return Page(items=[RecognitionEventOut(**review_service.event_out(e)) for e in items], total=total,
                page=paging.page, page_size=paging.page_size)


@router.post("/events/{event_id}/resolve", response_model=ResolveEventOut)
def resolve_event(event_id: int, body: ResolveEventIn, request: Request,
                  actor: User = Depends(staff_scope), db: Session = Depends(get_db)):
    event = review_service.get_event(db, event_id, actor)
    event, record = review_service.resolve(db, event, body.action, body.note.strip(), actor, request)
    return ResolveEventOut(
        event_id=event.id,
        review_status=event.review_status,
        record_id=record.id if record else None,
        record_status=record.status if record else None,
    )
