from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api.access import faculty_id_or_none, staff_scope, student_or_forbidden
from app.api.deps import PageParams, current_user, page_params
from app.core.database import get_db
from app.core.errors import forbidden
from app.models import User
from app.models.attendance import CORRECTION_STATUSES
from app.models.user import ROLE_ADMIN, ROLE_FACULTY, ROLE_STUDENT
from app.schemas.common import Page, paginate
from app.schemas.review import (
    CorrectionActionIn,
    CorrectionOut,
    CorrectionRequestIn,
    CorrectionWithdrawIn,
)
from app.services import correction_service

router = APIRouter(prefix="/corrections", tags=["corrections"])


@router.get("", response_model=Page[CorrectionOut])
def list_requests(
    status_filter: str | None = Query(None, alias="status"),
    session_id: int | None = None,
    paging: PageParams = Depends(page_params),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if status_filter and status_filter not in CORRECTION_STATUSES:
        status_filter = "__invalid__"
    if user.role_name == ROLE_STUDENT:
        if user.student is None:
            raise forbidden()
        student_id, scope = user.student.id, None
    elif user.role_name == ROLE_ADMIN:
        student_id, scope = None, None
    elif user.role_name == ROLE_FACULTY:
        if user.faculty is None:
            raise forbidden("Your account is not linked to a faculty profile")
        student_id, scope = None, faculty_id_or_none(user)
    else:
        raise forbidden()
    stmt = correction_service.search(db, student_id=student_id, faculty_id=scope, status=status_filter,
                                     session_id=session_id)
    items, total = paginate(db, stmt, paging.page, paging.page_size)
    return Page(items=[CorrectionOut(**correction_service.out(db, row)) for row in items], total=total,
                page=paging.page, page_size=paging.page_size)


@router.post("", response_model=CorrectionOut, status_code=status.HTTP_201_CREATED)
def create_request(body: CorrectionRequestIn, request: Request,
                   user: User = Depends(student_or_forbidden), db: Session = Depends(get_db)):
    row = correction_service.create(
        db, user.student, session_id=body.session_id, requested_status=body.requested_status,
        reason=body.reason.strip(), actor=user, request=request,
    )
    return CorrectionOut(**correction_service.out(db, row))


@router.get("/{request_id}", response_model=CorrectionOut)
def get_request(request_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = correction_service.get_request(db, request_id, user)
    return CorrectionOut(**correction_service.out(db, row))


@router.post("/{request_id}/withdraw", response_model=CorrectionOut)
def withdraw(request_id: int, body: CorrectionWithdrawIn, request: Request,
             user: User = Depends(student_or_forbidden), db: Session = Depends(get_db)):
    row = correction_service.get_request(db, request_id, user)
    row = correction_service.withdraw(db, row, user, (body.reason or "").strip() or None, request)
    return CorrectionOut(**correction_service.out(db, row))


@router.post("/{request_id}/approve", response_model=CorrectionOut)
def approve(request_id: int, body: CorrectionActionIn, request: Request,
            actor: User = Depends(staff_scope), db: Session = Depends(get_db)):
    row = correction_service.get_request(db, request_id, actor)
    row = correction_service.approve(db, row, actor, body.note.strip(), request)
    return CorrectionOut(**correction_service.out(db, row))


@router.post("/{request_id}/reject", response_model=CorrectionOut)
def reject(request_id: int, body: CorrectionActionIn, request: Request,
           actor: User = Depends(staff_scope), db: Session = Depends(get_db)):
    row = correction_service.get_request(db, request_id, actor)
    row = correction_service.reject(db, row, actor, body.note.strip(), request)
    return CorrectionOut(**correction_service.out(db, row))
