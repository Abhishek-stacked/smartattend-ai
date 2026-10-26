"""Live frame recognition: eligibility, conservative matching, cooldown and atomic marking.

Identity is decided here from AI scores; the AI package never touches the database.
"""

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ai_service import FrameAnalysis, Match, match_embedding
from ai_service.liveness import LivenessResult
from app.api.access import can_view_session
from app.core.errors import AppError, not_found
from app.models import AttendanceRecord, AttendanceSession, RecognitionEvent, Student, User
from app.models.base import utcnow
from app.services import attendance_service, biometric_service, session_service, settings_service

CANDIDATE_OUTCOMES_BY_REVIEW = ("low_confidence", "multiple_faces", "liveness_failed")


def _student_summary(student: Student) -> dict:
    return {"id": student.id, "full_name": student.full_name, "registration_number": student.registration_number}


def _message(outcome: str, *, status: str | None = None, issues: tuple[str, ...] = ()) -> str:
    if outcome == "recognized":
        return f"Attendance recorded as {status}" if status else "Attendance recorded"
    if outcome == "duplicate":
        return f"Already recorded as {status} for this session" if status else "Already recorded for this session"
    if outcome == "low_confidence":
        return "Uncertain match — queued for staff review"
    if outcome == "unknown":
        return "No confident match in this session's roster"
    if outcome == "poor_quality":
        return "Face did not pass quality checks" + (f" ({', '.join(issues)})" if issues else "")
    if outcome == "multiple_faces":
        return "More than one face in frame — ask one student at a time"
    if outcome == "not_eligible":
        return "Recognised student is not eligible for this session"
    if outcome == "liveness_failed":
        return "Liveness check did not pass — queued for staff review"
    if outcome == "liveness_unavailable":
        return "Liveness is enforced but the liveness model is unavailable — not marked"
    return "Recognition could not be completed"


def _event(db: Session, session: AttendanceSession, user: User, *, outcome: str, analysis: FrameAnalysis,
           match: Match | None = None, threshold: float | None = None, quality: dict | None = None,
           liveness_status: str = "not_required", liveness_score: float | None = None,
           liveness_model: str | None = None, student: Student | None = None,
           error_code: str | None = None, review: str | None = None) -> RecognitionEvent:
    if review is None:
        review = "pending" if outcome in CANDIDATE_OUTCOMES_BY_REVIEW else "not_required"
    event = RecognitionEvent(
        session_id=session.id,
        operator_user_id=user.id,
        occurred_at=utcnow(),
        outcome=outcome,
        matched_student_id=student.id if student else None,
        similarity=match.score if match else None,
        second_similarity=match.runner_up if match else None,
        threshold_used=threshold,
        quality=quality,
        liveness_status=liveness_status,
        liveness_score=liveness_score,
        liveness_model=liveness_model,
        model_name=biometric_service.MODEL_NAME,
        model_version=biometric_service.MODEL_VERSION,
        processing_ms=analysis.processing_ms,
        review_status=review,
        error_code=error_code,
    )
    db.add(event)
    db.flush()
    return event


def _existing_record(db: Session, session_id: int, student_id: int) -> AttendanceRecord | None:
    return db.scalar(
        select(AttendanceRecord).where(
            AttendanceRecord.session_id == session_id, AttendanceRecord.student_id == student_id
        )
    )


def _liveness_model(status: str) -> str | None:
    if status in ("passed", "failed", "inconclusive"):
        return biometric_service.LIVENESS_MODEL_NAME
    return None


def _liveness_payload(result: LivenessResult) -> dict:
    return {"status": result.status, "score": result.score}


def _flagged_message(status: str | None, live: LivenessResult) -> str:
    base = f"Attendance recorded as {status}" if status else "Attendance recorded"
    if live.status == "not_enabled":
        return f"{base} — liveness unavailable under the flag policy"
    return f"{base} — liveness {live.status}, flagged for staff review"


