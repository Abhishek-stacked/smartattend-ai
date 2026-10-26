# Viva Preparation

Use this as a rehearsal guide, not a script to memorise. Examiners reward precise, honest answers
and a working demonstration more than buzzwords. Never claim measured accuracy, legal certification
or production readiness that the project does not have.

## 1. Elevator pitch (30 seconds)

"SmartAttend AI is a consent-based attendance system. A faculty browser samples camera frames; the
backend uses YuNet and SFace to find and match faces against the session roster, with an optional
experimental liveness check. It only marks a student when the match is confident and the student is
eligible. Anything uncertain goes to a staff review queue. We store no raw images, encrypt the
templates, audit every sensitive action, and provide role-scoped reports. The whole stack runs on a
CPU and deploys with Docker Compose."

## 2. Two-minute architecture answer

"Three tiers: a React SPA, a FastAPI backend and PostgreSQL. The SPA never decides identity or
attendance. The backend authenticates the operator with an opaque HttpOnly cookie and CSRF token,
checks that the session is active and belongs to the faculty member, then calls the in-process
`ai_service` package. That package only does detection, quality checks, embeddings, matching and
optional liveness — it never touches the database. Matching is max cosine over each student's
templates, with a threshold and an ambiguity margin. A confident, eligible match is inserted in the
same transaction as a recognition event, and `UNIQUE(session_id, student_id)` prevents duplicates.
Uncertain or liveness-failed frames create review events instead. Reports are aggregated on request
within the caller's scope. We chose in-process AI over a microservice because the target is a CPU-only
8 GB machine, and the package boundary still allows extraction later."

## 3. Demonstration runbook

### Before the viva

- [ ] PostgreSQL running; backend on `:8000`; frontend on `:5173` (or the built stack).
- [ ] Models verified: `python ai_service/scripts/fetch_models.py --check`.
- [ ] Demo data seeded with **fictional** identities; no real participant images.
- [ ] Test run: login, dashboard, one recognition, one review, one report export.
- [ ] Credentials only in `.env`; do not display the file on screen.
- [ ] Camera/permissions tested; window pre-sized; notifications off.

### Live sequence (10 minutes)

1. **Login as admin.** Point out role-filtered navigation and the dashboard (charts load lazily).
2. **Show a student.** Consent status, biometric status; explain no raw images are stored.
3. **Start a session as faculty.** Show the state machine (`scheduled → active`).
4. **Recognition.** Recognize a fictional enrolled face; show "Attendance recorded"; repeat to show
   duplicate suppression. If possible, show an unknown/low-confidence outcome and the review queue.
5. **Resolve a review.** Show the note requirement and that attendance is only then created.
6. **Student flow.** Submit a correction; approve it as faculty; show audit before/after. Optionally
   reject one and show the record unchanged.
7. **Student self-marking.** Switch on *Student self-marking* for the session, log in as a student,
   press *Mark me present*, then lock that student from the roster and show the button disappear
   with a reason. The record carries `source = self_reported`, so it is never confused with a
   biometric match.
