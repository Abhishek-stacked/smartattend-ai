#!/usr/bin/env python3
"""Choose an operating threshold from saved genuine/impostor scores.

Input is the `--scores-out` file produced by `recognize_dataset.py` or
`liveness_dataset.py`. The script prints a settings snippet; it never changes the database.
"""

import argparse
import json
import math
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ai_service.evaluation.metrics import roc_curve, threshold_for_fmr, threshold_for_fnmr  # noqa: E402


def load_scores(path: Path) -> tuple[list[float], list[float]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        genuine = [float(value) for value in payload["genuine"]]
        impostor = [float(value) for value in payload["impostor"]]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise SystemExit(f"could not read scores from {path}: {exc}") from exc
    if not genuine or not impostor:
        raise SystemExit("both genuine and impostor score lists must be non-empty")
    return genuine, impostor


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scores", required=True, type=Path)
    parser.add_argument("--target-fmr", type=float,
                        help="bound the false-match rate (recognition / APCER)")
    parser.add_argument("--target-fnmr", type=float,
                        help="bound the false-non-match rate (liveness BPCER)")
    parser.add_argument("--json-out", type=Path)
    args = parser.parse_args()
    if (args.target_fmr is None) == (args.target_fnmr is None):
        parser.error("pass exactly one of --target-fmr or --target-fnmr")

    genuine, impostor = load_scores(args.scores)
    curve = roc_curve(genuine, impostor)
    resolution = 1.0 / len(impostor if args.target_fmr is not None else genuine)
    target = args.target_fmr if args.target_fmr is not None else args.target_fnmr
    assert target is not None
    point = (threshold_for_fmr if args.target_fmr is not None else threshold_for_fnmr)(
        genuine, impostor, target
    )
    report = {
        "pairs": {"genuine": len(genuine), "impostor": len(impostor)},
        "auc": round(curve.auc, 4),
        "eer": round(curve.eer, 6),
        "eer_threshold": round(curve.eer_threshold, 4),
        "target": {"fmr": args.target_fmr, "fnmr": args.target_fnmr},
        "resolution": round(resolution, 6),
        "operating_point": None,
        "settings": None,
        "note": None,
    }
    if point is None:
        report["note"] = "no threshold met the target on this sample"
    else:
        report["operating_point"] = {
            "threshold": round(point.threshold, 4),
            "fmr": round(point.false_match_rate, 6),
            "fnmr": round(point.false_non_match_rate, 6),
        }
        if target < resolution:
            report["note"] = (
                "target is below the sample resolution; collect more data before deploying this threshold"
            )
        elif args.target_fmr is not None:
            # Round up so the deployed FMR stays at or below the measured operating point.
            report["settings"] = {"recognition_threshold": math.ceil(point.threshold * 1000 - 1e-9) / 1000}
        else:
            # Round down so the deployed BPCER stays at or below the measured operating point.
            report["settings"] = {"liveness_threshold": math.floor(point.threshold * 1000 + 1e-9) / 1000}

    print(json.dumps(report, indent=2))
    if args.json_out:
        args.json_out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return 0 if report["settings"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
