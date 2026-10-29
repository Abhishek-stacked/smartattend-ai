# Software Requirements Specification — SmartAttend AI

| | |
|---|---|
| **System** | SmartAttend AI: facial-recognition attendance with liveness verification, review and analytics |
| **Version** | 1.0 (as-built, Phase 9) |
| **Status** | Implemented unless marked **[Planned]** or **[Experimental]** |
| **Audience** | Project guide, examiners, maintainers, institutional IT/privacy reviewers |
| **Normative companion docs** | [architecture.md](architecture.md), [database-design.md](database-design.md), [api-documentation.md](api-documentation.md), [privacy-security.md](privacy-security.md), [evaluation.md](evaluation.md), [deployment.md](deployment.md) |

This SRS describes the system that exists in this repository. Where the code and this document
disagree, the code wins and the document is a bug. Requirements marked **[Planned]** are explicitly
not implemented and must not be presented as features.

## 1. Introduction

### 1.1 Purpose

Specify the functional and non-functional requirements for a single-institution attendance system
that can identify consenting students from a camera frame, never silently guesses, keeps humans in
control of uncertain cases, and provides role-scoped reporting. The document is also the acceptance
baseline for the final-year project demonstration.

### 1.2 Scope

**In scope**

* Web application for administrators, faculty and students.
* Consent-based biometric enrolment with encrypted templates and deletion.
* Faculty-operated live attendance for scheduled sessions, with per-frame quality checks.
* Conservative identity matching and an explicit exception-review queue.
* Manual (non-biometric) attendance and student-initiated correction requests.
* Attendance history, dashboards, tabular reports, CSV/PDF exports and audit logs.
* Deployment as three containers (PostgreSQL, API, nginx-served SPA) or as a local development stack.

**Out of scope (this release)**

* Native mobile apps, SMS/email delivery, timetable integration, payment, hostel or library modules.
* Multi-institution tenancy or cross-campus identity federation.
* Unattended kiosk marking without an authenticated staff session.
* 3D, depth, thermal or challenge-response liveness; deepfake detection.
* Automated disciplinary decisions, proctoring, emotion or demographic inference.
* Cloud face APIs; no biometric data leaves the deployment.

### 1.3 Definitions

| Term | Meaning |
|---|---|
| **Template / embedding** | 128-dimensional SFace feature vector derived from a face; encrypted at rest |
| **Gallery** | The decrypted templates of the session roster, held in process memory for matching |
| **Genuine / impostor pair** | Two images of the same person / of different people |
| **FMR / FNMR** | False-match (impostor accepted) / false-non-match (genuine rejected) rate |
| **APCER / BPCER** | Presentation-attack samples accepted / bona-fide samples rejected by liveness |
| **Liveness policy** | `off`, `flag` (mark but queue a review) or `enforce` (no mark without a pass) |
| **Finalisation** | Closing a session's attendance and generating `absent` rows for unmarked roster members |
| **RBAC** | Role-based access control with ownership checks (faculty ↔ own courses, student ↔ self) |

### 1.4 References