8. **Reports.** Filter, show the server-defined table, export CSV and PDF.
9. **Security/ops.** Show remote access blocked, audit log, health endpoint, production guard and
   liveness-unavailable behaviour (explain, don't break the live demo).

### Recovery if the camera fails

Explain the manual attendance path and show the session roster mark. Do not fake a recognition
result. This is a legitimate fallback and demonstrates graceful degradation.

## 4. Questions and model answers

### Architecture and design

**Q: Why a monolith rather than microservices?**
A: The deployment target is one CPU-only machine (8 GB, no GPU). Separate AI/database services would
double model memory and add latency for no functional benefit. The AI package has a clean interface
and no DB imports, so extracting it later is straightforward. The trade-off is independent scaling.

**Q: Why is the frontend not trusted?**
A: Anyone can modify a browser. Identity, role, eligibility, thresholds and attendance status are
derived server-side; the UI only renders. Forbidden objects return 404 where revealing existence
is itself a leak.

**Q: What happens if two requests mark the same student concurrently?**
A: Events and records are written in one transaction; `INSERT ... ON CONFLICT (session_id,
student_id) DO NOTHING` guarantees one row. If no row is returned, the event becomes `duplicate`.
That's stronger than a check-then-insert.

**Q: Why snapshot the roster?**
A: Course enrolments change. The session roster is captured at creation and kept in sync with the
course while the session is open (`scheduled`/`active`/`paused`); closed and finalized sessions keep
their roster so historical attendance stays explainable. Finalisation creates `absent` only for that
snapshot.

**Q: Why is the session state machine important?**
A: It blocks marking on scheduled/closed/finalized sessions, prevents ambiguous edits, and requires
an audited admin reopen. Without it, late changes could silently rewrite records.

### AI and recognition

**Q: Which models and why?**
A: YuNet (MIT) for fast CPU detection, SFace (Apache-2.0) for 128-D embeddings, MiniFASNetV2
(Apache-2.0) as experimental liveness. We avoided InsightFace's `buffalo_l` because its weights are
non-commercial and the toolchain is heavier. Model files are checksum-verified and not committed.

**Q: How does matching work?**
A: Detect faces, align with YuNet landmarks, compute an L2-normalised SFace embedding, and compare
cosine similarity against the session gallery. A student's score is the max over their templates.
Accept only if the best score ≥ threshold and best − runner-up ≥ ambiguity margin. Scores are
similarities, not probabilities.

**Q: What is the threshold and how did you choose 0.42?**
A: It is a conservative design default, not a measured optimum. OpenCV's card suggests 0.363 for
LFW-style verification; we chose 0.42 to reduce false accepts. The correct process is to select a
threshold on a consented validation set with the evaluation harness at a stated FMR target. Until
that is done, we don't claim accuracy.

**Q: What happens in low confidence?**
A: Scores in the band near the threshold, or a small lead over the runner-up, produce
`low_confidence` and a pending review event; no attendance is created. Staff see the candidate and
similarity, but the candidate is not exposed to students.

**Q: Why do you reject multiple faces in a frame?**
A: With more than `max_faces_per_frame` faces we cannot reliably attribute an identity, so the frame
becomes `multiple_faces` and no one is marked. It avoids accidental bulk marking and remains safe in
crowded scenes.

**Q: What about people not on the roster?**
A: A confident match to an inactive or non-roster student is `not_eligible`; no attendance. The
candidate is recorded for reviewers, not returned in the API response. Unknown people simply don't
match above the threshold.

**Q: What about bias?**
A: It is unmeasured and unknown. The models are third-party, so their training data may not represent
your population. We minimise harm with conservative thresholds, human review and a manual
alternative. An honest evaluation with demographic analysis would require approved metadata we
deliberately don't collect; that's future work, not a solved problem.

**Q: Why don't you claim "face recognition accuracy of X%"?**
A: Accuracy depends on dataset, thresholds, demographics, cameras and attack types. We have not run a
documented evaluation, so any number would be fabricated. The harness and protocol are provided; the
report must state results only after running it.

### Liveness and spoofing

**Q: How does liveness work?**
A: MiniFASNetV2 scores an expanded face crop as real vs print/replay using a 3-class softmax; we use
the real-class probability. Policy `flag` marks confident identities but queues failed/inconclusive
checks for review. Policy `enforce` refuses to mark unless the score passes.

**Q: Is that enough to prevent spoofing?**
A: No. It is a single-frame RGB model trained on a particular attack distribution. High-quality
replays, unseen devices and deepfakes may pass. It is labelled experimental, defaults to `off`, and
never substitutes for staff supervision. Certified PAD or challenge-response is future work.

**Q: What if the model is missing or crashes?**
A: The API reports `not_enabled` or `inconclusive`; under `enforce` the student is not marked and the
UI shows an explicit `liveness_unavailable` message. The code never converts absence of evidence
into a pass. A test enforces this.

**Q: Can a student mark attendance from home?**
A: Only with an authenticated faculty/admin account operating an active session they own; the system
is a staff station, not a self-service check-in. It does not currently bind attendance to a specific
device or network; that's an institutional control gap.

### Privacy and ethics

**Q: What personal/biometric data do you store?**
A: Account data, consent records, encrypted 128-D templates with non-identifying quality values,
attendance, recognition metadata and audit. No raw images or video, no plaintext embeddings, no
passwords or tokens. Details are in the privacy document.

**Q: How are templates protected?**
A: AES-256-GCM with a per-row random nonce and associated data binding the student id, model and
version, so a moved ciphertext fails to decrypt. Keys are environment-supplied, support `key_id`
rotation and must be backed up separately. Decrypted templates exist only in memory for the session
gallery.

**Q: Is this GDPR/DPDP compliant?**
A: The system provides consent, minimisation, access/correction/deletion paths and retention controls,
but compliance is institutional and legal, not something code can certify. The institution must
define lawful basis, notice, retention and processor arrangements. Our docs say this explicitly.

**Q: What if a student refuses biometrics?**
A: Enrolment never happens without consent; manual attendance and corrections remain available. The
institution must ensure no academic penalty for refusal.

**Q: How do you handle deletion?**
A: Students can delete their own templates; consent is withdrawn. Deactivated students' templates are
purged after the retention period by `purge-biometrics`, which prints counts only. Attendance history
remains under academic-record policy; it contains no biometrics.

**Q: What if encryption keys are lost?**
A: Templates become unreadable and students must re-enrol. That's why keys are backed up separately
from the database. Rotation without re-enrolment requires a re-wrap migration, which is not
implemented.

**Q: Students can mark themselves present — isn't that just letting them cheat?**
A: It is opt-in per session, and the admin decides whether to switch it on. The window is bounded by
the session's own start and close times, so it cannot be used outside class. Arriving after the late
cutoff is recorded as `late`, not `present`. The record is stored with `source = self_reported`, so
it stays distinguishable from a biometric match and from a manual override, and staff can lock an
individual student out at any time when a pattern of abuse appears. It is a convenience path for the
case where the teacher is busy, not a replacement for verification — biometric recognition remains
the primary path and remains optional, so nobody is forced to use either.

### Security

**Q: How are sessions secured?**
A: Random opaque tokens, only SHA-256 hashes stored server-side, HttpOnly/SameSite=Lax cookies,
Secure in production, absolute and idle expiry, revocation on logout/password change/deactivation.
Passwords are Argon2id.

**Q: Why both SameSite and CSRF tokens?**
A: SameSite=Lax is browser-dependent and doesn't cover every legacy/edge case. The double-submit
token gives an explicit server-side check on every state-changing request. Login/reset have no
session yet but are rate-limited.

**Q: What prevents brute force?**
A: Argon2id slows verification, per-IP rate limits slow attempts, and five failures lock the account
for 15 minutes. Errors are generic to prevent account enumeration. MFA is out of scope.

**Q: What about SQL injection/XSS/CSV injection?**
A: SQLAlchemy parameterises queries; React escapes output and CSP blocks inline scripts; CSV cells
starting with `= + - @`, tab or CR are prefixed with `'` before download. PDFs are generated
server-side.

**Q: What security headers are set?**
A: Strict CSP, COOP, X-Content-Type-Options, frame-ancestors 'none', Referrer-Policy and a camera
Permissions-Policy. nginx serves the SPA and proxies `/api` on one origin, so CORS is disabled in
production.

**Q: Biggest residual security risks?**
A: Compromised host/keys, spoofing, distributed credential attacks, single-process rate limits, and
dependency compromise. We mitigate but do not eliminate them; a formal pentest is future work.

### Database and correctness

**Q: How is attendance percentage calculated?**
A: `attended = present + late`; `eligible = finalized sessions on the roster − excused`;
`percentage = attended / eligible × 100`, undefined (shown as "—") when eligible is 0. Unfinalized
sessions and unresolved `pending_review` do not count as attended.

**Q: Why PostgreSQL constraints instead of application checks alone?**
A: Constraints survive races and bugs: unique (session, student), unique consent, partial unique
pending correction, checks on times/statuses and restrictive FKs preserve history.

**Q: What does finalisation do?**
A: In one transaction, it generates `absent` rows for roster members without a record and marks the
session finalized. Repeating is safe. Later changes go through audited corrections.

**Q: How is audit protected from secrets?**
A: The audit helper snapshots allow-listed fields and strips known sensitive keys; tests assert
passwords, tokens and embeddings don't appear. Audit is append-only in the API, though a DBA could
still modify rows — that's an operational control gap.

### Reports and frontend

**Q: Why are charts lazy-loaded?**
A: Recharts is large. Splitting it into a lazy chunk reduced the initial bundle from ~838 kB to
~465 kB and keeps the login/first paint fast. The chart component only loads on dashboard pages.

**Q: How do you stop staff seeing other faculty's data?**
A: Every report/service derives scope from the authenticated user: admin sees all, faculty only owned
courses. Filters are applied on top of scope, not instead of it. Tests cover the boundary.

**Q: How do exports avoid formula injection?**
A: CSV cells that begin with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with an
apostrophe. Exports reuse the same scoped query and cap at 10,000 rows.

**Q: Is the UI accessible?**
A: We use semantic labels, roles, keyboard-operable dialogs, visible focus and text alongside colour.
A formal WCAG audit has not been performed, so we don't claim conformance.

### Testing and evaluation

**Q: What do the tests actually prove?**
A: They prove backend rules, security boundaries, transactions, API contracts and key UI flows. Most
biometric tests use a scripted analyzer, so they don't prove model accuracy. Threshold maths has unit
tests; real model behaviour requires the evaluation harness on consented data.

**Q: Why no accuracy evaluation?**
A: It needs an approved, consented dataset with variation and attack samples; we did not take
shortcuts with participant images. The harness, manifests and metrics are implemented and
smoke-tested for plumbing. The report must state "not measured" until a proper run is completed.

**Q: What is EER?**
A: The threshold where false-match rate equals false-non-match rate. It's useful for comparing
systems, but deployment usually targets a specific FMR (e.g. 0.1%) and reports the corresponding
FNMR. Our scripts compute both and refuse recommendations when the sample is too small for the
target resolution.

**Q: How would you demonstrate latency?**
A: Measure server processing per frame and end-to-end browser time on the reference machine over many
frames, report p50/p95 and hardware. The architecture's 10–30 ms per stage are design estimates, not
measurements.

### Operations and deployment

**Q: How is this deployed?**
A: Docker Compose: PostgreSQL with a named volume, an API image that runs Alembic and uvicorn as a
non-root user, and nginx serving the SPA and proxying `/api`. Only nginx publishes a port; models
are mounted read-only. A TLS proxy sits in front for HTTPS.

**Q: Why one uvicorn worker?**
A: The rate limiter and cooldown are in-process. Multiple workers would each allow their own limits.
Until a shared store (Redis) is added, one worker is correct; CPU inference is serialised anyway.

**Q: How do you bootstrap the first admin?**
A: An interactive CLI (`create-admin`) prompts for a strong password, hashes it with Argon2id and
audits the creation. There is no default password in the repo. The dev-only seed command refuses to
run in production.

**Q: How do you back up?**
A: `pg_dump` plus separate secure storage of encryption keys. Restoring the database without keys
leaves templates unreadable. Compose's named volume survives `down` but not `down -v`.

**Q: What would you do differently with more time?**
A: Run a documented evaluation, add Redis-backed limits for horizontal scaling, MFA/SSO, email
delivery, certified PAD research, accessibility audit, and a formal penetration test.

## 5. Trap questions and safe answers

| Question | Safe answer |
|---|---|
| "So it's 100% accurate?" | "No. Accuracy is unmeasured; we use conservative thresholds and human review." |
| "Can it detect deepfakes?" | "No. It is single-frame PAD, not deepfake detection; that is out of scope." |
| "Is it GDPR compliant?" | "It implements privacy controls, but compliance is an institutional/legal determination." |
| "Why not use a cloud API?" | "Data minimisation, offline operation, cost, and no third-party biometric processing." |
| "What if the student covers the camera?" | "Quality/face checks fail; no attendance; staff can mark manually or the student can request a correction." |
| "What if a photo is held up?" | "Liveness may catch it under flag/enforce, but single-frame PAD is not guaranteed; staff supervision is part of the control." |
| "Why not use fingerprints?" | "Different hardware/privacy trade-offs; the project scope is camera-based attendance." |
| "Did real students use it?" | "No field study; all demos use fictional data. A real study needs ethics approval and consent." |

## 6. Whiteboard derivations to rehearse

1. **Attendance %**: `(present + late) / (finalized roster sessions − excused) × 100`.
2. **Decision rule**: `score = max_t cosine(probe, t)`; accept iff `score ≥ T` and
   `score − second ≥ A`; low-confidence band `[T − L, T)`.
3. **EER**: plot FMR and FNMR against threshold; EER is their crossing; report its threshold.
4. **FMR sample resolution**: with N impostor pairs, the smallest non-zero measurable FMR is 1/N;
   a 0.1% target needs ≥ 1000 independent pairs.
5. **AEAD binding**: ciphertext decrypts only with the same student/model/version AAD, so row
   swapping fails.
6. **Duplicate guarantee**: unique constraint + `ON CONFLICT DO NOTHING` inside the event/record
   transaction.

## 7. Final checklist

- [ ] Every claim in slides matches [srs.md](srs.md) status labels (implemented / experimental / planned).
- [ ] No accuracy, latency or compliance claims without evidence.
- [ ] Demo uses fictional data only; no `.env` on screen.
- [ ] Backup plan for camera/network failure: manual attendance + explanation.
- [ ] Know three limitations and three future improvements without prompting.
- [ ] Can draw the architecture and session state machine from memory.
- [ ] Can explain one test and one bug it caught (e.g. ineligible candidates were not linked to the
      event; fixed and covered by a test).
