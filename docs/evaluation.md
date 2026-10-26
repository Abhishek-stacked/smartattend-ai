# AI Evaluation Protocol and Status

> **Status: no accuracy, ROC, EER, APCER or latency metrics have been measured for this project.**
> The harness is implemented and smoke-tested for plumbing only. Do not put numbers in the report,
> slides or viva until you have collected an approved evaluation set and run the commands below.
> The application defaults are conservative design choices, not measured optima.

## 1. What is evaluated

| Component | Question | Script |
|---|---|---|
| SFace verification | How often are same-person pairs below the threshold, and different-person pairs above it? | `recognize_dataset.py` |
| Threshold choice | Which similarity threshold meets an institution's false-match budget? | `select_threshold.py` |
| MiniFASNetV2 (experimental) | How often are real faces rejected (BPCER) and attack samples accepted (APCER)? | `liveness_dataset.py` |
| End-to-end latency | Detection + embedding + liveness time per frame | out of scope here; measure in a browser/API run |

Detection and quality filtering are applied exactly as in the deployed path: YuNet at confidence
0.6, quality policy from `application_settings` (face ≥ 80 px, blur ≥ 60, brightness 50–210).
Therefore a "usable embedding" in the harness means the same thing as in production.

## 2. Data requirements and ethics

1. **Consent first.** Every participant must consent to evaluation use, separately from attendance
   consent. Prefer staff/volunteer participants over students who may feel pressured.
2. **Minimise.** Use the smallest set that supports the claim; do not collect identity documents,
   demographics or unrelated images.
3. **Storage.** Keep the evaluation set outside the repository (for example
   `ai_service/evaluation/data/`, already ignored by `.gitignore` and `.dockerignore`). Do not commit
   images, crops, embeddings or score files that identify participants.
4. **Variation matters.** Include lighting, distance, glasses, head pose and camera differences.
   For liveness, include print, screen replay and different devices/qualities. Report attack types
   only as counts.
5. **Labels.** A pair label is *genuine* when both images are the same consenting person, otherwise
   *impostor*. For liveness, `real` is a live person; `attack` is a presentation attack.
6. **No cherry-picking.** Freeze the manifest and run once; if you change it, report both runs.
7. **Small samples.** With fewer than ~20 identities or 50 samples per liveness class, treat results
   as a smoke test, not evidence. The scripts emit warnings below these thresholds.

## 3. Recognition verification

### Manifest

```csv
identity,path
p001,images/p001_a.jpg
p001,images/p001_b.jpg
p002,images/p002_a.jpg
p002,images/p002_b.jpg
```

Paths are relative to the manifest file. Two or more images per identity are needed for genuine
pairs; at least two identities are needed for impostor pairs. Rows with no face, more than one face or
failed quality checks are counted as rejected, not silently included.

### Run

```bash
cd smartattend-ai
python ai_service/evaluation/recognize_dataset.py \
  --manifest ai_service/evaluation/data/faces.csv \
  --target-fmr 0.001 \
  --json-out ai_service/evaluation/results/faces.json \
  --scores-out ai_service/evaluation/results/face_scores.json
```

The script computes:

* genuine/impostor similarity distributions (mean, standard deviation, 5th/50th/95th percentile);
* ROC AUC and the equal-error rate (EER) with its threshold;
* the **lowest threshold whose measured FMR is still ≤ target** — this maximises genuine acceptance
  under the institution's false-match budget;
* a settings snippet (`recognition_threshold`) rounded **up** to three decimals so deployment does
  not increase FMR.

The FMR resolution is `1 / number_of_impostor_pairs`. If the target is finer than that (e.g. 0.1 %
with 400 pairs), the script refuses to produce a deployment recommendation and says why. Collect
more distinct identities rather than reusing pairs.

`low_confidence_margin` and `ambiguity_margin` cannot be selected from pairwise scores alone: they
depend on the number of enrolled students and on multi-template galleries. Tune them with a
session-level simulation that builds a gallery from one image per identity and probes with the rest,
and never below the EER threshold.

### Selecting a threshold from saved scores

```bash
python ai_service/evaluation/select_threshold.py \
  --scores ai_service/evaluation/results/face_scores.json \
  --target-fmr 0.001
```

This prints the operating point and a `recognition_threshold` snippet. It does **not** write to the
database; apply values through Admin → Settings after review, and record the change in the report.

## 4. Liveness (experimental)

### Manifest

```csv
label,path,attack_type
real,images/real_01.jpg,
real,images/real_02.jpg,
attack,images/print_01.jpg,print
attack,images/replay_01.jpg,screen_replay
```

* `--mode crops` (default): each image is treated as an already-cropped face. Use this to compare
  the model fairly with published PAD protocols.
* `--mode full-frames`: YuNet runs first; frames without exactly one detected face are skipped and
  counted. This reflects what the application can score, but mixes detection failures into the
  result — report that distinction.

```bash
python ai_service/evaluation/liveness_dataset.py \
  --manifest ai_service/evaluation/data/liveness.csv \
  --mode crops \
  --threshold 0.8 \
  --target-bpcer 0.05 \
  --json-out ai_service/evaluation/results/liveness.json
```

Metrics:

* **APCER** = attack samples accepted (score ≥ threshold), equivalent to FMR here.
* **BPCER** = real samples rejected (score < threshold), equivalent to FNMR.
* **ACER** = (APCER + BPCER) / 2 at the reported threshold.
* EER and the EER threshold from the score ROC.
* A suggested threshold for a chosen BPCER budget, rounded **down** so deployment does not raise
  BPCER.

The script always emits a warning that single-frame RGB liveness does not cover all presentation
attacks, and recommends leaving `liveness_policy=off` while evidence is weak. A small sample cannot
justify `enforce`.

## 5. Interpreting and reporting results

| Quantity | Honest wording |
|---|---|
| AUC / EER | "on the collected set of N identities and M pairs" — never "the model's accuracy" |
| FMR target | state the target, the measured operating point and the pair count |
| Liveness | "experimental, single-frame; evaluated on X real and Y attack samples of types Z" |
| Latency | measure on the deployment machine; the numbers in `architecture.md` are design estimates |
| Failure cases | report rejected frames, skipped samples and their reasons, not only successful ones |

Do not claim demographic fairness, anti-deepfake robustness, GDPR/DPDP compliance certification, or
production readiness from this harness. It measures verification and PAD error rates on a convenience
sample. Any claim about bias needs demographic metadata that this project deliberately does not
collect.

## 6. Current evidence in the repository

| Claim | Evidence |
|---|---|
| Models run real inference and are not stubs | `ai-models.md`: SHA-256 checks, ONNX Runtime vs PyTorch parity `max \|torch − onnx\| = 1.07e-06`, flat synthetic frame scored 0.008 (`failed`) |
| The API never fakes a liveness pass | Unit/integration tests: missing model → `not_enabled`; failed check → `failed`/review |
| Threshold maths | `backend/tests/test_evaluation_metrics.py` covers AUC ties, ROC/EER, FMR/FNMR threshold selection and invalid inputs |
| Face accuracy | **not measured** — run the harness above |
| PAD accuracy | **not measured** — run the harness above |
| End-to-end latency | **not measured** on the reference machine — design estimates only |
