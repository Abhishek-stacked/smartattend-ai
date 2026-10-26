# Evaluation harness

Scripts here measure verification and presentation-attack error rates on **your own consented,
locally stored** samples. They write aggregate JSON only; images, paths and embeddings are not
stored by the scripts.

| Script | Purpose |
|---|---|
| `recognize_dataset.py` | SFace genuine/impostor scores, ROC AUC, EER, FMR-bounded threshold |
| `select_threshold.py` | Recompute a threshold from saved score lists; prints a settings snippet |
| `liveness_dataset.py` | MiniFASNetV2 APCER/BPCER/ACER and a BPCER-bounded threshold |
| `metrics.py` | NumPy-only threshold metrics, unit-tested by `backend/tests/test_evaluation_metrics.py` |

Full protocol, ethics, manifests and interpretation: [`docs/evaluation.md`](../../docs/evaluation.md).

**No model-accuracy metrics exist in this repository.** Defaults such as
`recognition_threshold = 0.42` are design choices. Run the harness on an approved set before making
accuracy claims, and keep evaluation data out of git and Docker images.
