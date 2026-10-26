# AI Models — Provenance, Licensing, Hardware

Every model used by `ai_service/` is listed here. Model files live in `ai_service/models/` and are
**not** committed (see `.gitignore`); `ai_service/scripts/fetch_models.py` downloads them and
verifies SHA-256 checksums.

| Purpose | Model | Source | License | File | SHA-256 |
|---|---|---|---|---|---|
| Face detection | YuNet (2023mar) | OpenCV Zoo `models/face_detection_yunet` | MIT | `face_detection_yunet_2023mar.onnx` (227 KB) | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |
| Face recognition (embedding) | SFace (2021dec), 128-D | OpenCV Zoo `models/face_recognition_sface` | Apache-2.0 | `face_recognition_sface_2021dec.onnx` (37 MB) | `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` |
| Liveness / presentation-attack detection **[Experimental]** | MiniFASNetV2 (2.7_80x80) | minivision-ai/Silent-Face-Anti-Spoofing official `.pth`, converted to ONNX by `ai_service/liveness/convert_minifasnet.py` | Apache-2.0 | `minifasnet_v2_2.7_80x80.onnx` (1,743,535 bytes) | `80f419fcd375942b87d99b1f925e03046380ca40d90b2b05c58e5bd93ba2dae7` |

## Why these models

* **Licensing is clear for academic and commercial use** (MIT / Apache-2.0). The popular
  InsightFace `buffalo_l` pack was considered and rejected because its pretrained weights are
  released for non-commercial research only, and the Python package needs a C++ toolchain on
  Windows.
* **Runs on the reference CPU** (i3-1005G1, 8 GB, no GPU). YuNet and SFace are executed through
  OpenCV's built-in `cv2.FaceDetectorYN` / `cv2.FaceRecognizerSF` (no extra native dependency);
  MiniFASNet is run with ONNX Runtime (CPU).
* **Documented**: YuNet (Wu et al., 2023, *YuNet: A Tiny Millisecond-level Face Detector*),
  SFace (Zhong et al., 2021, *SFace: Sigmoid-Constrained Hypersphere Loss for Robust Face
  Recognition*), MiniFASNet (Minivision, Silent-Face-Anti-Spoofing, 2020).

## Training-data caveat

A permissive license on the *weights* does not by itself settle questions about the datasets the
authors trained on. Upstream model cards should be reviewed before any commercial deployment.
For this academic project the models are used as published, without retraining.

## Recognition decision rule

* Embedding: SFace 128-D feature from the 112×112 face aligned with YuNet's 5 landmarks
  (`alignCrop`), L2-normalised.
* Metric: cosine similarity. OpenCV's model card suggests 0.363 for LFW-style verification; the
  application default is a more conservative **0.42**. Select a deployed value on a validation
  split with `ai_service/evaluation/recognize_dataset.py` and
  `ai_service/evaluation/select_threshold.py`; see [evaluation.md](evaluation.md). No accuracy
  metrics have been measured for this project yet.
* Multi-template gallery: score(student) = max cosine over that student's templates.
* Decision: `recognized` iff score ≥ threshold **and** (best − second best) ≥ ambiguity margin;
  `low_confidence` if within `low_confidence_margin` below threshold or ambiguous; else `unknown`.
* Scores are similarities, **not probabilities**; no calibration is claimed.

## Liveness (experimental)

* MiniFASNetV2 takes the detected face box expanded by 2.7 (clamped to the frame), resized to
  80×80, converted to CHW float, scaled to `[-1, 1]`, and scored with a 3-class softmax
  (class 1 = real). The score is the class-1 probability.
* The app reports `passed` when the score is ≥ `liveness_threshold`, otherwise `failed`.
  `inconclusive` means the crop or the inference could not be evaluated (it is never a pass).
  `not_enabled` means the ONNX file is absent.
* It is a **single-frame, RGB-only** model. It is known to be weaker against high-quality replay
  attacks and unseen capture devices. It does not and cannot defeat every presentation attack.
* Default policy is `off`. Enabling `flag` or `enforce` is an institutional decision that should
  follow the evaluation in [evaluation.md](evaluation.md) on documented bona fide / attack samples.
* If the ONNX file is absent, the API reports `not_enabled` — it never simulates a pass.

### Converting the checkpoint

The upstream `.pth` is **not** committed (see `.gitignore`), and neither is the converted ONNX.

```bash
# 1. Place the official Apache-2.0 checkpoint in ai_service/liveness/upstream/
#    2.7_80x80_MiniFASNetV2.pth
# 2. Convert (requires torch, onnx, onnxruntime in the active Python)
python ai_service/liveness/convert_minifasnet.py
# 3. The script refuses to overwrite unless --force is passed, compares ONNX Runtime
#    against the PyTorch forward pass, and prints the output SHA-256.
```

Facts recorded when this project's model was produced:

| | Value |
|---|---|
| Output | `ai_service/models/minifasnet_v2_2.7_80x80.onnx` (1,743,535 bytes) |
| SHA-256 | `80f419fcd375942b87d99b1f925e03046380ca40d90b2b05c58e5bd93ba2dae7` |
| Preprocessing | BGR crop, scale 2.7 (clamped), 80×80, CHW float32, `/255`, `(x − 0.5) / 0.5` |
| ORT vs PyTorch parity | `max |torch − onnx| = 1.07e-06` on a fixed synthetic input |
| Runtime | `onnxruntime` CPUExecutionProvider, serialised inference |

A synthetic flat-colour frame scored 0.008 (`failed`) during the smoke check, which confirms
real inference rather than a placeholder pass.

## Hardware requirements

| | Minimum (tested) | Recommended |
|---|---|---|
| CPU | 2 cores, AVX2 (i3-1005G1) | 4+ cores |
| RAM | 8 GB (whole stack incl. PostgreSQL + browser) | 16 GB |
| GPU | not required | not used |
| Camera | 720p webcam | 1080p, fixed mount, front lighting |
