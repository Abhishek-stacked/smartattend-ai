# Project Report Material

This file is a **drafting kit** for the final report and the project record. Replace every
`<placeholder>` with your own details. Do not paste values from examples, do not claim accuracy or
field results that were not measured, and keep the wording honest about what is experimental.

Related sources: [srs.md](srs.md) · [diagrams.md](diagrams.md) · [architecture.md](architecture.md) ·
[privacy-security.md](privacy-security.md) · [evaluation.md](evaluation.md) ·
[deployment.md](deployment.md) · [viva-prep.md](viva-prep.md)

---

## Front matter (template)

| Field | Value |
|---|---|
| Title | SmartAttend AI: An Intelligent Facial Recognition-Based Attendance Management System with Liveness Verification, Real-Time Monitoring, and Web-Based Analytics |
| Student | `<Full name>` `<Roll/registration number>` |
| Programme / department | `<B.Tech CSE / department>` |
| Institution | `<Institution>` |
| Academic year | `<2026–27>` |
| Project guide | `<Guide name and designation>` |
| Co-guide (if any) | `<Name>` |
| Submission date | `<DD Month YYYY>` |

**Declaration / certificate / acknowledgements:** use the institution's prescribed pages. Do not
include real participant images, credentials or personal data in the report or its annexures.

---

## Abstract (draft)

Manual attendance is slow, easy to proxy, and produces records that are difficult to audit.
SmartAttend AI is a single-institution web system that records attendance for scheduled classes
using consent-based facial recognition, with an explicit human-review path for uncertain results.
The system combines a React/TypeScript front end with a FastAPI backend and PostgreSQL, and runs
OpenCV YuNet and SFace plus an optional, experimental MiniFASNetV2 liveness model entirely on a
CPU. Students are enrolled only after recorded informed consent; only AES-256-GCM-encrypted 128-D
embeddings are stored, while raw frames and enrolment images are discarded. A frame can produce
recognised, low-confidence, unknown, poor-quality, duplicate, not-eligible or liveness-failure
outcomes; only a confident, eligible match inside an active, owned session creates attendance.
Uncertain and failed-liveness cases are queued for staff decision, and students can request
corrections. Administrators get role-scoped dashboards, tabular reports, CSV/PDF exports and an
append-only audit trail. The implementation is covered by automated backend and frontend tests and
ships as a three-container deployment. Liveness remains experimental and recognition/PAD accuracy
has not yet been measured; the project therefore reports these limitations explicitly rather than
implying production-grade biometric assurance.

> Keep the abstract under ~300 words. Add measured accuracy/latency **only** after completing
> [evaluation.md](evaluation.md).

---

## 1. Introduction

### 1.1 Background

Attendance is an academic record, not merely a convenience. Proxy attendance and delayed manual
entry undermine its integrity; biometrics can reduce friction but introduce privacy, consent,
accuracy, bias and security risks. A responsible design must make the biometric step optional,
minimise what is stored, and keep people accountable for uncertain decisions.

### 1.2 Problem statement

Design and implement a web-based attendance system that (a) recognises consenting students from a
webcam frame under staff supervision, (b) never silently marks uncertain identities, (c) stores no
raw face images and protects templates cryptographically, (d) provides role-scoped attendance
history, analytics and exports, and (e) is deployable on low-cost CPU-only hardware.

### 1.3 Objectives

1. Implement a secure multi-role web application (admin, faculty, student) with server-enforced RBAC.
2. Implement consent-gated enrolment with quality checks, duplicate-identity checks, encrypted
   templates and deletion/retention.
3. Build a live recognition pipeline with calibrated decision rules: threshold, ambiguity margin,
   cooldown, eligibility and duplicate protection.
4. Integrate an experimental liveness signal that never fabricates a pass and support `off`, `flag`
   and `enforce` policies.
5. Provide review, manual attendance, correction requests and an audit trail for accountability.
6. Provide dashboards, reports and safe CSV/PDF exports.
7. Deliver automated tests, documentation and a reproducible deployment.
8. State limitations honestly and provide an evaluation harness for future accuracy work.

### 1.4 Scope and contributions

* A **conservative decision model**: low-confidence and ambiguous matches are reviewed, not marked.
* A **privacy-first storage model**: no raw images/video; encrypted embeddings with AEAD binding;
  consent lifecycle and retention purge.
* **Operational safeguards**: CSRF, lockout, rate limits, session revocation, audit, safe exports,
  production configuration guard.
* A **complete engineering artefact**: tests, deployment automation, SRS, diagrams and evaluation
  methodology.

