"""MiniFASNetV2 scoring for a face crop.

Experimental: trained against print and replay attacks on a specific capture pipeline. It is an
auxiliary signal, not proof that a live person is present. The model file is converted from the
official Apache-2.0 checkpoint by `convert_minifasnet.py`.
"""

import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import cv2
import numpy as np
import onnxruntime as ort

from ai_service.types import FaceBox, ModelUnavailable

log = logging.getLogger("smartattend.liveness")

MODEL_FILE = "minifasnet_v2_2.7_80x80.onnx"
LIVENESS_MODEL_NAME = "MiniFASNetV2"
LIVENESS_MODEL_VERSION = "2.7_80x80"
CROP_SCALE = 2.7
INPUT_SIZE = 80
REAL_CLASS_INDEX = 1


@dataclass(frozen=True)
class LivenessResult:
    status: str  # passed | failed | inconclusive | not_enabled
    score: float | None = None

    @property
    def ok(self) -> bool:
        return self.status == "passed"


def _unavailable(count: int) -> list[LivenessResult]:
    return [LivenessResult("not_enabled", None) for _ in range(count)]


def crop_for_model(image: np.ndarray, box: FaceBox) -> np.ndarray | None:
    """Expands the detected box by CROP_SCALE, clamped to the image, then resizes to 80x80."""
    height, width = image.shape[:2]
    if box.width <= 0 or box.height <= 0:
        return None
    scale = min((width - 1) / box.width, (height - 1) / box.height, CROP_SCALE)
    new_w = max(1, int(box.width * scale))
    new_h = max(1, int(box.height * scale))
    left = min(max(0, box.x - (new_w - box.width) // 2), max(0, width - new_w))
    top = min(max(0, box.y - (new_h - box.height) // 2), max(0, height - new_h))
    crop = image[top:top + new_h, left:left + new_w]
    if crop.size == 0:
        return None
    return cv2.resize(crop, (INPUT_SIZE, INPUT_SIZE), interpolation=cv2.INTER_LINEAR)


def preprocess(crop: np.ndarray) -> np.ndarray:
    tensor = crop.astype(np.float32) / 255.0
    tensor = np.transpose(tensor, (2, 0, 1))[None, ...]
    return (tensor - 0.5) / 0.5


def softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - np.max(logits, axis=1, keepdims=True)
    exponent = np.exp(shifted)
    return exponent / exponent.sum(axis=1, keepdims=True)


class LivenessDetector:
    """Loads the ONNX model once and scores crops. Thread-safe; inference is serialised."""

    def __init__(self, model_dir: Path):
        self.model_dir = Path(model_dir)
        self._lock = threading.Lock()
        self._session: ort.InferenceSession | None = None
        self._input_name: str = ""
        self._output_name: str = ""

    @property
    def model_path(self) -> Path:
        return self.model_dir / MODEL_FILE

    def available(self) -> bool:
        return self.model_path.is_file()

    def _ensure_loaded(self) -> None:
        if self._session is not None:
            return
        if not self.available():
            raise ModelUnavailable(f"Liveness model not found at {self.model_path}")
        try:
            session = ort.InferenceSession(str(self.model_path), providers=["CPUExecutionProvider"])
        except Exception as exc:  # noqa: BLE001 - surfaced as a stable API error
            raise ModelUnavailable("Liveness model could not be loaded") from exc
        self._input_name = session.get_inputs()[0].name
        self._output_name = session.get_outputs()[0].name
        self._session = session

    def _score(self, crop: np.ndarray) -> float:
        assert self._session is not None
        logits = self._session.run([self._output_name], {self._input_name: preprocess(crop)})[0]
        if logits.shape != (1, 3):
            raise ValueError(f"unexpected liveness output shape {logits.shape}")
        return float(softmax(logits)[0, REAL_CLASS_INDEX])

    def verify(self, image: np.ndarray, boxes: Sequence[FaceBox], threshold: float) -> list[LivenessResult]:
        """Returns one result per box. Never reports a pass when the model is missing or errors."""
        if not self.available():
            return _unavailable(len(boxes))
        self._ensure_loaded()
        results: list[LivenessResult] = []
        with self._lock:
            for box in boxes:
                crop = crop_for_model(image, box)
                if crop is None:
                    results.append(LivenessResult("inconclusive", None))
                    continue
                try:
                    score = self._score(crop)
                except Exception as exc:  # noqa: BLE001 - keep the frame loop alive
                    log.warning("liveness inference failed: %s", type(exc).__name__)
                    results.append(LivenessResult("inconclusive", None))
                    continue
                status = "passed" if score >= threshold else "failed"
                results.append(LivenessResult(status, round(score, 4)))
        return results
