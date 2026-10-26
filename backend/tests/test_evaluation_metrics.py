import pytest

from ai_service.evaluation.metrics import (
    auc,
    operating_point,
    roc_curve,
    threshold_for_fmr,
    threshold_for_fnmr,
)


def test_auc_uses_ties_as_half():
    assert auc([0.5], [0.5]) == pytest.approx(0.5)
    assert auc([0.9, 0.6], [0.7, 0.4]) == pytest.approx(0.75)


def test_roc_curve_reports_eer_and_separation():
    curve = roc_curve([0.9, 0.8], [0.2, 0.1])
    assert curve.auc == 1.0
    assert curve.eer == pytest.approx(0.0)
    assert curve.thresholds[0] > curve.thresholds[-1]
    assert curve.false_match_rate[-1] == 1.0
    assert curve.false_non_match_rate[-1] == 0.0


def test_threshold_for_fmr_picks_lowest_feasible_threshold():
    genuine = [0.9, 0.8]
    impostor = [0.9, 0.3, 0.15, 0.05]
    point = threshold_for_fmr(genuine, impostor, 0.5)
    assert point is not None
    assert point.threshold == pytest.approx(0.3)
    assert point.false_match_rate == pytest.approx(0.5)
    assert point.false_non_match_rate == pytest.approx(0.0)


def test_threshold_for_fmr_returns_none_when_target_is_unreachable():
    assert threshold_for_fmr([0.9], [0.9], 0.0) is None


def test_threshold_for_fnmr_picks_highest_feasible_threshold():
    real = [0.9, 0.3, 0.2, 0.1]
    attack = [0.8]
    point = threshold_for_fnmr(real, attack, 0.5)
    assert point is not None
    assert point.threshold == pytest.approx(0.3)
    assert point.false_non_match_rate == pytest.approx(0.5)
    assert point.false_match_rate == pytest.approx(1.0)


def test_operating_point_counts_boundary_as_accepted():
    point = operating_point([0.5, 0.4], [0.5, 0.2], 0.5)
    assert point.false_match_rate == pytest.approx(0.5)
    assert point.false_non_match_rate == pytest.approx(0.5)


def test_invalid_inputs_are_rejected():
    with pytest.raises(ValueError):
        roc_curve([], [0.1])
    with pytest.raises(ValueError):
        roc_curve([0.5], [float("nan")])
    with pytest.raises(ValueError):
        threshold_for_fmr([0.5], [0.1], 1.5)
    with pytest.raises(ValueError):
        threshold_for_fnmr([0.5], [0.1], -0.1)
