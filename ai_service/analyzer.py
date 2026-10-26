"""YuNet detection + SFace embeddings. Stateless: no storage, no identity decisions."""

import threading
import time
from pathlib import Path

import cv2
import numpy as np

from ai_service.quality import assess
from ai_service.types import (
    DetectedFace,
    FaceBox,
    FrameAnalysis,
    ImageDecodeError,
    ModelUnavailable,
    QualityPolicy,
)

DETECTOR_FILE = "face_detection_yunet_2023mar.onnx"
RECOGNIZER_FILE = "face_recognition_sface_2021dec.onnx"
MODEL_NAME = "SFace"
MODEL_VERSION = "2021dec"
EMBEDDING_DIM = 128
_HARD_FACE_LIMIT = 50


def decode_image(data: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.size == 0:
        raise ImageDecodeError("The frame is not a decodable JPEG or PNG image")
    return image


def normalize(vector: np.ndarray) -> np.ndarray:
    flat = np.asarray(vector, dtype=np.float32).ravel()
    norm = float(np.linalg.norm(flat))
    if norm == 0.0:
        return flat
    return flat / norm


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(normalize(a), normalize(b)))


class FaceAnalyzer:
    """Loads the models once and serialises inference (OpenCV detectors are not thread-safe)."""

    def __init__(self, model_dir: Path, *, detector_score: float = 0.6):
        self.model_dir = Path(model_dir)
        self.detector_score = detector_score
        self._lock = threading.Lock()
        self._detector: cv2.FaceDetectorYN | None = None
        self._recognizer: cv2.FaceRecognizerSF | None = None

    @property
    def detector_path(self) -> Path:
        return self.model_dir / DETECTOR_FILE

    @property
    def recognizer_path(self) -> Path:
        return self.model_dir / RECOGNIZER_FILE

    def available(self) -> bool:
        return self.detector_path.is_file() and self.recognizer_path.is_file()

    def _ensure_loaded(self) -> None:
        if self._detector is not None and self._recognizer is not None:
            return
        if not self.available():
            raise ModelUnavailable(f"Face models not found in {self.model_dir}")
        try:
            self._detector = cv2.FaceDetectorYN.create(str(self.detector_path), "", (320, 320),
                                                       self.detector_score, 0.3, 5000)
            self._recognizer = cv2.FaceRecognizerSF.create(str(self.recognizer_path), "")
        except cv2.error as exc:
            raise ModelUnavailable("Face models could not be loaded") from exc

    def analyze(self, image: np.ndarray, policy: QualityPolicy, *, embed: bool = True) -> FrameAnalysis:
        started = time.perf_counter()
        self._ensure_loaded()
        assert self._detector is not None and self._recognizer is not None
        height, width = image.shape[:2]
        faces: list[DetectedFace] = []
        with self._lock:
            self._detector.setInputSize((width, height))
            _, raw = self._detector.detect(image)
            rows = [] if raw is None else raw[:_HARD_FACE_LIMIT]
            for row in rows:
                x, y, w, h = (int(round(v)) for v in row[:4])
                box = FaceBox(max(0, x), max(0, y), min(w, width - max(0, x)), min(h, height - max(0, y)))
                quality = assess(image, box, policy)
                embedding = None
                if embed and quality.ok:
                    aligned = self._recognizer.alignCrop(image, row)
                    embedding = normalize(self._recognizer.feature(aligned))
                faces.append(DetectedFace(box, float(row[14]), quality, embedding))
        elapsed = int((time.perf_counter() - started) * 1000)
        return FrameAnalysis(tuple(faces), width, height, elapsed)
