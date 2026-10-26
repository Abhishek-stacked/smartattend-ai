from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.api.uploads import read_image_upload
from app.core.database import get_db
from app.core.errors import forbidden
from app.models import User
from app.models.user import ROLE_ADMIN, ROLE_STUDENT
from app.schemas.biometric import (
    ConsentIn,
    ConsentOut,
    DeleteTemplatesIn,
    EnrollOut,
    EnrollmentStatusOut,
    PolicyOut,
)
from app.services import biometric_policy, biometric_service, settings_service

router = APIRouter(tags=["biometric"])


def _student_or_self(db: Session, user: User, student_id: int):
    student = biometric_service.get_student(db, student_id)
    if user.role_name == ROLE_ADMIN:
        return student
    if user.role_name == ROLE_STUDENT and user.student and user.student.id == student.id:
        return student
    raise forbidden("You can only view or manage your own biometric status")


@router.get("/privacy/policy", response_model=PolicyOut)
def get_policy(_: User = Depends(current_user), db: Session = Depends(get_db)):
    return {
        "policy_version": biometric_policy.POLICY_VERSION,
        "title": biometric_policy.POLICY_TITLE,
        "sections": [{"heading": s.heading, "body": s.body} for s in biometric_policy.SECTIONS],
        "retention_days": settings_service.get(db, "biometric_retention_days"),
    }


@router.get("/enrollment/{student_id}", response_model=EnrollmentStatusOut)
def get_enrollment(student_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    student = _student_or_self(db, user, student_id)
    return biometric_service.enrollment_status(db, student)


@router.post("/enrollment/{student_id}/consent", response_model=ConsentOut)
def record_consent(student_id: int, body: ConsentIn, request: Request,
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    student = _student_or_self(db, user, student_id)
    capture_method = (biometric_service.SELF_CAPTURE_METHOD if user.role_name == ROLE_STUDENT
                      else biometric_service.CAPTURE_METHOD)
    row = biometric_service.record_consent(db, student, user, body.policy_version,
                                           body.participant_confirmed, request,
                                           capture_method=capture_method)
    return biometric_service.consent_out(row)


@router.post("/enrollment/{student_id}", response_model=EnrollOut)
def enroll(student_id: int, request: Request,
           samples: list[UploadFile] = File(...),
           replace: bool = Form(False),
           user: User = Depends(current_user),
           db: Session = Depends(get_db)):
    student = _student_or_self(db, user, student_id)
    images = [read_image_upload(sample) for sample in samples]
    return biometric_service.enroll(db, student, images, replace, user, request)


@router.post("/biometrics/{student_id}/delete")
def delete_templates(student_id: int, body: DeleteTemplatesIn, request: Request,
                     user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role_name not in (ROLE_ADMIN, ROLE_STUDENT):
        raise forbidden()
    student = _student_or_self(db, user, student_id)
    return biometric_service.delete_templates(db, student, user, withdraw_consent=body.withdraw_consent,
                                              reason=body.reason.strip(), request=request)
