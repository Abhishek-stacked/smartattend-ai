"""Consent, enrolment and gallery handling for facial templates.

Embeddings are encrypted before they are stored and are never returned or logged.
"""

import logging
from functools import lru_cache
from pathlib import Path

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from ai_service import (
    EMBEDDING_DIM,
    MODEL_NAME,
    MODEL_VERSION,
    FaceAnalyzer,
    FrameAnalysis,
    ImageDecodeError,
    ModelUnavailable,
    QualityPolicy,
    cosine,
    decode_image,
)
from ai_service.liveness import LIVENESS_MODEL_NAME, LIVENESS_MODEL_VERSION, LivenessDetector, LivenessResult
from app.core.config import get_settings
from app.core.crypto import EncryptedTemplate, get_cipher
from app.core.errors import AppError, conflict, not_found
from app.models import BiometricConsent, BiometricTemplate, SessionParticipant, Student, User
from app.models.base import utcnow
from app.services import audit_service, settings_service
from app.services.biometric_policy import POLICY_VERSION

log = logging.getLogger("smartattend.biometric")

CAPTURE_METHOD = "staff_assisted"
SELF_CAPTURE_METHOD = "self_service"
MIN_SAMPLES = 3
MAX_SAMPLES = 5
CONSISTENCY_MIN = 0.35
QUALITY_ERROR_CODES = ("face_too_small", "blurry", "too_dark", "too_bright")


@lru_cache(maxsize=1)
def _analyzer_for(model_dir: str) -> FaceAnalyzer:
    return FaceAnalyzer(Path(model_dir))


def get_analyzer() -> FaceAnalyzer:
    return _analyzer_for(str(get_settings().model_path))


@lru_cache(maxsize=1)
def _liveness_for(model_dir: str) -> LivenessDetector:
    return LivenessDetector(Path(model_dir))


def get_liveness_detector() -> LivenessDetector:
    return _liveness_for(str(get_settings().model_path))


def liveness_available() -> bool:
    return get_liveness_detector().available()


def decode_frame(data: bytes):
    try:
        return decode_image(data)
    except ImageDecodeError as exc:
        raise AppError(422, "invalid_image", str(exc)) from exc


def quality_policy(db: Session) -> QualityPolicy:
    values = settings_service.get_all(db)
    return QualityPolicy(
        min_face_px=values["min_face_px"],
        blur_threshold=values["blur_threshold"],
        brightness_min=values["brightness_min"],
        brightness_max=values["brightness_max"],
    )


def analyze_frame(db: Session, image, *, embed: bool = True) -> FrameAnalysis:
    try:
        return get_analyzer().analyze(image, quality_policy(db), embed=embed)
    except ModelUnavailable as exc:
        raise AppError(503, "model_unavailable",
                       "The face models are not available on this server. Contact an administrator.") from exc


def analyze(db: Session, data: bytes, *, embed: bool = True) -> FrameAnalysis:
    return analyze_frame(db, decode_frame(data), embed=embed)


def verify_liveness(db: Session, image, faces) -> list[LivenessResult]:
    """Scores one crop per detected face. Missing models produce not_enabled, never a pass."""
    threshold = settings_service.get(db, "liveness_threshold")
    try:
        return get_liveness_detector().verify(image, [face.box for face in faces], threshold)
    except ModelUnavailable as exc:
        log.warning("liveness model unavailable: %s", type(exc).__name__)
        return [LivenessResult("not_enabled", None) for _ in faces]


def consent_out(row: BiometricConsent | None) -> dict | None:
    if row is None:
        return None
    return {
        "status": row.status,
        "policy_version": row.policy_version,
        "capture_method": row.capture_method,
        "granted_at": row.granted_at,
        "withdrawn_at": row.withdrawn_at,
    }


def _latest_consent(db: Session, student_id: int) -> BiometricConsent | None:
    granted = db.scalar(
        select(BiometricConsent).where(
            BiometricConsent.student_id == student_id, BiometricConsent.status == "granted"
        )
    )
    if granted is not None:
        return granted
    return db.scalar(
        select(BiometricConsent)
        .where(BiometricConsent.student_id == student_id)
        .order_by(BiometricConsent.granted_at.desc())
    )


def _granted_consent(db: Session, student_id: int) -> BiometricConsent | None:
    return db.scalar(
        select(BiometricConsent).where(
            BiometricConsent.student_id == student_id, BiometricConsent.status == "granted"
        )
    )


