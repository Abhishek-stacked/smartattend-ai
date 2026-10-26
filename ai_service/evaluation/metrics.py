"""Threshold metrics for verification scores (higher score means "more genuine").

Kept independent of OpenCV so the maths can be unit-tested without model files.
"""

from dataclasses import dataclass

import numpy as np

_EPS = 1e-12


@dataclass(frozen=True)
class OperatingPoint:
    threshold: float
    false_match_rate: float
    false_non_match_rate: float


@dataclass(frozen=True)
class RocCurve:
    thresholds: np.ndarray
    false_match_rate: np.ndarray
    false_non_match_rate: np.ndarray
    auc: float
    eer: float
    eer_threshold: float


def _clean(values, name: str) -> np.ndarray:
    array = np.asarray(values, dtype=np.float64).ravel()
    if array.size == 0:
        raise ValueError(f"{name} scores are empty")
    if not np.all(np.isfinite(array)):
        raise ValueError(f"{name} scores contain non-finite values")
    return array


def auc(genuine, impostor) -> float:
    """Probability that a genuine score exceeds an impostor score (ties count 0.5)."""
    positive = _clean(genuine, "genuine")
    negative = _clean(impostor, "impostor")
    combined = np.concatenate([positive, negative])
    left = np.searchsorted(np.sort(combined), combined, side="left")
    right = np.searchsorted(np.sort(combined), combined, side="right")
    ranks = left + (right - left + 1) / 2.0
    positive_rank_sum = float(ranks[: positive.size].sum())
    u = positive_rank_sum - positive.size * (positive.size + 1) / 2.0
    return u / (positive.size * negative.size)


def operating_point(genuine, impostor, threshold: float) -> OperatingPoint:
    positive = _clean(genuine, "genuine")
    negative = _clean(impostor, "impostor")
    return OperatingPoint(
        threshold=float(threshold),
        false_match_rate=float(np.mean(negative >= threshold)),
        false_non_match_rate=float(np.mean(positive < threshold)),
    )


def roc_curve(genuine, impostor) -> RocCurve:
    positive = _clean(genuine, "genuine")
    negative = _clean(impostor, "impostor")
    thresholds = np.unique(np.concatenate([positive, negative]))[::-1]
    fmr = np.array([np.mean(negative >= t) for t in thresholds])
    fnmr = np.array([np.mean(positive < t) for t in thresholds])
    eer, eer_threshold = _equal_error_rate(thresholds, fmr, fnmr)
    return RocCurve(thresholds, fmr, fnmr, auc(positive, negative), eer, eer_threshold)


def threshold_for_fmr(genuine, impostor, target_fmr: float) -> OperatingPoint | None:
    """Lowest threshold (highest TPR) whose measured FMR is still within target, or None."""
    if not 0.0 <= target_fmr <= 1.0:
        raise ValueError("target_fmr must be between 0 and 1")
    curve = roc_curve(genuine, impostor)
    feasible = np.flatnonzero(curve.false_match_rate <= target_fmr + _EPS)
    if feasible.size == 0:
        return None
    index = int(feasible[-1])
    return OperatingPoint(
        threshold=float(curve.thresholds[index]),
        false_match_rate=float(curve.false_match_rate[index]),
        false_non_match_rate=float(curve.false_non_match_rate[index]),
    )


def threshold_for_fnmr(genuine, impostor, target_fnmr: float) -> OperatingPoint | None:
    """Highest threshold (lowest FMR) whose measured FNMR still meets the target, or None.

    Used for liveness, where the institution bounds how often a real person is rejected
    (BPCER) and wants the fewest accepted attacks (APCER) within that bound.
    """
    if not 0.0 <= target_fnmr <= 1.0:
        raise ValueError("target_fnmr must be between 0 and 1")
    curve = roc_curve(genuine, impostor)
    feasible = np.flatnonzero(curve.false_non_match_rate <= target_fnmr + _EPS)
    if feasible.size == 0:
        return None
    index = int(feasible[0])
    return OperatingPoint(
        threshold=float(curve.thresholds[index]),
        false_match_rate=float(curve.false_match_rate[index]),
        false_non_match_rate=float(curve.false_non_match_rate[index]),
    )


def _equal_error_rate(thresholds: np.ndarray, fmr: np.ndarray, fnmr: np.ndarray) -> tuple[float, float]:
    gap = fmr - fnmr
    crossing = np.flatnonzero(gap >= 0)
    if crossing.size == 0:
        return float(min(fmr[-1], fnmr[0])), float(thresholds[-1])
    index = int(crossing[0])
    if index == 0:
        eer = float((fmr[0] + fnmr[0]) / 2.0)
        return eer, float(thresholds[0])
    gap_prev, gap_now = float(gap[index - 1]), float(gap[index])
    alpha = -gap_prev / (gap_now - gap_prev) if gap_now != gap_prev else 0.0
    eer = float(fmr[index - 1] + alpha * (fmr[index] - fmr[index - 1]))
    threshold = float(thresholds[index - 1] + alpha * (thresholds[index] - thresholds[index - 1]))
    return eer, threshold
