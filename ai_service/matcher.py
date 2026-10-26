"""Gallery matching. The AI package scores; the backend decides eligibility and attendance."""

from dataclasses import dataclass
from typing import Mapping, Sequence

import numpy as np

from ai_service.analyzer import normalize


@dataclass(frozen=True)
class Match:
    student_id: int | None
    score: float | None
    runner_up: float | None

    @property
    def margin(self) -> float | None:
        if self.score is None or self.runner_up is None:
            return None
        return self.score - self.runner_up


def match_embedding(embedding: np.ndarray, gallery: Mapping[int, Sequence[np.ndarray]]) -> Match:
    """Best student by max cosine over their templates, plus the best competing student."""
    probe = normalize(embedding)
    per_student: dict[int, float] = {}
    for student_id, templates in gallery.items():
        for template in templates:
            score = float(np.dot(probe, normalize(template)))
            if score > per_student.get(student_id, -1.0):
                per_student[student_id] = score
    if not per_student:
        return Match(None, None, None)
    ranked = sorted(per_student.items(), key=lambda item: item[1], reverse=True)
    best_id, best = ranked[0]
    second = ranked[1][1] if len(ranked) > 1 else None
    return Match(best_id, best, second)