def enrollment_status(db: Session, student: Student) -> dict:
    consent = _latest_consent(db, student.id)
    templates = db.scalars(
        select(BiometricTemplate)
        .where(BiometricTemplate.student_id == student.id)
        .order_by(BiometricTemplate.created_at)
    ).all()
    return {
        "student_id": student.id,
        "consent": consent_out(consent),
        "template_count": len(templates),
        "model": MODEL_NAME,
        "model_version": MODEL_VERSION,
        "enrolled_at": templates[0].created_at if templates else None,
    }


def record_consent(db: Session, student: Student, actor: User, policy_version: str,
                   participant_confirmed: bool, request=None,
                   capture_method: str = CAPTURE_METHOD) -> BiometricConsent:
    if not participant_confirmed:
        raise AppError(422, "consent_required", "The participant must confirm the notice before enrolment")
    if policy_version != POLICY_VERSION:
        raise conflict("policy_version_mismatch",
                       "The consent notice has changed. Show the current notice and ask again.",
                       {"current_version": POLICY_VERSION})
    existing = _granted_consent(db, student.id)
    if existing is not None:
        return existing
    row = BiometricConsent(
        student_id=student.id,
        status="granted",
        policy_version=policy_version,
        capture_method=capture_method,
        recorded_by_user_id=actor.id,
        granted_at=utcnow(),
    )
    db.add(row)
    audit_service.record(db, actor=actor, action="biometric.consent", entity_type="biometric_consent",
                         entity_id=student.id, after={"status": "granted", "policy_version": policy_version},
                         request=request)
    db.commit()
    return row


def _sample_embedding(db: Session, data: bytes, index: int) -> tuple[np.ndarray, dict]:
    analysis = analyze(db, data)
    if not analysis.faces:
        raise AppError(422, "no_face", "No face was found in a sample. Retake it with your face centred.",
                       {"sample": index})
    if len(analysis.faces) > 1:
        raise AppError(422, "multiple_faces", "Each sample must show exactly one face.", {"sample": index})
    face = analysis.faces[0]
    if not face.quality.ok:
        issue = next((i for i in face.quality.issues if i in QUALITY_ERROR_CODES), "poor_quality")
        raise AppError(422, issue, _quality_message(issue), {"sample": index, "quality": face.quality.as_dict()})
    if face.embedding is None or face.embedding.shape != (EMBEDDING_DIM,):
        raise AppError(500, "embedding_failed", "The face could not be converted into a template.")
    return face.embedding, face.quality.as_dict()


def _quality_message(issue: str) -> str:
    return {
        "face_too_small": "Move closer to the camera so the face fills more of the frame.",
        "blurry": "The sample is blurry. Hold still and retake it.",
        "too_dark": "The sample is too dark. Add light in front of the participant.",
        "too_bright": "The sample is overexposed. Reduce backlight or glare.",
    }.get(issue, "The sample did not pass the quality checks.")


def _decrypt_rows(rows) -> list[tuple[int, np.ndarray]]:
    cipher = get_cipher()
    out: list[tuple[int, np.ndarray]] = []
    for row in rows:
        try:
            vector = cipher.decrypt(
                row.student_id, row.model_name, row.model_version,
                EncryptedTemplate(row.key_id, row.nonce, row.ciphertext),
            )
        except Exception as exc:  # noqa: BLE001 - a corrupt row must not block a whole session
            log.warning("template %s could not be decrypted: %s", row.id, type(exc).__name__)
            continue
        if vector.shape == (EMBEDDING_DIM,):
            out.append((row.student_id, vector))
    return out


def gallery_for_session(db: Session, session_id: int) -> dict[int, list[np.ndarray]]:
    participant_ids = select(SessionParticipant.student_id).where(SessionParticipant.session_id == session_id)
    rows = db.scalars(
        select(BiometricTemplate).where(BiometricTemplate.student_id.in_(participant_ids))
    ).all()
    gallery: dict[int, list[np.ndarray]] = {}
    for student_id, vector in _decrypt_rows(rows):
        gallery.setdefault(student_id, []).append(vector)
    return gallery


