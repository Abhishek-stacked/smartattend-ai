#!/usr/bin/env python3
"""Measure the experimental MiniFASNetV2 liveness model on labelled local samples.

Manifest: CSV with header `label,path` where label is `real` or `attack`
(optional `attack_type` is only counted, never reported as data). Cropped-face mode uses the
whole image; full-frame mode runs YuNet first and skips frames without exactly one face.
Only aggregate metrics are written; images and crops are never stored.
"""

import argparse
import csv
import json
import math
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ai_service.analyzer import FaceAnalyzer, decode_image  # noqa: E402
from ai_service.evaluation.metrics import operating_point, roc_curve, threshold_for_fnmr  # noqa: E402
from ai_service.liveness import LivenessDetector  # noqa: E402
from ai_service.types import FaceBox, ImageDecodeError, ModelUnavailable, QualityPolicy  # noqa: E402

LABELS = {"real", "attack"}


def load_manifest(path: Path) -> list[tuple[str, Path, str | None]]:
    rows: list[tuple[str, Path, str | None]] = []
    seen: set[Path] = set()
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        missing = {"label", "path"} - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"manifest is missing columns: {', '.join(sorted(missing))}")
        for line, row in enumerate(reader, start=2):
            label = (row.get("label") or "").strip().lower()
            raw_path = (row.get("path") or "").strip()
            if label not in LABELS:
                raise SystemExit(f"manifest line {line}: label must be one of {sorted(LABELS)}")
            if not raw_path:
                raise SystemExit(f"manifest line {line}: path is required")
            image_path = Path(raw_path)
            if not image_path.is_absolute():
                image_path = (path.parent / image_path).resolve()
            if image_path in seen:
                continue
            seen.add(image_path)
            rows.append((label, image_path, (row.get("attack_type") or "").strip() or None))
    if not rows:
        raise SystemExit("manifest has no rows")
    return rows


def read_image(path: Path):
    try:
        return decode_image(path.read_bytes())
    except OSError:
        return None
    except ImageDecodeError:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--models-dir", type=Path, default=REPO_ROOT / "ai_service" / "models")
    parser.add_argument("--mode", choices=("crops", "full-frames"), default="crops")
    parser.add_argument("--threshold", type=float, default=0.8,
                        help="reported decision threshold (default matches application_settings)")
    parser.add_argument("--target-bpcer", type=float, default=0.05,
                        help="maximum measured real-sample rejection rate for the suggested threshold")
    parser.add_argument("--json-out", type=Path)
    parser.add_argument("--scores-out", type=Path,
                        help="optional JSON with real/attack scores for select_threshold.py")
    args = parser.parse_args()
    if not 0.0 <= args.threshold <= 1.0:
        parser.error("--threshold must be between 0 and 1")
    if not 0.0 <= args.target_bpcer <= 1.0:
        parser.error("--target-bpcer must be between 0 and 1")

    detector = LivenessDetector(args.models_dir)
    if not detector.available():
        print(f"liveness model is missing from {args.models_dir}; nothing is simulated", file=sys.stderr)
        return 2
    analyzer = FaceAnalyzer(args.models_dir) if args.mode == "full-frames" else None
    if analyzer is not None and not analyzer.available():
        print(f"face detector models are missing from {args.models_dir}", file=sys.stderr)
        return 2

    rows = load_manifest(args.manifest)
    scores: dict[str, list[float]] = {"real": [], "attack": []}
    attack_types: Counter[str] = Counter()
    skipped: Counter[str] = Counter()
    try:
        for label, image_path, attack_type in rows:
            image = read_image(image_path)
            if image is None:
                skipped["unreadable"] += 1
                continue
            height, width = image.shape[:2]
            boxes = [FaceBox(0, 0, width, height)]
            if analyzer is not None:
                analysis = analyzer.analyze(image, QualityPolicy(), embed=False)
                if len(analysis.faces) != 1:
                    skipped["no_single_face"] += 1
                    continue
                boxes = [analysis.faces[0].box]
            result = detector.verify(image, boxes, 0.5)[0]
            if result.score is None:
                skipped[result.status] += 1
                continue
            scores[label].append(result.score)
            if label == "attack":
                attack_types[attack_type or "unspecified"] += 1
    except ModelUnavailable as exc:
        print(str(exc), file=sys.stderr)
        return 2

    real, attack = scores["real"], scores["attack"]
    if len(real) < 2 or len(attack) < 2:
        print(f"need at least two scored real and two scored attack samples; got {len(real)}/{len(attack)}",
              file=sys.stderr)
        print(f"skipped: {dict(skipped)}", file=sys.stderr)
        return 2

    curve = roc_curve(real, attack)
    at_threshold = operating_point(real, attack, args.threshold)
    target_point = threshold_for_fnmr(real, attack, args.target_bpcer)
    resolution = 1.0 / len(real)
    warnings = ["single-frame RGB liveness is experimental and does not cover all presentation attacks"]
    if len(real) < 50 or len(attack) < 50:
        warnings.append("fewer than 50 samples per class: metrics are unstable")
    if args.target_bpcer < resolution:
        warnings.append("target BPCER is below the real-sample resolution; collect more real samples")

    suggested = None
    if target_point is not None and args.target_bpcer >= resolution:
        suggested = {
            "liveness_threshold": math.floor(target_point.threshold * 1000 + 1e-9) / 1000,
            "measured_apcer": round(target_point.false_match_rate, 6),
            "measured_bpcer": round(target_point.false_non_match_rate, 6),
        }

    report = {
        "manifest": args.manifest.name,
        "mode": args.mode,
        "model": {"name": "MiniFASNetV2", "version": "2.7_80x80", "status": "experimental"},
        "samples": {
            "rows": len(rows),
            "real_scored": len(real),
            "attack_scored": len(attack),
            "skipped": dict(skipped),
            "attack_types": dict(attack_types),
        },
        "at_threshold": {
            "threshold": args.threshold,
            "apcer": round(at_threshold.false_match_rate, 6),
            "bpcer": round(at_threshold.false_non_match_rate, 6),
            "acer": round((at_threshold.false_match_rate + at_threshold.false_non_match_rate) / 2, 6),
        },
        "roc": {"auc": round(curve.auc, 4), "eer": round(curve.eer, 6),
                "eer_threshold": round(curve.eer_threshold, 4)},
        "target_bpcer": args.target_bpcer,
        "suggested_threshold": suggested,
        "recommendation": ("keep liveness_policy=off until a documented attack evaluation supports changing it"
                           if len(real) < 50 or len(attack) < 50 else
                           "review with your institution before enabling flag or enforce"),
        "warnings": warnings,
        "ethics": "Use only bona fide and attack samples collected with consent and safe handling.",
    }

    text = json.dumps(report, indent=2)
    print(text)
    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)
    if args.json_out:
        args.json_out.write_text(text + "\n", encoding="utf-8")
    if args.scores_out:
        args.scores_out.write_text(json.dumps({"genuine": real, "impostor": attack}) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
