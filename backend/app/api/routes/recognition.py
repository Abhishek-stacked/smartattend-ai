from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.api.access import staff_scope
from app.api.deps import current_user, get_auth
from app.api.uploads import read_image_upload
from app.core.database import get_db
from app.core.ratelimit import rate_limit
from app.models import User
from app.schemas.biometric import DetectOut, LivenessFaceOut, LivenessVerifyOut, RecognizeOut
from app.services import biometric_service, recognition_service, settings_service

LIVENESS_MESSAGES = {
    "passed": "Likely a live face",
    "failed": "Liveness check did not pass — verify the person in front of you",
    "inconclusive": "Liveness could not be evaluated for this face",
    "not_enabled": "Liveness model is not installed on this server",
}

# get_auth runs first so the frame rate limit is keyed per signed-in user.
router = APIRouter(tags=["recognition"], dependencies=[
    Depends(get_auth),
    Depends(rate_limit("recognition", 240, 60, per="user")),
])


@router.post("/recognition/detect", response_model=DetectOut)
def detect(frame: UploadFile = File(...), _: User = Depends(current_user),
           db: Session = Depends(get_db)):
    data = read_image_upload(frame)
    analysis = biometric_service.analyze(db, data, embed=False)
    return {
        "faces": [face.summary() for face in analysis.faces],
        "width": analysis.width,
        "height": analysis.height,
        "processing_ms": analysis.processing_ms,
    }


@router.post("/liveness/verify", response_model=LivenessVerifyOut)
def verify_liveness(frame: UploadFile = File(...), _: User = Depends(staff_scope),
                    db: Session = Depends(get_db)):
    image = biometric_service.decode_frame(read_image_upload(frame))
    analysis = biometric_service.analyze_frame(db, image, embed=False)
    detector = biometric_service.get_liveness_detector()
    available = detector.available()
    results = biometric_service.verify_liveness(db, image, analysis.faces)
    threshold = settings_service.get(db, "liveness_threshold")
    faces = [
        LivenessFaceOut(
            box=face.box.as_list(),
            status=result.status,
            score=result.score,
            message=LIVENESS_MESSAGES[result.status],
        )
        for face, result in zip(analysis.faces, results)
    ]
    message = None if available else LIVENESS_MESSAGES["not_enabled"]
    return {
        "faces": faces,
        "available": available,
        "threshold": threshold,
        "model": biometric_service.LIVENESS_MODEL_NAME,
        "model_version": biometric_service.LIVENESS_MODEL_VERSION,
        "processing_ms": analysis.processing_ms,
        "message": message,
    }


@router.post("/recognition/recognize", response_model=RecognizeOut)
def recognize(frame: UploadFile = File(...), session_id: int = Form(...),
              user: User = Depends(staff_scope), db: Session = Depends(get_db)):
    data = read_image_upload(frame)
    return recognition_service.recognize(db, user, session_id, data)
