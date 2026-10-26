"""Typed results exchanged between the AI package and the backend."""

from dataclasses import dataclass
from typing import Any

import numpy as np


@dataclass(frozen=True)
class FaceBox:
    x: int
    y: int
    width: int
    height: int

    @property
    def shortest_side(self) -> int:
        return min(self.width, self.height)

    def as_list(self) -> list[int]:
        return [self.x, self.y, self.width, self.height]


@dataclass(frozen=True)
class QualityReport:
    ok: bool
    issues: tuple[str, ...]
    blur: float
    brightness: float
    face_px: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "issues": list(self.issues),
            "blur": round(self.blur, 1),
            "brightness": round(self.brightness, 1),
            "face_px": self.face_px,
        }


@dataclass(frozen=True)
class DetectedFace:
    box: FaceBox
    detector_score: float
    quality: QualityReport
    embedding: np.ndarray | None

    def summary(self) -> dict[str, Any]:
        return {
            "box": self.box.as_list(),
            "score": round(self.detector_score, 4),
            "quality": self.quality.as_dict(),
        }


@dataclass(frozen=True)
class FrameAnalysis:
    faces: tuple[DetectedFace, ...]
    width: int
    height: int
    processing_ms: int


@dataclass(frozen=True)
class QualityPolicy:
    min_face_px: int = 80
    blur_threshold: float = 60.0
    brightness_min: int = 50
    brightness_max: int = 210


class ModelUnavailable(RuntimeError):
    """Raised when model files are missing or cannot be loaded."""


class ImageDecodeError(ValueError):
    """Raised when uploaded bytes are not a decodable image."""