def enroll(db: Session, student: Student, samples: list[bytes], replace: bool, actor: User,
           request=None) -> dict:
    consent = _granted_consent(db, student.id)
    if consent is None:
        raise conflict("consent_required", "Record the participant's informed consent before enrolling")
    if not MIN_SAMPLES <= len(samples) <= MAX_SAMPLES:
        raise AppError(422, "invalid_samples", f"Provide between {MIN_SAMPLES} and {MAX_SAMPLES} samples")
    existing = db.scalars(
        select(BiometricTemplate).where(BiometricTemplate.student_id == student.id)
    ).all()
    if existing and not replace:
        raise conflict("already_enrolled", "This student already has templates. Submit with replace=true to refresh them.")

    embeddings: list[np.ndarray] = []
    quality: list[dict] = []
    for index, data in enumerate(samples, start=1):
        vector, report = _sample_embedding(db, data, index)
        embeddings.append(vector)
        quality.append(report)

    pairwise = [
        cosine(embeddings[i], embeddings[j])
        for i in range(len(embeddings))
        for j in range(i + 1, len(embeddings))
    ]
    if pairwise and min(pairwise) < CONSISTENCY_MIN:
        raise AppError(422, "inconsistent_samples",
                       "The samples do not look like the same person. Retake them in one sitting.",
                       {"min_similarity": round(min(pairwise), 3)})

    duplicate = _nearest_other_student(db, student.id, embeddings)
    if duplicate is not None:
        raise conflict("possible_duplicate_identity",
                       "These samples closely match another enrolled student. Verify the identity before continuing.",
                       duplicate)

    removed = 0
    if existing:
        removed = len(existing)
        for row in existing:
            db.delete(row)

    cipher = get_cipher()
    now = utcnow()
    for vector, report in zip(embeddings, quality):
        sealed = cipher.encrypt(student.id, MODEL_NAME, MODEL_VERSION, vector)
        db.add(BiometricTemplate(
            student_id=student.id,
            consent_id=consent.id,
            model_name=MODEL_NAME,
            model_version=MODEL_VERSION,
            embedding_dim=EMBEDDING_DIM,
            ciphertext=sealed.ciphertext,
            nonce=sealed.nonce,
            key_id=sealed.key_id,
            quality=report,
            created_by_user_id=actor.id,
            created_at=now,
        ))
    audit_service.record(
        db, actor=actor, action="biometric.enroll", entity_type="biometric_template_set",
        entity_id=student.id,
        before={"template_count": removed} if removed else None,
        after={"template_count": len(embeddings), "model": MODEL_NAME, "model_version": MODEL_VERSION,
               "quality": quality},
        request=request,
    )
    db.commit()
    return {
        "student_id": student.id,
        "template_count": len(embeddings),
        "model": MODEL_NAME,
        "model_version": MODEL_VERSION,
        "enrolled_at": now,
    }


def _nearest_other_student(db: Session, student_id: int, embeddings: list[np.ndarray]) -> dict | None:
    threshold = settings_service.get(db, "recognition_threshold")
    rows = db.scalars(
        select(BiometricTemplate)
        .join(Student, Student.id == BiometricTemplate.student_id)
        .where(BiometricTemplate.student_id != student_id)
    ).all()
    best: tuple[int, float] | None = None
    for other_id, vector in _decrypt_rows(rows):
        score = max(cosine(probe, vector) for probe in embeddings)
        if best is None or score > best[1]:
            best = (other_id, score)
    if best is None or best[1] < threshold:
        return None
    return {"matched_student_id": best[0], "similarity": round(best[1], 3), "threshold": threshold}


def delete_templates(db: Session, student: Student, actor: User | None, *, withdraw_consent: bool, reason: str,
                     request=None) -> dict:
    rows = db.scalars(select(BiometricTemplate).where(BiometricTemplate.student_id == student.id)).all()
    for row in rows:
        db.delete(row)
    consent_withdrawn = False
    if withdraw_consent:
        consent = _granted_consent(db, student.id)
        if consent is not None:
            consent.status = "withdrawn"
            consent.withdrawn_at = utcnow()
            consent.withdrawal_reason = reason
            consent_withdrawn = True
    audit_service.record(
        db, actor=actor, action="biometric.delete", entity_type="biometric_template_set",
        entity_id=student.id,
        before={"template_count": len(rows)},
        after={"template_count": 0, "consent_withdrawn": consent_withdrawn},
        reason=reason, request=request,
    )
    db.commit()
    return {"deleted_templates": len(rows), "consent_withdrawn": consent_withdrawn}


def get_student(db: Session, student_id: int) -> Student:
    student = db.get(Student, student_id)
    if student is None:
        raise not_found("Student")
    return student
