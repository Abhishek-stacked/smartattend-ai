#!/usr/bin/env python3
"""Measure SFace verification scores on a labelled local image set.

Manifest: CSV with header `identity,path` (one row per image, two or more images per identity).
Only aggregate numbers are written; image paths, crops and embeddings are never stored.
"""

import argparse
import csv
import json
import math
import random
import sys
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import numpy as np  # noqa: E402

from ai_service.analyzer import FaceAnalyzer, decode_image, normalize  # noqa: E402
from ai_service.evaluation.metrics import roc_curve, threshold_for_fmr  # noqa: E402
from ai_service.types import ImageDecodeError, ModelUnavailable, QualityPolicy  # noqa: E402

MAX_PAIRS = 100_000


def load_manifest(path: Path) -> list[tuple[str, Path]]:
    rows: list[tuple[str, Path]] = []
    seen: set[Path] = set()
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        missing = {"identity", "path"} - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"manifest is missing columns: {', '.join(sorted(missing))}")
        for line, row in enumerate(reader, start=2):
            identity = (row.get("identity") or "").strip()
            raw_path = (row.get("path") or "").strip()
            if not identity or not raw_path:
                raise SystemExit(f"manifest line {line}: identity and path are required")
            image_path = Path(raw_path)
            if not image_path.is_absolute():
                image_path = (path.parent / image_path).resolve()
            if image_path in seen:
                continue
            seen.add(image_path)
            rows.append((identity, image_path))
    if not rows:
        raise SystemExit("manifest has no rows")
    return rows


def reservoir(iterable, limit: int, rng: random.Random) -> list[tuple[np.ndarray, np.ndarray]]:
    sample: list[tuple[np.ndarray, np.ndarray]] = []
    for seen, item in enumerate(iterable, start=1):
        if len(sample) < limit:
            sample.append(item)
        else:
            slot = rng.randrange(seen)
            if slot < limit:
                sample[slot] = item
    return sample


def genuine_pairs(groups: list[list[np.ndarray]]):
    for group in groups:
        yield from combinations(group, 2)


def impostor_pairs(groups: list[list[np.ndarray]]):
    for first, second in combinations(groups, 2):
        for left in first:
            for right in second:
                yield left, right


def collect(analyzer: FaceAnalyzer, rows: list[tuple[str, Path]]):
    by_identity: dict[str, list[np.ndarray]] = defaultdict(list)
    rejected: Counter[str] = Counter()
    policy = QualityPolicy()
    for identity, image_path in rows:
        try:
            image = decode_image(image_path.read_bytes())
        except OSError:
            rejected["unreadable"] += 1
            continue
        except ImageDecodeError:
            rejected["not_an_image"] += 1
            continue
        analysis = analyzer.analyze(image, policy)
        if not analysis.faces:
            rejected["no_face"] += 1
            continue
        if len(analysis.faces) > 1:
            rejected["multiple_faces"] += 1
            continue
        face = analysis.faces[0]
        if not face.quality.ok or face.embedding is None:
            rejected["quality"] += 1
            continue
        by_identity[identity].append(face.embedding)
    return by_identity, rejected


def score_pairs(pairs) -> list[float]:
    return [float(np.dot(normalize(left), normalize(right))) for left, right in pairs]


