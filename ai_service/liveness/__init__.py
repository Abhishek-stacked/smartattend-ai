"""Experimental presentation-attack detection (MiniFASNetV2).

The model is trained on printed-photo and replay attacks. It is not a guarantee against every
spoof, and the project reports it as experimental. This package only scores crops: identity and
attendance decisions remain in the backend.
"""

from ai_service.liveness.detector import (
    CROP_SCALE,
    LIVENESS_MODEL_NAME,
    LIVENESS_MODEL_VERSION,
    MODEL_FILE,
    LivenessDetector,
    LivenessResult,
)

__all__ = [
    "CROP_SCALE",
    "LIVENESS_MODEL_NAME",
    "LIVENESS_MODEL_VERSION",
    "MODEL_FILE",
    "LivenessDetector",
    "LivenessResult",
]
