"""Face-crop quality checks used before an embedding is trusted."""

import cv2
import numpy as np

from ai_service.types import FaceBox, QualityPolicy, QualityReport


def crop(image: np.ndarray, box: FaceBox) -> np.ndarray:
    height, width = image.shape[:2]
    x1 = max(0, min(box.x, width - 1))
    y1 = max(0, min(box.y, height - 1))
    x2 = max(x1 + 1, min(box.x + box.width, width))
    y2 = max(y1 + 1, min(box.y + box.height, height))
    return image[y1:y2, x1:x2]


def assess(image: np.ndarray, box: FaceBox, policy: QualityPolicy) -> QualityReport:
    face = crop(image, box)
    if face.size == 0:
        return QualityReport(False, ("face_too_small",), 0.0, 0.0, 0)
    gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY) if face.ndim == 3 else face
    issues: list[str] = []
    face_px = box.shortest_side
    if face_px < policy.min_face_px:
        issues.append("face_too_small")
    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    if blur < policy.blur_threshold:
        issues.append("blurry")
    brightness = float(gray.mean())
    if brightness < policy.brightness_min:
        issues.append("too_dark")
    elif brightness > policy.brightness_max:
        issues.append("too_bright")
    return QualityReport(not issues, tuple(issues), blur, brightness, face_px)
