"""SmartAttend AI inference package.

Independent of the backend: images/embeddings in, dataclasses out. No database, no
attendance decisions, no user data.
"""

from ai_service.analyzer import (
    EMBEDDING_DIM,
    MODEL_NAME,
    MODEL_VERSION,
    FaceAnalyzer,
    cosine,
    decode_image,
    normalize,
)
from ai_service.matcher import Match, match_embedding
from ai_service.types import (
    DetectedFace,
    FaceBox,
    FrameAnalysis,
    ImageDecodeError,
    ModelUnavailable,
    QualityPolicy,
    QualityReport,
)

__all__ = [
    "EMBEDDING_DIM",
    "MODEL_NAME",
    "MODEL_VERSION",
    "DetectedFace",
    "FaceAnalyzer",
    "FaceBox",
    "FrameAnalysis",
    "ImageDecodeError",
    "Match",
    "ModelUnavailable",
    "QualityPolicy",
    "QualityReport",
    "cosine",
    "decode_image",
    "match_embedding",
    "normalize",
]
