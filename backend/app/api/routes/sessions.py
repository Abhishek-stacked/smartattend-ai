from datetime import date

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api.access import can_view_session, faculty_id_or_none, staff_scope, student_or_forbidden
from app.api.deps import PageParams, page_params, require_roles
from app.core.database import get_db
from app.core.errors import not_found
from app.models import User
from app.models.attendance import SESSION_STATUSES
from app.models.user import ROLE_ADMIN
from app.schemas.common import Page, paginate
from app.schemas.session import (
    ManualMarkIn,
    ReopenIn,
    RosterEntry,
    SelfMarkingLockIn,
    SelfMarkingSettingIn,
    SelfMarkOut,
    SessionCounts,
    SessionIn,
    SessionOut,
    StudentSessionOut,
    SessionUpdate,
    TransitionIn,
)
from app.services import attendance_service, session_service

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _visible(db: Session, user: User, session_id: int):
    session = session_service.get_session(db, session_id)
    if not can_view_session(user, session):
        raise not_found("Session")
    return session


def _out(db: Session, session) -> SessionOut:
    return SessionOut(**session_service.out(db, session))


@router.get("", response_model=Page[SessionOut])
def list_sessions(
    course_id: int | None = None,
    status_filter: str | None = Query(None, alias="status"),
    date_from: date | None = None,
    date_to: date | None = None,
    paging: PageParams = Depends(page_params),
    user: User = Depends(staff_scope),
    db: Session = Depends(get_db),
):
    if status_filter and status_filter not in SESSION_STATUSES:
        status_filter = "__invalid__"
    scope = None if user.role_name == ROLE_ADMIN else faculty_id_or_none(user)
    stmt = session_service.search_sessions(db, course_id=course_id, status=status_filter, date_from=date_from,
                                          date_to=date_to, faculty_id=scope)
    items, total = paginate(db, stmt, paging.page, paging.page_size)
    counts = attendance_service.compute_counts_many(db, [s.id for s in items])
    return Page(items=[SessionOut(**session_service.out(db, s, counts[s.id])) for s in items], total=total,
                page=paging.page, page_size=paging.page_size)


