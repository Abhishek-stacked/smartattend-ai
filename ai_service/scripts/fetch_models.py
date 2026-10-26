"""Download the published OpenCV Zoo face models and verify their SHA-256.

Usage:
    python ai_service/scripts/fetch_models.py            # download missing files
    python ai_service/scripts/fetch_models.py --check    # verify existing files only
"""

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

MODELS = {
    "face_detection_yunet_2023mar.onnx": (
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/"
        "face_detection_yunet_2023mar.onnx",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    ),
    "face_recognition_sface_2021dec.onnx": (
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/"
        "face_recognition_sface_2021dec.onnx",
        "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    ),
}

MODEL_DIR = Path(__file__).resolve().parents[1] / "models"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify(name: str) -> bool:
    _, expected = MODELS[name]
    path = MODEL_DIR / name
    if not path.is_file():
        print(f"missing  {name}")
        return False
    actual = sha256(path)
    if actual != expected:
        print(f"BAD HASH {name}\n  expected {expected}\n  actual   {actual}")
        return False
    print(f"ok       {name}")
    return True


def download(name: str) -> None:
    url, expected = MODELS[name]
    path = MODEL_DIR / name
    if path.is_file() and sha256(path) == expected:
        print(f"ok       {name}")
        return
    print(f"fetching {name}")
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    with urllib.request.urlopen(url, timeout=120) as response, tmp.open("wb") as handle:
        while chunk := response.read(1024 * 1024):
            handle.write(chunk)
    actual = sha256(tmp)
    if actual != expected:
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"checksum mismatch for {name}: {actual}")
    tmp.replace(path)
    print(f"ok       {name}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify files without downloading")
    args = parser.parse_args()
    if args.check:
        return 0 if all(verify(name) for name in MODELS) else 1
    for name in MODELS:
        download(name)
    return 0 if all(verify(name) for name in MODELS) else 1


if __name__ == "__main__":
    sys.exit(main())