### 1.5 Organisation of the report

Chapter 2 reviews background; Chapter 3 covers requirements and design; Chapter 4 describes
implementation; Chapter 5 presents verified results; Chapter 6 defines the evaluation plan;
Chapter 7 discusses limitations and ethics; Chapter 8 concludes.

---

## 2. Background and related work

### 2.1 Attendance approaches

| Approach | Strengths | Weaknesses |
|---|---|---|
| Roll call / paper sign | Simple, no biometrics | Slow, proxy-prone, transcription errors |
| RFID / ID cards | Fast, inexpensive | Card sharing, loss, replacement cost |
| PIN / mobile check-in | No special hardware | Credential sharing, location spoofing |
| Face recognition | Contactless, fast for groups | Privacy, bias, spoofing, consent, false matches |
| Face + liveness | Adds presentation-attack resistance | Still not proof of identity; model/device variation |

This project combines face recognition with staff supervision, optional liveness, conservative
thresholds and a review queue. It does not replace institutional identity proofing.

### 2.2 Face detection and recognition

* **YuNet** (Wu et al., 2023) is a compact CNN detector with landmark output, suitable for CPU
  inference and fast alignment.
* **SFace** (Zhong et al., 2021) produces a 128-D embedding trained with a sigmoid-constrained
  hypersphere loss; verification uses cosine similarity after alignment.
* Matching here uses max cosine over a student's templates, a threshold and a runner-up margin. Scores
  are similarities, not calibrated probabilities.

### 2.3 Presentation-attack detection

MiniFASNet (Minivision, 2020) is a lightweight single-frame PAD model. It was trained against print
and replay attacks on a particular pipeline; it is **not** certified anti-spoofing and can fail on
unseen devices or high-quality attacks. This project labels it experimental and defaults the policy
to `off`. A pass is evidence, not proof; a failure sends the case to a human.

### 2.4 Privacy and security literature/practice

The design follows data minimisation and consent principles, Argon2id password hashing (RFC 9106),
server-side opaque sessions, double-submit CSRF, AEAD encryption for templates, and append-only
audit. It avoids cloud face APIs and does not collect demographic attributes. Legal compliance
remains institution-specific.

### 2.5 Gap addressed

Many student attendance projects demonstrate recognition but omit consent, retention, review,
audit, duplicate/concurrency guarantees and honest model limitations. This project treats those as
first-class requirements and documents what remains unmeasured.

---

## 3. Requirements and design

### 3.1 Requirements summary

The authoritative requirement list is [srs.md](srs.md). In the report, include a condensed table of
the 8–10 most important functional requirements and 5 non-functional requirements, with IDs. Mention
that 116 individually traceable requirement IDs exist and link the SRS appendix.

### 3.2 Architecture

Use the diagrams from [diagrams.md](diagrams.md):

* system context and container view (report Figure 3.1);
* component responsibilities (Figure 3.2);
* deployment topology (Figure 3.3).

Explain why the AI code is a separate package but runs in-process: CPU/memory constraints, explicit
boundary, no database access from AI, and a future extraction path.

### 3.3 Data model

Summarise the ER diagram and invariants: one attendance row per student/session, roster snapshots,
encrypted templates, consent linkage, append-only audit. Full schema in
[database-design.md](database-design.md). Include the attendance-percentage definition
verbatim; it is a common viva question.

### 3.4 Recognition decision design

Include a decision table:

| Condition | Outcome | Attendance |
|---|---|---|
| No face | `no_face` | No |
| Quality fails | `poor_quality` | No |
| Faces > `max_faces_per_frame` | `multiple_faces` | No |
| Score < threshold − low margin | `unknown` | No |
| Score < threshold or margin < ambiguity | `low_confidence` | No, review pending |
| Matched student inactive/not in roster | `not_eligible` | No, candidate recorded for reviewer |
| Liveness `enforce` and not passed | `liveness_failed` / `error` | No |
| Liveness `flag` and failed/inconclusive | `recognized` | Yes, review pending |
| Confident, eligible, allowed | `recognized` | Yes, once |
| Already recorded / within cooldown | `duplicate` | No new row |

### 3.5 Security and privacy design

Summarise [privacy-security.md](privacy-security.md): threat model, encryption, session/CSRF,
RBAC, raw-frame lifecycle, audit, retention. Include a data-inventory table and a note that keys and
database backups must be separate.

---

## 4. Implementation