@router.post("", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def create_session(body: SessionIn, request: Request, actor: User = Depends(staff_scope),
                   db: Session = Depends(get_db)):
    scope = None if actor.role_name == ROLE_ADMIN else faculty_id_or_none(actor)
    session = session_service.create_session(db, body, actor, request, faculty_scope=scope)
    return _out(db, session)


@router.get("/mine", response_model=list[StudentSessionOut])
def my_sessions(user: User = Depends(student_or_forbidden), db: Session = Depends(get_db)):
    return [StudentSessionOut(**row) for row in session_service.sessions_for_student(db, user.student.id)]


@router.get("/{session_id}", response_model=SessionOut)
def get_session(session_id: int, user: User = Depends(staff_scope), db: Session = Depends(get_db)):
    return _out(db, _visible(db, user, session_id))


@router.patch("/{session_id}", response_model=SessionOut)
def update_session(session_id: int, body: SessionUpdate, request: Request,
                   actor: User = Depends(staff_scope), db: Session = Depends(get_db)):
    session = _visible(db, actor, session_id)
    session = session_service.update_session(db, session, body, actor, request)
    return _out(db, session)


@router.get("/{session_id}/roster", response_model=list[RosterEntry])
def get_roster(session_id: int, user: User = Depends(staff_scope), db: Session = Depends(get_db)):
    session = _visible(db, user, session_id)
    return [RosterEntry(**r) for r in session_service.roster(db, session)]


@router.post("/{session_id}/attendance", response_model=RosterEntry, status_code=status.HTTP_201_CREATED)
def mark_attendance(session_id: int, body: ManualMarkIn, request: Request,
                    actor: User = Depends(staff_scope), db: Session = Depends(get_db)):
    session = _visible(db, actor, session_id)
    record = attendance_service.mark_manual(db, session.id, body.student_id, body.status, body.reason, actor, request)
    for entry in session_service.roster(db, session):
        if entry["student_id"] == record.student_id:
            return RosterEntry(**entry)
    raise not_found("Student")


@router.post("/{session_id}/start", response_model=SessionOut)
def start_session(session_id: int, request: Request, actor: User = Depends(staff_scope),
                  db: Session = Depends(get_db)):
    _visible(db, actor, session_id)
    return _out(db, session_service.start(db, session_id, actor, request))


@router.post("/{session_id}/pause", response_model=SessionOut)
def pause_session(session_id: int, request: Request, actor: User = Depends(staff_scope),
                  db: Session = Depends(get_db)):
    _visible(db, actor, session_id)
    return _out(db, session_service.pause(db, session_id, actor, request))


@router.post("/{session_id}/resume", response_model=SessionOut)
def resume_session(session_id: int, request: Request, actor: User = Depends(staff_scope),
                   db: Session = Depends(get_db)):
    _visible(db, actor, session_id)
    return _out(db, session_service.resume(db, session_id, actor, request))


@router.post("/{session_id}/close", response_model=SessionOut)
def close_session(session_id: int, request: Request, actor: User = Depends(staff_scope),
                  db: Session = Depends(get_db)):
    _visible(db, actor, session_id)
    return _out(db, session_service.close(db, session_id, actor, request))


@router.post("/{session_id}/finalize", response_model=SessionOut)
def finalize_session(session_id: int, request: Request, actor: User = Depends(staff_scope),
                     db: Session = Depends(get_db)):
    _visible(db, actor, session_id)
    return _out(db, session_service.finalize(db, session_id, actor, request))


@router.post("/{session_id}/cancel", response_model=SessionOut)
def cancel_session(session_id: int, body: TransitionIn, request: Request,
                   actor: User = Depends(staff_scope), db: Session = Depends(get_db)):
    _visible(db, actor, session_id)
    return _out(db, session_service.cancel(db, session_id, actor, body.reason, request))


@router.post("/{session_id}/reopen", response_model=SessionOut)
def reopen_session(session_id: int, body: ReopenIn, request: Request,
                   actor: User = Depends(staff_scope), db: Session = Depends(get_db)):
    _visible(db, actor, session_id)
    return _out(db, session_service.reopen(db, session_id, actor, body.reason, request))


@router.get("/{session_id}/stats", response_model=SessionCounts)
def session_stats(session_id: int, user: User = Depends(staff_scope), db: Session = Depends(get_db)):
    session = _visible(db, user, session_id)
    return SessionCounts(**attendance_service.compute_counts(db, session.id))


@router.patch("/{session_id}/self-marking", response_model=SessionOut)
def set_self_marking(session_id: int, body: SelfMarkingSettingIn, request: Request,
                     actor: User = Depends(require_roles(ROLE_ADMIN)), db: Session = Depends(get_db)):
    session = session_service.get_session(db, session_id)
    session = session_service.set_self_marking_enabled(db, session, body.enabled, actor, request)
    return _out(db, session)


@router.patch("/{session_id}/participants/{student_id}/self-marking", response_model=list[RosterEntry])
def set_participant_self_marking(session_id: int, student_id: int, body: SelfMarkingLockIn, request: Request,
                                  actor: User = Depends(staff_scope), db: Session = Depends(get_db)):
    session = _visible(db, actor, session_id)
    session_service.set_self_marking_lock(db, session, student_id, body.locked, body.reason, actor, request)
    return [RosterEntry(**entry) for entry in session_service.roster(db, session)]


@router.post("/{session_id}/self-mark", response_model=SelfMarkOut)
def self_mark(session_id: int, request: Request, actor: User = Depends(student_or_forbidden),
              db: Session = Depends(get_db)):
    session = session_service.get_session(db, session_id)
    record, created = attendance_service.mark_self(db, session.id, actor.student.id, actor, request)
    return SelfMarkOut(session_id=session.id, student_id=record.student_id, status=record.status,
                       source=record.source, marked_at=record.marked_at, already_marked=not created)
