"""Convert the official MiniFASNetV2 checkpoint to ONNX.

Run once on a development machine; the resulting ONNX file is not committed:

    pip install torch onnx onnxruntime
    python ai_service/liveness/convert_minifasnet.py --checkpoint <path to 2.7_80x80_MiniFASNetV2.pth>

The upstream checkpoint and model definition are Apache-2.0 (see
`ai_service/liveness/upstream/LICENSE`). This script refuses to overwrite an existing ONNX file
unless `--force` is given, and verifies that ONNX Runtime reproduces the PyTorch logits.
"""

import argparse
import hashlib
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "upstream"))

from MiniFASNet import MiniFASNetV2  # noqa: E402

OUTPUT = ROOT.parent / "models" / "minifasnet_v2_2.7_80x80.onnx"
DEFAULT_CHECKPOINT = ROOT / "upstream" / "2.7_80x80_MiniFASNetV2.pth"
OPSET = 17


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_model(checkpoint: Path) -> torch.nn.Module:
    state = torch.load(checkpoint, map_location="cpu", weights_only=True)
    state = {key.removeprefix("module."): value for key, value in state.items()}
    model = MiniFASNetV2(embedding_size=128, conv6_kernel=(5, 5))
    model.load_state_dict(state)
    model.eval()
    return model


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    if not args.checkpoint.is_file():
        print(f"checkpoint not found: {args.checkpoint}")
        return 2
    if args.output.exists() and not args.force:
        print(f"refusing to overwrite {args.output} (use --force)")
        return 1

    model = build_model(args.checkpoint)
    dummy = torch.randn(1, 3, 80, 80)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    tmp = args.output.with_suffix(".part.onnx")
    torch.onnx.export(
        model,
        dummy,
        tmp,
        input_names=["input"],
        output_names=["logits"],
        opset_version=OPSET,
        do_constant_folding=True,
        dynamo=False,
    )
    onnx.checker.check_model(str(tmp))

    with torch.no_grad():
        expected = model(dummy).numpy()
    session = ort.InferenceSession(str(tmp), providers=["CPUExecutionProvider"])
    actual = session.run(["logits"], {"input": dummy.numpy()})[0]
    max_delta = float(np.max(np.abs(expected - actual)))
    if max_delta > 1e-4:
        tmp.unlink(missing_ok=True)
        print(f"ONNX logits diverge from PyTorch (max delta {max_delta:.2e})")
        return 1

    tmp.replace(args.output)
    print(f"wrote {args.output} ({args.output.stat().st_size} bytes)")
    print(f"max |torch - onnx| = {max_delta:.2e}")
    print(f"sha256 {sha256(args.output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