def describe(values: list[float]) -> dict[str, float]:
    array = np.asarray(values, dtype=np.float64)
    return {
        "count": int(array.size),
        "mean": round(float(array.mean()), 4),
        "std": round(float(array.std()), 4),
        "min": round(float(array.min()), 4),
        "p05": round(float(np.percentile(array, 5)), 4),
        "p50": round(float(np.percentile(array, 50)), 4),
        "p95": round(float(np.percentile(array, 95)), 4),
        "max": round(float(array.max()), 4),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--models-dir", type=Path, default=REPO_ROOT / "ai_service" / "models")
    parser.add_argument("--target-fmr", type=float, default=0.001,
                        help="maximum measured false-match rate for the recommended threshold")
    parser.add_argument("--max-genuine-pairs", type=int, default=MAX_PAIRS)
    parser.add_argument("--max-impostor-pairs", type=int, default=MAX_PAIRS)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--json-out", type=Path)
    parser.add_argument("--scores-out", type=Path,
                        help="optional JSON with the raw genuine/impostor scores for select_threshold.py")
    args = parser.parse_args()

    analyzer = FaceAnalyzer(args.models_dir)
    if not analyzer.available():
        print(f"face models are missing from {args.models_dir}", file=sys.stderr)
        return 2

    rows = load_manifest(args.manifest)
    try:
        by_identity, rejected = collect(analyzer, rows)
    except ModelUnavailable as exc:
        print(str(exc), file=sys.stderr)
        return 2

    usable = [values for values in by_identity.values() if values]
    multi = [values for values in usable if len(values) >= 2]
    if len(usable) < 2 or not multi:
        print("need at least two identities with usable embeddings, and one identity with two images",
              file=sys.stderr)
        print(f"rejected: {dict(rejected)}", file=sys.stderr)
        return 2

    rng = random.Random(args.seed)
    genuine = score_pairs(reservoir(genuine_pairs(usable), args.max_genuine_pairs, rng))
    impostor = score_pairs(reservoir(impostor_pairs(usable), args.max_impostor_pairs, rng))
    if not genuine or not impostor:
        print("no genuine or impostor pairs could be formed; add more identities/images",
              file=sys.stderr)
        return 2

    curve = roc_curve(genuine, impostor)
    point = threshold_for_fmr(genuine, impostor, args.target_fmr)
    resolution = 1.0 / len(impostor)
    resolution_limited = args.target_fmr < resolution
    recommendation = None
    note = None
    if point is None:
        note = "no threshold met the target FMR on this sample"
    elif resolution_limited:
        note = (f"target FMR {args.target_fmr:.4g} is below the sample resolution "
                f"{resolution:.4g} (1/{len(impostor)} impostor pairs); collect more identities")
    else:
        recommended = math.ceil(point.threshold * 1000 - 1e-9) / 1000
        recommendation = {
            "recognition_threshold": recommended,
            "measured_fmr": round(point.false_match_rate, 6),
            "measured_fnmr": round(point.false_non_match_rate, 6),
        }

    warnings = []
    if len(usable) < 20:
        warnings.append("fewer than 20 identities: results will not generalise")
    if len(genuine) + len(impostor) < 1000:
        warnings.append("fewer than 1000 pairs: confidence intervals are wide")
    if resolution_limited:
        warnings.append("target FMR is finer than the impostor-pair resolution")

    report = {
        "manifest": args.manifest.name,
        "model": {"name": "SFace", "version": "2021dec", "embedding_dim": 128},
        "dataset": {
            "rows": len(rows),
            "identities_with_embeddings": len(usable),
            "usable_embeddings": sum(len(v) for v in usable),
            "rejected": dict(rejected),
        },
        "pairs": {"genuine": len(genuine), "impostor": len(impostor)},
        "similarity": {"genuine": describe(genuine), "impostor": describe(impostor)},
        "verification": {
            "auc": round(curve.auc, 4),
            "eer": round(curve.eer, 6),
            "eer_threshold": round(curve.eer_threshold, 4),
        },
        "operating_point": None if point is None else {
            "target_fmr": args.target_fmr,
            "threshold": round(point.threshold, 4),
            "fmr": round(point.false_match_rate, 6),
            "fnmr": round(point.false_non_match_rate, 6),
        },
        "recommendation": recommendation,
        "note": note,
        "warnings": warnings,
        "ethics": "Do not use images of people who have not consented to this evaluation.",
    }

    text = json.dumps(report, indent=2)
    print(text)
    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)
    if args.json_out:
        args.json_out.write_text(text + "\n", encoding="utf-8")
    if args.scores_out:
        args.scores_out.write_text(
            json.dumps({"genuine": genuine, "impostor": impostor}) + "\n", encoding="utf-8"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