### 4.1 Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, React Router, Lucide, Recharts (lazy chunk) |
| Backend | Python 3.10, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, psycopg 3 |
| AI | OpenCV YuNet + SFace, ONNX Runtime (MiniFASNetV2), NumPy |
| Data | PostgreSQL 16 |
| Security | Argon2id, opaque sessions, CSRF double submit, AES-256-GCM, CSP/security headers |
| Testing | Pytest, Vitest, React Testing Library |
| Deployment | Docker Compose: PostgreSQL + uvicorn API + nginx SPA |

### 4.2 Backend modules

Describe the layered structure (`api/routes` → `services` → `models`), key services (auth, users,
people, courses, sessions, attendance, biometrics, recognition, review, corrections, reports,
settings, audit), and the stable error envelope. Mention that ownership checks live in services, not
only routes.

### 4.3 Recognition and liveness implementation

* YuNet detection with 5 landmarks, SFace alignment and 128-D embedding, L2 normalisation.
* Session gallery loaded/decrypted only for the active session; matching is max cosine per student.
* Quality gates: face size, Laplacian variance, mean brightness.
* Cooldown suppresses repeat events; DB unique constraint is the final duplicate guard.
* Liveness crop expansion ×2.7, 80×80, softmax class-1 probability; missing/inconclusive never pass.
* All decisions are made in backend services; `ai_service` returns structured values only.

### 4.4 Frontend implementation

Role-aware shell and route guards; camera opens only on explicit action; sampled frames; clear
outcome messages; review queue; correction workflows; lazy-loaded charts; accessible labels and
keyboard-operable dialogs. Mention the production build split (see §5.1) and that the UI never
displays a fabricated success before the server commits.

### 4.5 Deployment

Describe local (portable PostgreSQL, venv, Vite proxy) and Compose (three services, one published
port, read-only models, migrations on start, healthchecks, production config guard, interactive
first admin). Link [deployment.md](deployment.md). Be explicit if you did not run Docker on the
submission machine.

### 4.6 Testing approach

Unit, integration and API tests with a real test database; scripted analyzer for deterministic
biometric tests without participant images; frontend tests with a stubbed API; threshold-metric
unit tests; static validation of Compose/shell/nginx. State what tests do **not** prove: real-model
accuracy, accessibility certification, load limits or field usability.

---

## 5. Results and evidence

### 5.1 Verified engineering results

Record the final run on `<date>` and `<machine/OS>`.

| Check | Result |
|---|---|
| Backend test suite | **80 passed** (includes auth, RBAC, sessions, biometrics, review, corrections, reports, hardening, metrics, retention) |
| Frontend test suite | **41 passed** in 13 files |
| Lint / type-check | oxlint 0 warnings/errors; `tsc --noEmit` clean |
| Production build | `index` 465.20 kB (126.48 kB gzip); lazy `AttendanceCharts` 373.03 kB (107.34 kB gzip); CSS 34.42 kB (7.24 kB gzip) |
| Compose / shell validation | YAML parses; services `db`, `api`, `web`; entrypoint passes `sh -n`; LF line endings |
| Model integrity | SHA-256 checks recorded; ORT↔PyTorch parity `max |torch − onnx| = 1.07e-06`; synthetic flat frame scored 0.008 (failed) |
| Feature demonstration | Manual scenarios in [srs.md](srs.md) §8.2 — attach screenshots listed in Appendix C |

If any result changes, update this table instead of copying stale numbers. Never present the counts
as evidence of face-recognition accuracy.

### 5.2 Explicitly unmeasured

* Recognition accuracy, ROC, EER, FMR/FNMR on real participants.
* Liveness APCER/BPCER/ACER and robustness to replay/deepfake.
* End-to-end latency on the reference machine (design estimates only).
* Demographic bias/fairness; no demographic data is collected.
* Long-term retention/backup recovery drills, accessibility audit, load test, penetration test.
* Real Docker build/run if Docker was unavailable during development.

### 5.3 Feature summary

Include a feature table with status: implemented, experimental (liveness), planned (multi-worker
rate limiting, evaluation, SSO, etc.). Cross-reference the SRS. This prevents overclaiming.

---

## 6. Evaluation plan (recommended next step)

1. Obtain ethics/guide approval and informed consent for an evaluation set.
2. Collect at least 20–30 identities with 2–5 images each across lighting/pose; keep data outside
   the repo.
3. Run `recognize_dataset.py`; report AUC, EER, threshold at the stated FMR, pair counts and rejected
   frames.