def recognize(db: Session, user: User, session_id: int, data: bytes) -> dict:
    session = session_service.get_session(db, session_id)
    if not can_view_session(user, session):
        raise not_found("Session")
    if session.status != "active":
        raise AppError(409, "session_not_active", "Attendance can only be recognised while the session is active")

    image = biometric_service.decode_frame(data)
    analysis = biometric_service.analyze_frame(db, image)
    if not analysis.faces:
        return {"results": [], "processing_ms": analysis.processing_ms, "message": "No face detected"}

    values = settings_service.get_all(db)
    max_faces = values["max_faces_per_frame"]
    if len(analysis.faces) > max_faces:
        event = _event(db, session, user, outcome="multiple_faces", analysis=analysis,
                       quality={"face_count": len(analysis.faces), "max_faces": max_faces})
        db.commit()
        results = [{
            "box": face.box.as_list(),
            "outcome": "multiple_faces",
            "liveness": {"status": "not_required", "score": None},
            "message": _message("multiple_faces"),
            "event_id": event.id,
        } for face in analysis.faces]
        return {"results": results, "processing_ms": analysis.processing_ms,
                "message": _message("multiple_faces")}

    gallery = biometric_service.gallery_for_session(db, session.id)
    threshold = values["recognition_threshold"]
    low_margin = values["low_confidence_margin"]
    ambiguity = values["ambiguity_margin"]
    cooldown = values["recognition_cooldown_s"]
    policy = session.liveness_policy

    if policy == "off":
        checks = [LivenessResult("not_required", None) for _ in analysis.faces]
    else:
        checks = biometric_service.verify_liveness(db, image, analysis.faces)

    results: list[dict] = []
    for index, face in enumerate(analysis.faces):
        live = checks[index]
        live_fields = {"liveness_status": live.status, "liveness_score": live.score,
                       "liveness_model": _liveness_model(live.status)}
        quality = face.quality.as_dict()
        if not face.quality.ok or face.embedding is None:
            event = _event(db, session, user, outcome="poor_quality", analysis=analysis, quality=quality,
                           **live_fields)
            results.append({
                "box": face.box.as_list(),
                "outcome": "poor_quality",
                "liveness": _liveness_payload(live),
                "message": _message("poor_quality", issues=face.quality.issues),
                "event_id": event.id,
            })
            continue

        match = match_embedding(face.embedding, gallery)
        student = db.get(Student, match.student_id) if match.student_id else None

        if match.score is None or match.score < threshold - low_margin:
            event = _event(db, session, user, outcome="unknown", analysis=analysis, match=match,
                           threshold=threshold, quality=quality, **live_fields)
            results.append({
                "box": face.box.as_list(),
                "outcome": "unknown",
                "similarity": round(match.score, 4) if match.score is not None else None,
                "threshold_used": threshold,
                "liveness": _liveness_payload(live),
                "message": _message("unknown"),
                "event_id": event.id,
            })
            continue

        ambiguous = match.runner_up is not None and (match.score - match.runner_up) < ambiguity
        if match.score < threshold or ambiguous:
            event = _event(db, session, user, outcome="low_confidence", analysis=analysis, match=match,
                           threshold=threshold, quality=quality, student=student, **live_fields)
            results.append({
                "box": face.box.as_list(),
                "outcome": "low_confidence",
                "similarity": round(match.score, 4),
                "threshold_used": threshold,
                "liveness": _liveness_payload(live),
                "message": _message("low_confidence"),
                "event_id": event.id,
            })
            continue

        if student is None or student.status != "active":
            event = _event(db, session, user, outcome="not_eligible", analysis=analysis, match=match,
                           threshold=threshold, quality=quality, student=student, **live_fields)
            results.append({
                "box": face.box.as_list(),
                "outcome": "not_eligible",
                "similarity": round(match.score, 4),
                "threshold_used": threshold,
                "liveness": _liveness_payload(live),
                "message": _message("not_eligible"),
                "event_id": event.id,
            })
            continue

        if policy == "enforce" and not live.ok:
            failed = live.status in ("failed", "inconclusive")
            outcome = "liveness_failed" if failed else "error"
            event = _event(db, session, user, outcome=outcome, analysis=analysis, match=match,
                           threshold=threshold, quality=quality, student=student,
                           error_code=None if failed else "liveness_unavailable", **live_fields)
            results.append({
                "box": face.box.as_list(),
                "outcome": outcome,
                "student": _student_summary(student),
                "similarity": round(match.score, 4),
                "threshold_used": threshold,
                "liveness": _liveness_payload(live),
                "message": _message("liveness_failed" if failed else "liveness_unavailable"),
                "event_id": event.id,
            })
            continue

        flagged = policy == "flag" and live.status in ("failed", "inconclusive")

        existing = _existing_record(db, session.id, student.id)
        if existing is not None:
            results.append({
                "box": face.box.as_list(),
                "outcome": "duplicate",
                "student": _student_summary(student),
                "similarity": round(match.score, 4),
                "threshold_used": threshold,
                "liveness": _liveness_payload(live),
                "attendance": {"committed": False, "record_id": existing.id, "status": existing.status},
                "message": _message("duplicate", status=existing.status),
                "cooldown": True,
            })
            continue

        recent = db.scalar(
            select(RecognitionEvent.id).where(
                RecognitionEvent.session_id == session.id,
                RecognitionEvent.matched_student_id == student.id,
                RecognitionEvent.outcome == "recognized",
                RecognitionEvent.occurred_at >= utcnow() - timedelta(seconds=cooldown),
            )
        )
        if recent is not None:
            results.append({
                "box": face.box.as_list(),
                "outcome": "duplicate",
                "student": _student_summary(student),
                "similarity": round(match.score, 4),
                "threshold_used": threshold,
                "liveness": _liveness_payload(live),
                "message": "Recently captured — waiting for the cooldown window",
                "cooldown": True,
            })
            continue

        event = _event(db, session, user, outcome="recognized", analysis=analysis, match=match,
                       threshold=threshold, quality=quality, student=student,
                       error_code=f"liveness_{live.status}" if flagged else None,
                       review="pending" if flagged else None, **live_fields)
        status = attendance_service.status_for_arrival(session, utcnow())
        record = attendance_service.insert_record(
            db, session_id=session.id, student_id=student.id, status=status, source="automated",
            recognition_event_id=event.id, marked_by_user_id=None,
        )
        if record is None:
            event.outcome = "duplicate"
            event.review_status = "not_required"
            existing = _existing_record(db, session.id, student.id)
            results.append({
                "box": face.box.as_list(),
                "outcome": "duplicate",
                "student": _student_summary(student),
                "similarity": round(match.score, 4),
                "threshold_used": threshold,
                "liveness": _liveness_payload(live),
                "attendance": {"committed": False, "record_id": existing.id if existing else None,
                               "status": existing.status if existing else None},
                "message": _message("duplicate", status=existing.status if existing else None),
                "cooldown": False,
            })
            continue

        message = _message("recognized", status=record.status)
        if policy != "off" and (live.status != "passed" or flagged):
            message = _flagged_message(record.status, live)
        results.append({
            "box": face.box.as_list(),
            "outcome": "recognized",
            "student": _student_summary(student),
            "similarity": round(match.score, 4),
            "threshold_used": threshold,
            "liveness": _liveness_payload(live),
            "attendance": {"committed": True, "record_id": record.id, "status": record.status},
            "event_id": event.id,
            "message": message,
        })

    db.commit()
    return {"results": results, "processing_ms": analysis.processing_ms}