* IEEE 830-1998 structure (adapted), ISO/IEC/IEEE 29148 terminology.
* [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106) — Argon2 password hashing.
* [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) and
  [Cheat Sheet: CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
* Wu et al., *YuNet: A Tiny Millisecond-level Face Detector*, 2023; Zhong et al., *SFace*, 2021;
  Minivision, *Silent-Face-Anti-Spoofing*, 2020 (details and licences in [ai-models.md](ai-models.md)).
* Institutional biometric-notice template in [privacy-security.md](privacy-security.md).

## 2. Overall description

### 2.1 Product perspective

A three-tier web system. The browser captures frames only after a user gesture and sends JPEG frames
over HTTPS; the FastAPI backend authenticates the operator, enforces course ownership and session
state, and calls the in-process `ai_service` package for detection, quality, embeddings, matching and
optional liveness. PostgreSQL holds users, rosters, attendance, encrypted templates and the
append-only audit log. Uncertain recognition never becomes attendance without a staff decision.

### 2.2 User classes

| Actor | Capabilities | Restrictions |
|---|---|---|
| **Administrator** | Users, students, faculty, courses, enrolments, settings, audit, all reports, session reopen | Cannot recover a lost biometric encryption key; cannot hard-delete history through the API |
| **Faculty** | Own courses/rosters, own sessions, live recognition, manual marks, review, corrections for own courses, own reports | No access to other faculty's courses or to global settings/audit |
| **Student** | Own attendance summary/history, own correction requests, self-service biometric deletion, self-marking during an open self-marking window | No access to other students; cannot see galleries, templates or review queues |
| **Institution IT / privacy officer** | Deploy, back up, manage TLS and keys, respond to incidents | Out-of-band access; must follow key and backup separation rules |
| **Project examiner / demo observer** | Read-only demonstration | Must not be given real participants' biometric data |

Authorization is enforced server-side on every route; the UI hides unavailable navigation but is not
a security boundary.

### 2.3 Operating environment

* Server: Linux container or Windows development host, 2+ CPU cores with AVX2, 8 GB RAM minimum,
  no GPU; PostgreSQL 16; Python 3.10+.
* Browser: current Chrome/Edge/Firefox with `getUserMedia`; camera requires HTTPS except on
  `localhost`.
* Clients: staff laptop/desktop with webcam; students may use any supported browser.
* Network: single origin in production (nginx proxies `/api`); institution timezone configured by
  `APP_TIMEZONE`.

### 2.4 Design and implementation constraints

1. **C1** Models must have licences compatible with academic and commercial use: YuNet (MIT),
   SFace and MiniFASNetV2 (Apache-2.0). Weights are downloaded, checksum-verified and never
   committed.
2. **C2** CPU-only inference; no cloud AI calls, no GPU assumption.
3. **C3** Attendance and identity decisions occur only in backend services, never in the browser or
   `ai_service`.
4. **C4** Raw camera frames are processed in memory and discarded; no raw images or video are stored.
5. **C5** Biometric templates are encrypted at rest (AES-256-GCM) with keys supplied by the
   environment, never in source control.
6. **C6** Liveness is experimental (single-frame RGB) and must never be reported as a pass when the
   model is absent, errors or is inconclusive.
7. **C7** Uncertain identities are never automatically marked present.
8. **C8** The rate limiter and recognition cooldown are in-process; the supported deployment runs one
   uvicorn worker until a shared store is added. **[Planned: Redis-backed limits]**

### 2.5 Assumptions and dependencies

* The institution has a lawful basis and a biometric notice; consent is recorded before enrolment.
* Rosters and course assignments are maintained by administrators.
* Cameras are front-facing with reasonable lighting; the system does not guarantee recognition.
* PostgreSQL and the encryption keys are backed up separately.
* Email/SMS is not assumed; reset links are shared out-of-band by an administrator.
* Model accuracy, fairness and PAD error rates have **not** been measured; see [evaluation.md](evaluation.md).

## 3. Functional requirements

Priority: **M** = mandatory for the demonstrated release, **S** = should, **C** = could.
“Evidence” names the implementation area and/or automated tests; see §8 for the test map.

### 3.1 Authentication and sessions (AUTH)

| ID | Pri | Requirement | Acceptance / evidence |
|---|---|---|---|
| AUTH-01 | M | Users sign in with email and password; failures return one generic message that does not reveal whether the account exists. | `POST /auth/login`; login tests |
| AUTH-02 | M | Passwords are stored only as Argon2id hashes and must meet the configured strength policy. | `core/security.py`; CLI/password tests |
| AUTH-03 | M | A successful login creates an opaque session stored server-side as SHA-256(token), delivered in an `HttpOnly; SameSite=Lax` cookie; `Secure` is on in production. | `auth_service`, session tests |
| AUTH-04 | M | Sessions expire after the absolute TTL (default 480 min) and after inactivity (default 60 min), are revoked on logout, password change, deactivation and reset. | Session/hardening tests |
| AUTH-05 | M | State-changing requests require a double-submit CSRF header matching the `sa_csrf` cookie; login and reset-password are exempt. | CSRF tests |
| AUTH-06 | M | Repeated failures lock the account for 15 minutes after 5 attempts; login is limited to 10/min per IP. | Auth tests, limiter |
| AUTH-07 | M | An administrator can issue a single-use, 24-hour password-reset link; the token is stored hashed, shown once, and invalidated on use/password change. | user service, reset tests |
| AUTH-08 | S | A signed-in user can change their password by supplying the current one; other sessions are revoked. | Profile page tests, auth tests |

### 3.2 Account and user administration (USR)

| ID | Pri | Requirement | Acceptance / evidence |
|---|---|---|---|
| USR-01 | M | Administrators can list, search, filter and page through user accounts (page size ≤ 100). | `GET /users`; bounds tests |
| USR-02 | M | Only the primary administrator (PRIMARY_ADMIN_EMAIL, default abhishek.mishra@admin.edu) can create additional administrator accounts; no password is chosen, a one-time reset link is returned. | Admin console tests |
| USR-03 | M | Accounts can be deactivated/reactivated; deactivation revokes active sessions immediately and keeps history. | Admin console tests, audit |
| USR-04 | M | Locked accounts can be unlocked and a reset link issued from the console. | Admin console tests |
| USR-05 | M | Privileged account changes are audited with actor, action, target and before/after state (no secrets). | audit tests |

### 3.3 Students, faculty and courses (PPL/CRS)

| ID | Pri | Requirement | Acceptance / evidence |
|---|---|---|---|
| PPL-01 | M | Administrators can create, edit, search and deactivate students and faculty; duplicate registration/employee IDs or emails are rejected with 409. | academics tests |
| PPL-02 | M | Deactivation never hard-deletes a person or their attendance history. | lifecycle tests |
| PPL-03 | S | Administrators can issue portal logins for students/faculty via one-time reset links. | account tests |
| CRS-01 | M | Administrators can manage courses and assign one faculty owner; faculty see only their own courses. | academics, RBAC tests |
| CRS-02 | M | Administrators can bulk-enrol students; enrolment is idempotent; dropping marks the enrolment dropped rather than deleting it. | academics tests |
| CRS-03 | M | A session roster is snapshotted from active enrolments at creation; later enrolments and drops update open sessions while finalized and cancelled rosters stay frozen. | session tests |
| CRS-04 | M | A student's profile may be read by staff with a legitimate scope (own course) or by the student themselves; others receive 404. | access tests |

### 3.4 Consent and biometric enrolment (BIO)

| ID | Pri | Requirement | Acceptance / evidence |
|---|---|---|---|
| BIO-01 | M | The current biometric notice and policy version are available to all signed-in roles. | privacy API |
| BIO-02 | M | Templates cannot be created without a recorded, versioned consent (`participant_confirmed`); withdrawal blocks further use and can delete templates. | biometric tests |
| BIO-03 | M | Enrolment accepts 3–5 images, validates each server-side (one face, quality, size) and rejects inconsistent samples. An administrator can enrol any student; a student can enrol only their own record. | enrolment tests |
| BIO-04 | M | Templates are AES-256-GCM encrypted with associated data binding student, model and version; keys support rotation via `key_id`. | biometric tests, crypto module |
| BIO-05 | M | Enrolment refuses samples that closely match another enrolled student (above the configured recognition threshold) and reports `possible_duplicate_identity`. | biometric tests |
| BIO-06 | M | No API, log or error response returns an embedding, ciphertext, raw frame or template count of another student. | access/log tests |
| BIO-07 | M | Students (self) or administrators can delete templates; templates for deactivated students are purged after the retention period (default 30 days) by `python -m app.cli purge-biometrics`. | retention purge test, CLI |
| BIO-08 | S | Replacing templates requires an explicit `replace` flag and keeps consent traceability. | enrolment tests |

### 3.5 Attendance sessions (SES)

| ID | Pri | Requirement | Acceptance / evidence |
|---|---|---|---|
| SES-01 | M | Faculty/admin can schedule a session for an owned course with start, end, late-after and closing times; the liveness policy is snapshotted. | session tests |
| SES-02 | M | Only the transitions `scheduled → active/paused/cancelled`, `paused → active/closed`, `active → paused/closed`, `closed → finalized` are allowed; invalid transitions return 400. | session tests |
| SES-03 | M | Automated or manual present/late marks are accepted only while the session is active (manual excused may be recorded in active/closed per policy). | attendance tests |
| SES-04 | M | Finalisation creates `absent` records for roster members with no record in one transaction and is idempotent. | attendance tests |
| SES-05 | M | Only an administrator can reopen a closed session, with a mandatory reason, and the action is audited. | hardening/session tests |
| SES-06 | M | The session roster and per-student status are visible only to staff with ownership scope. | access tests |
| SES-07 | M | An administrator can enable student self-marking per session; staff owning the course can lock an individual student out of it, with the reason recorded. | self-marking tests |
| SES-08 | M | A student may mark themselves present only between `scheduled_start` and `attendance_closes_at`; outside the window the request is rejected and the reason is returned. | self-marking tests |
| SES-09 | M | A self-mark is written with `source = self_reported`, derives `late` from `late_after`, and never overwrites an existing record. | self-marking tests |

### 3.6 Live recognition (REC)

| ID | Pri | Requirement | Acceptance / evidence |
|---|---|---|---|
| REC-01 | M | Recognition is available only to authenticated staff for their own **active** session; frames are limited by type and size. | recognition tests |
| REC-02 | M | Every analysed frame produces per-face outcomes: `recognized`, `unknown`, `low_confidence`, `poor_quality`, `multiple_faces`, `liveness_failed`, `liveness_unavailable`/`error`, `duplicate`, `not_eligible`. | recognition tests |
| REC-03 | M | A frame with more faces than `max_faces_per_frame` is rejected as `multiple_faces`; no identity is guessed. | recognition tests |
| REC-04 | M | Matching uses max cosine over the student's templates, a threshold and an ambiguity margin against the runner-up. | matcher tests, recognition tests |
| REC-05 | M | Scores below `threshold − low_confidence_margin` are `unknown`; scores in the band or ambiguous are `low_confidence` and queued for review. | recognition tests |
| REC-06 | M | Only `recognized` outcomes create attendance; the insert uses `ON CONFLICT DO NOTHING`, and a duplicate (including a concurrent one) never creates a second record. | uniqueness/concurrency tests |
| REC-07 | M | Repeat captures inside the cooldown window are reported as `duplicate` and not stored as new events. | recognition tests |
| REC-08 | M | A confidently matched student who is not active or not on the roster is `not_eligible`, never marked. The candidate is stored for reviewers only. | biometric tests |
| REC-09 | M | Liveness policy `off` skips checks; `flag` marks confident identities but queues failed/inconclusive checks; `enforce` marks only on a pass and never marks when the model is unavailable. | biometric/liveness tests |
| REC-10 | M | Embeddings and raw frames never leave the request; responses contain only boxes, outcomes, student summaries, scores, attendance state and event ids. | API contract, code review |
| REC-11 | M | Automated marks outside the attendance window are not recorded; late/present is derived from `late_after`. | attendance tests |
| REC-12 | S | A separate `/liveness/verify` endpoint gives on-screen feedback and never writes attendance. | liveness tests |

### 3.7 Review, manual attendance and corrections (REV/COR)

| ID | Pri | Requirement | Acceptance / evidence |
|---|---|---|---|
| REV-01 | M | Staff can list recognition events filtered by status, session, outcome and liveness status within their scope. | review tests |
| REV-02 | M | Pending candidates can be marked present/late or dismissed with a note; resolving twice returns 409. | review tests |
| REV-03 | M | Marking from review requires a stored candidate and an active/closed session; it creates a missing record or updates an existing status, with an audit entry. | review tests |
| REV-04 | M | Staff can mark present/late/excused manually with a reason for non-biometric attendance. | attendance tests |
| REV-05 | M | Attendance corrections require a reason and write before/after history to the audit log. | correction tests |
| COR-01 | M | Students can request a correction or manual attendance for their own session with a 5–500 character reason; one pending request per student/session. | correction tests |
| COR-02 | M | Faculty/admin can approve (applying the record change) or reject with a note; approval and audit are one transaction. | correction tests |
| COR-03 | M | Students can withdraw only their own pending request. | correction tests |
| COR-04 | M | A rejected or withdrawn request leaves attendance unchanged. | correction tests |

### 3.8 History, reports and exports (RPT)

| ID | Pri | Requirement | Acceptance / evidence |
|---|---|---|---|
| RPT-01 | M | Students see only their own attendance records and summary; counts match the documented percentage definition. | self-service tests |
| RPT-02 | M | Staff see dashboards within their scope: summary cards, trends by day/week/month, status distribution, course comparison, recent activity and pending queues. | report tests, UI |
| RPT-03 | M | Tabular reports cover daily, weekly, monthly, course, student, faculty, late, absence, exception and correction views with server-defined columns. | report tests |
| RPT-04 | M | Reports and exports accept the same filters and enforce the same scope as the UI. | report tests |
| RPT-05 | M | CSV exports neutralise spreadsheet formula injection and cap at 10,000 rows; PDF exports are landscape A4 with the same columns. | export tests |
| RPT-06 | M | Report figures are aggregated at request time from attendance records; no fabricated/placeholder statistics are shown. | report tests, UI review |

### 3.9 Administration and audit (ADM/AUD)

| ID | Pri | Requirement | Acceptance / evidence |
|---|---|---|---|
| ADM-01 | M | Administrators can view and update validated application settings (thresholds, margins, timing, policy, retention) with ranges enforced. | settings tests |
| ADM-02 | M | Client-visible settings expose only non-sensitive values (frame interval, liveness policy, timezone). | settings tests |
| AUD-01 | M | Every privileged write produces an append-only audit entry with actor, role, action, entity, before/after snapshots and request id. | audit tests |
| AUD-02 | M | Audit logs never contain passwords, session/reset tokens, embeddings or raw images. | audit tests, review |
| AUD-03 | M | Administrators can filter audit logs; non-admins cannot read them. | audit/RBAC tests |

### 3.10 User interface behaviour (UI)

| ID | Pri | Requirement | Acceptance / evidence |
|---|---|---|---|
| UI-01 | M | Navigation and routes are role-aware; a direct URL to a forbidden page shows an access-denied page, not data. | route tests |
| UI-02 | M | The camera opens only after an explicit user action, shows quality/liveness feedback and never presents a match as confirmed before the server responds. | UI review |
| UI-03 | M | Destructive or sensitive actions (deactivate, biometric deletion, resolve/dismiss, reopen) require confirmation/context and explain consequences. | UI review |
| UI-04 | S | Forms have labels, error text and keyboard focus; the UI is usable without colour alone. A formal WCAG audit has **not** been performed. | UI review, tests |
| UI-05 | S | A privacy & biometrics page explains consent, data, retention, deletion and the experimental status of liveness. | UI review |

## 4. External interface requirements

### 4.1 Software interfaces

* **Browser↔API:** JSON over HTTPS, `/api` base, cookie + CSRF; multipart for JPEG frames and
  enrolment samples; file download for exports. Full contract in [api-documentation.md](api-documentation.md).
* **API↔PostgreSQL:** SQLAlchemy 2 + psycopg 3, Alembic migrations at startup (containers) or
  manually (development). Unique constraints and FKs enforce the invariants described in
  [database-design.md](database-design.md).
* **API↔AI package:** in-process typed calls (`FaceAnalyzer`, `LivenessDetector`, `match_embedding`);
  no database access from `ai_service`.
* **External services:** none. No cloud AI, email or SMS integration.

### 4.2 Hardware interfaces

* Any UVC webcam exposed through the browser's `getUserMedia`; 720p recommended minimum.
* Server CPU with AVX2; no GPU, depth sensor or infrared camera support.

### 4.3 Communication interfaces

* HTTPS (TLS terminated by an institution proxy in front of `web`); HTTP only for local development.
* Exports: `text/csv` and `application/pdf` with `Content-Disposition: attachment`.

## 5. Non-functional requirements

### 5.1 Security (NFR-SEC)

| ID | Requirement |
|---|---|
| NFR-SEC-01 | All authorization decisions are server-side; client-provided roles, student ids and attendance statuses are never trusted. |
| NFR-SEC-02 | Session tokens are random, hashed at rest and never logged; cookies are `HttpOnly`, `SameSite=Lax` and `Secure` in production. |
| NFR-SEC-03 | CSRF protection covers every state-changing request except login/reset. |
| NFR-SEC-04 | Passwords use Argon2id; account lockout and IP rate limits slow online guessing. |
| NFR-SEC-05 | Biometric templates use authenticated encryption with per-row nonces and associated data binding. |
| NFR-SEC-06 | Uploads are limited by size and decoded format; CSV exports neutralise formula injection. |
| NFR-SEC-07 | Production startup fails if biometric keys are missing and warns if cookies are not `Secure`. |
| NFR-SEC-08 | Security headers (CSP, COOP, XCTO, frame-ancestors, referrer policy, camera permissions) are set by nginx. |

### 5.2 Privacy and data protection (NFR-PRV)

| ID | Requirement |
|---|---|
| NFR-PRV-01 | Enrolment requires recorded consent; withdrawal prevents further matching and can delete templates. |
| NFR-PRV-02 | Raw frames and video are not persisted; only embeddings, aggregate quality values and recognition metadata are stored. |
| NFR-PRV-03 | Templates are purged after the configured retention period via the audited `purge-biometrics` command. |
| NFR-PRV-04 | Students can see their own biometric status and request deletion without staff mediation. |
| NFR-PRV-05 | Logs and audit entries exclude credentials, tokens, embeddings and images. |
| NFR-PRV-06 | No biometric data is sent to third parties; model files are the only external artefacts. |
| NFR-PRV-07 | The institution can run the system fully on-premises, including the database. |

### 5.3 Performance and capacity (NFR-PERF)

| ID | Requirement |
|---|---|
| NFR-PERF-01 | The reference deployment must run on 4 vCPU / 8 GB with one API worker; recognition is serialised to avoid oversubscription. |
| NFR-PERF-02 | Client frame sampling defaults to one frame per second and one student at a time (max 5 faces, typically 1). |
| NFR-PERF-03 | **Target** (not yet measured): p95 server processing ≤ 1.5 s per frame on the reference machine; operators see progress/feedback. |
| NFR-PERF-04 | Exports cap at 10,000 rows and report endpoints page at ≤ 100 rows to bound memory. |
| NFR-PERF-05 | The SPA keeps the charting library out of the initial bundle (verified by the production build). |

Latency figures in [architecture.md](architecture.md) are design estimates. Measured values belong
in [evaluation.md](evaluation.md) after a documented run.

### 5.4 Reliability and integrity (NFR-REL)

| ID | Requirement |
|---|---|
| NFR-REL-01 | Attendance and its recognition event are committed in one transaction; "recorded" is shown only after commit. |
| NFR-REL-02 | `UNIQUE(session_id, student_id)` is the final duplicate guard, including races. |
| NFR-REL-03 | Session transitions use row locking; invalid transitions fail with a clear 400. |
| NFR-REL-04 | A missing/failed AI model produces an explicit unavailable/error outcome, never a fabricated pass or match. |
| NFR-REL-05 | The API health endpoint reports database and model availability; containers define healthchecks. |
| NFR-REL-06 | Backups must include PostgreSQL and the encryption keys, stored separately. |

### 5.5 Usability and maintainability (NFR-USE/NFR-MNT)

| ID | Requirement |
|---|---|
| NFR-USE-01 | Error messages explain the user's next action without leaking whether an account/record exists. |
| NFR-USE-02 | Critical states (low confidence, liveness failed, pending review) are visually distinct and actionable. |
| NFR-MNT-01 | Backend is layered (routes → services → models); AI code is a separate package with no DB imports. |
| NFR-MNT-02 | Schema changes are Alembic migrations only; models are the source of truth. |
| NFR-MNT-03 | Automated tests cover auth, RBAC, sessions, biometrics, review, corrections, reports, exports, hardening, metrics and key UI flows. |
| NFR-MNT-04 | Configuration is environment-driven; secrets are never in source, logs or images. |
| NFR-MNT-05 | Docs state implemented vs experimental vs planned status and are updated with the code. |

### 5.6 Portability and deployability (NFR-DEP)

| ID | Requirement |
|---|---|
| NFR-DEP-01 | Local development works on Windows without Docker (portable PostgreSQL, venv, Vite) and on Linux. |
| NFR-DEP-02 | Production runs via Docker Compose with three services; only nginx publishes a port. |
| NFR-DEP-03 | Model files are mounted read-only and never baked into images; evaluation data is excluded from images. |
| NFR-DEP-04 | A first administrator can be created interactively in production without a default password. |

## 6. Data requirements

* **Data inventory:** user/account data; student/faculty/course/roster data; consent records;
  encrypted templates and non-identifying quality metrics; attendance and recognition metadata;
  correction requests; append-only audit logs.
* **Not stored:** raw camera frames, video, enrolled source images, plaintext embeddings, passwords,
  plaintext session/reset tokens.
* **Retention:** attendance and audit follow institutional policy; biometric templates are deleted on
  request/withdrawal and purged 30 days after student deactivation by default. The exact legal
  retention must be set by the institution.
* **Key management:** keys come from the environment, are backed up separately and support rotation
  via `key_id`. Losing all keys makes templates undecryptable; re-enrolment is then required.
* **Data subjects' rights:** access to own attendance/biometric status, correction requests and
  biometric deletion are implemented; broader institutional DSAR handling is an operational process.
* **Legal basis:** consent is recorded in-system; the institution remains responsible for its lawful
  basis, notice wording and any regulatory filing. The project does not certify legal compliance.

## 7. Constraints, assumptions and compliance notes

* Liveness is **experimental**, single-frame and RGB-only. It is not a certified PAD solution and
  must not be described as one.
* The models were not trained by this project and may have demographic or device biases that have
  **not** been measured. A human decision path exists for every uncertain case.
* Face recognition is optional for attendance: manual marking and correction remain available.
* The system is not an exam-proctoring or surveillance tool.
* In-process rate limiting and cooldown assume one worker; running multiple workers weakens them.

## 8. Verification and acceptance

### 8.1 Automated verification

| Area | Suite |
|---|---|
| Auth, CSRF, lockout, resets, sessions | `backend/tests/test_auth_and_users.py`, `test_hardening.py` |
| Academics, rosters, RBAC | `backend/tests/test_academics.py` |
| Sessions, attendance, finalisation | `backend/tests/test_sessions.py` |
| Enrolment, encryption, recognition, liveness | `backend/tests/test_biometric.py` |
| Review and corrections | `backend/tests/test_review_and_corrections.py` |
| Reports and exports | `backend/tests/test_reports.py` |
| Settings and production guard | `backend/tests/test_settings.py`, `test_hardening.py` |
| Threshold metrics | `backend/tests/test_evaluation_metrics.py` |
| Login, route guards, admin console, password flows | `frontend/src/pages/*.test.tsx` |

The phase-9 verification section of [report-material.md](report-material.md) records the exact
passing counts and build results from the final run. Tests prove code behaviour, not AI accuracy or
field usability.

### 8.2 Manual acceptance scenarios

1. Anonymous `/dashboard` redirects to login; a student opening `/admin/users` sees access denied.
2. Admin enrols a consenting fictional student, starts a session, and the student is marked present
   once; re-presenting the same face does not create a second record.
3. An uncertain face appears in the review queue and is resolved by staff; the record appears in
   reports and audit.
4. A liveness `enforce` session with the model removed refuses to mark and shows an explicit error.
5. A student submits a correction, staff reject it, and attendance remains unchanged.
6. CSV/PDF exports match the on-screen report and preserve the staff scope.
7. Production configuration without biometric keys fails to start.

## 9. Out-of-scope and future requirements

| ID | Item | Status |
|---|---|---|
| FUT-01 | Shared rate-limit/cooldown store for multi-worker or multi-instance deployment | **[Planned]** |
| FUT-02 | Documented recognition and PAD evaluation with demographic analysis (requires approved data) | **[Planned]** |
| FUT-03 | Email/SMS delivery of reset links and notifications | **[Planned]** |
| FUT-04 | Multi-institution tenancy, SSO (SAML/OIDC) | **[Planned]** |
| FUT-05 | Challenge–response or multi-frame liveness / certified PAD | **[Planned]** |
| FUT-06 | Native mobile attendance station | **[Planned]** |
| FUT-07 | Timetable/LMS integration and automated session creation | **[Planned]** |
| FUT-08 | Formal WCAG 2.2 audit and remediation | **[Planned]** |