4. For liveness, collect ≥ 50 real and ≥ 50 attack samples across print/replay/device types; run
   `liveness_dataset.py` in crop mode; report APCER/BPCER/ACER and sample counts.
5. Tune `ambiguity_margin` using a gallery simulation, never from pairwise scores alone.
6. Measure latency in a browser against the deployed stack and report percentiles with hardware.
7. Add results to [evaluation.md](evaluation.md) and this chapter, including limitations.

Do not run evaluation on students without an approved protocol or reuse attendance images.

---

## 7. Discussion

### 7.1 Strengths

Honest uncertainty handling; privacy-by-design storage; strong transactional and audit guarantees;
consistent role scoping; safe exports; reproducible deployment; extensive automated checks; explicit
documentation of experimental status.

### 7.2 Limitations

Single-frame RGB liveness; unmeasured accuracy/bias; CPU-bound serialised inference; in-process
rate limiting assumes one worker; no MFA/SSO; no email delivery; no formal accessibility audit; no
certified PAD; biometric encryption protects confidentiality but not a fully compromised host.

### 7.3 Ethical considerations

Biometrics are sensitive and can be coercive if attendance is mandatory. The project records consent,
offers manual alternatives and deletion, minimises retention, and keeps humans in the loop. The
institution must ensure participation is genuinely voluntary and that no one is penalised for
declining biometrics.

### 7.4 Threats to validity

Tests use scripted analyzers for most backend biometric logic, so they validate rules, not model
accuracy. Any future evaluation on a convenience sample may not generalise across cameras, skin
tones, ages or attack types. Engineering counts (tests, bundle size) are not user outcomes.

---

## 8. Conclusion and future work

The project delivers a complete, defensible attendance system: consent and encryption, conservative
recognition with review, liveness that never lies about availability, auditable corrections, and
role-scoped analytics, packaged with tests and deployment automation. Its most important claim is
not that face recognition is perfect, but that the system refuses to pretend it is. Next steps are a
documented evaluation study, shared rate-limit store for horizontal scaling, multi-factor
authentication/SSO, and certified liveness research.

---

## References (examples — verify formatting required by your department)

1. J. Wu et al., "YuNet: A Tiny Millisecond-level Face Detector," *Machine Intelligence Research*, 2023.
2. Y. Zhong et al., "SFace: Sigmoid-Constrained Hypersphere Loss for Robust Face Recognition," *IEEE TIP*, 2021.
3. Minivision, "Silent-Face-Anti-Spoofing," GitHub, 2020. Apache-2.0.
4. OpenCV Zoo, "Face Detection YuNet (2023mar)" and "Face Recognition SFace (2021dec)."
5. IETF RFC 9106, "Argon2 Memory-Hard Function for Password Hashing and Proof-of-Work Applications," 2021.
6. OWASP Application Security Verification Standard; OWASP CSRF Prevention Cheat Sheet.
7. NIST, "Face Recognition Vendor Test (FRVT)" reports (for context on evaluation practice).
8. Institutional biometric policy / DPDP Act 2023 or GDPR references used by your institution.
9. Project repository documentation: SRS, architecture, database, API, evaluation, deployment.

---

## Appendices

### A. Reproduce the build and tests

```bash
# Backend
cd backend
.venv/Scripts/alembic upgrade head
.venv/Scripts/python -m pytest -o addopts="--strict-markers" -q

# Frontend
cd ../frontend
npm install
npm test
npm run lint
npm run build
```

### B. Demonstration sequence (10–12 minutes)

1. Sign in as admin; show dashboard and role-filtered navigation.
2. Show a student record, consent status, and (fictional) enrolment flow.
3. Start a session as faculty; recognise a face; show duplicate suppression.
4. Show a low-confidence/liveness-flagged event in review and resolve it.
5. Show the student's correction request and staff approval/rejection.
6. Open reports, filter, export CSV/PDF; show audit entries.
7. Show the production guard/liveness-unavailable behaviour conceptually; close with limitations.

### C. Screenshots / figures to capture

* Login and role-based dashboard with charts.
* Consent notice and enrolment quality feedback.
* Live recognition showing a confident result and an uncertain result.
* Review queue with a resolved event.
* Student correction request; staff decision.
* Reports table and exported PDF/CSV.
* Audit log; deployment architecture from [diagrams.md](diagrams.md).

Use fictional demo data only (the `seed-demo` command). Do not include real faces, emails or
credentials.

### D. Abbreviations

API, APCER, BPCER, ACER, AES-GCM, CSRF, EER, FMR, FNMR, RBAC, ROC, SPA, SRS, TLS, TTL.
