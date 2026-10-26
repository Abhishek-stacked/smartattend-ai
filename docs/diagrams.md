# SmartAttend AI — Diagram Pack

All diagrams are Mermaid and render on GitHub, GitLab, VS Code and most Markdown viewers. They
describe the **as-built** system. The ER diagram is a summary; the full schema is in
[database-design.md](database-design.md). Requirements IDs refer to [srs.md](srs.md).

## 1. System context

```mermaid
flowchart LR
  Admin([Administrator])
  Faculty([Faculty])
  Student([Student])
  IT([Institution IT /<br/>privacy officer])

  subgraph SA["SmartAttend AI (single institution)"]
    WEB["React SPA<br/>camera capture + UI"]
    API["FastAPI API<br/>auth, RBAC, business rules"]
    AI["ai_service<br/>YuNet · SFace · MiniFASNet"]
    DB[(PostgreSQL 16<br/>users · attendance ·<br/>encrypted templates · audit)]
  end

  Proxy["Institution TLS proxy<br/>(HTTPS)"]
  Admin -->|browser| Proxy
  Faculty -->|browser + webcam| Proxy
  Student -->|browser| Proxy
  IT -->|deploy · backup · keys| API
  Proxy --> WEB
  WEB -->|"/api JSON + JPEG frames"| API
  API -->|"in-process typed calls"| AI
  API -->|SQLAlchemy| DB
  AI -.->|"no DB · no identity decisions"| DB
```

No biometric data leaves the deployment. The only external artefacts are the downloaded,
checksum-verified model files.

## 2. Actors and use cases

```mermaid
flowchart LR
  A([Administrator])
  F([Faculty])
  S([Student])

  subgraph UC["System use cases"]
    U1[Manage accounts]
    U2[Manage students / faculty]
    U3[Manage courses and enrolments]
    U4[Record consent and enrol biometrics]
    U5[Schedule and run sessions]
    U6[Recognise faces / verify liveness]
    U7[Review uncertain events]
    U8[Mark attendance manually]
    U9[Correct attendance]
    U10[Request correction]
    U11[View own attendance]
    U12[View dashboards and reports]
    U13[Export CSV / PDF]
    U14[Configure settings]
    U15[Read audit log]
    U16[Delete own biometrics]
    U17[Change password]
  end

  A --> U1 & U2 & U3 & U4 & U5 & U7 & U8 & U9 & U12 & U13 & U14 & U15 & U17
  F --> U5 & U6 & U7 & U8 & U9 & U12 & U13 & U17
  S --> U10 & U11 & U16 & U17
  U4 --- A
```

Faculty actions are limited to their own courses; student actions are limited to their own records.
Students may read their own profile and biometric status, but never galleries or review queues.

## 3. Container and component view

```mermaid
flowchart TB
  subgraph Browser
    UI["React SPA<br/>Router · AuthContext · pages"]
    Cam["getUserMedia<br/>sampled JPEG frames"]
    Charts["Lazy Recharts chunk"]
    Cam --> UI
    UI -.-> Charts
  end

  subgraph Nginx["web container — nginx"]
    Static["Static build + security headers"]
    Reverse["/api reverse proxy"]
  end

  subgraph API["api container — FastAPI (1 worker)"]
    Routes["API routes<br/>Pydantic validation"]
    Deps["Dependencies<br/>authN · RBAC · CSRF · rate limit"]
    Services["Services<br/>auth · users · people · courses ·<br/>sessions · attendance · biometrics ·<br/>recognition · review · corrections ·<br/>reports · settings · audit"]
    AIPkg["ai_service package<br/>analyzer · matcher · quality · liveness"]
    Gallery["Session gallery cache<br/>decrypted templates in RAM"]
    Routes --> Deps --> Services
    Services --> AIPkg
    Services --> Gallery
  end

  DB[("PostgreSQL 16")]
  UI -->|HTTPS JSON / multipart| Static
  Static --> Reverse --> Routes
  Services -->|SQLAlchemy + Alembic schema| DB
```

The browser never decides identity, eligibility or attendance status. `ai_service` never imports
backend code and never touches the database.

## 4. Deployment topology

### 4.1 Local development (no Docker)

```mermaid
flowchart LR
  B["Browser<br/>127.0.0.1:5173"]
  V["Vite dev server<br/>proxy /api"]
  U["uvicorn<br/>127.0.0.1:8000"]
  P[("Portable PostgreSQL 16<br/>127.0.0.1:5432")]
  M[["ai_service/models<br/>(ONNX files)"]]
  B --> V -->|/api| U
  U --> P
  U --> M
```

### 4.2 Docker Compose production

```mermaid
flowchart LR
  B["Browser"]
  TLS["Institution TLS proxy<br/>(Caddy / Traefik / gateway)"]
  W["web<br/>nginx :80 → host :8080"]
  A["api<br/>uvicorn :8000<br/>non-root · Alembic on start"]
  D[("db<br/>postgres:16-alpine<br/>named volume pgdata")]
  M[["host ./ai_service/models<br/>mounted read-only"]]

  B -->|HTTPS| TLS -->|HTTP| W
  W -->|"/api/*"| A
  A --> D
  A --> M
```

Only `web` publishes a host port. API and database are unreachable from outside the Compose
network. See [deployment.md](deployment.md).

## 5. Entity-relationship summary

```mermaid
erDiagram
  roles ||--o{ users : assigns
  users ||--o{ auth_sessions : owns
  users ||--o{ password_reset_tokens : owns
  users |o--o| students : "portal login"
  users |o--o| faculty : "portal login"
  faculty |o--o{ courses : teaches
  courses ||--o{ course_enrollments : offers
  students ||--o{ course_enrollments : takes
  students ||--o{ biometric_consents : grants
  biometric_consents ||--o{ biometric_templates : authorises
  courses ||--o{ attendance_sessions : schedules
  faculty ||--o{ attendance_sessions : runs
  attendance_sessions ||--o{ session_participants : snapshots
  students ||--o{ session_participants : listed
  attendance_sessions ||--o{ attendance_records : holds
  students ||--o{ attendance_records : receives
  attendance_sessions ||--o{ recognition_events : produces
  recognition_events |o--o| attendance_records : evidences
  students ||--o{ correction_requests : submits
  attendance_sessions ||--o{ correction_requests : concerns
  users ||--o{ audit_logs : acts
```

Key invariants: `UNIQUE(course_id, student_id)` on enrolments, `UNIQUE(session_id, student_id)` on
attendance, at most one `granted` consent per student, at most one pending correction per
student/session, and `ON DELETE RESTRICT` from history to people/sessions.

## 6. Sequence diagrams

### 6.1 Sign-in, session and CSRF

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as FastAPI
  participant D as PostgreSQL

  B->>A: POST /api/auth/login {email, password}
  A->>A: IP rate limit + account lockout check
  A->>D: SELECT user by normalised email
  A->>A: Argon2id verify (generic failure on mismatch)
  A->>D: INSERT auth_session (sha256(token), expiry)
  A-->>B: Set-Cookie sa_session (HttpOnly, SameSite=Lax) + sa_csrf
  B->>A: GET /api/auth/me (cookies)
  A->>D: session not expired, not idle, not revoked
  A-->>B: user + role
  B->>A: POST /api/sessions ... + X-CSRF-Token
  A->>A: compare header with sa_csrf cookie
  A-->>B: 200 (or 403 csrf_invalid)
```

Passwords and raw session tokens are never logged. Only the token hash is stored.

### 6.2 Consent and biometric enrolment

```mermaid
sequenceDiagram
  autonumber
  participant Staff
  participant B as Browser
  participant A as FastAPI
  participant AI as ai_service
  participant D as PostgreSQL
  participant S as Student / consenting participant

  S-->>Staff: informed consent (out of band + recorded)
  Staff->>B: record consent, policy_version
  B->>A: POST /enrollment/{student_id}/consent
  A->>D: INSERT biometric_consents (granted, version)
  Staff->>B: click "Open camera"
  B->>A: POST /recognition/detect (preview frames)
  A->>AI: YuNet + quality checks
  A-->>B: boxes + quality feedback (nothing stored)
  Staff->>B: capture 3–5 accepted samples
  B->>A: POST /enrollment/{student_id} (multipart)
  A->>AI: real analysis, quality, embeddings
  A->>D: compare with other students' templates
  alt likely duplicate identity
    A-->>B: 409 possible_duplicate_identity
  else consistent and unique
    A->>A: AES-256-GCM encrypt, AD binds student/model/version
    A->>D: INSERT encrypted templates + audit
    A-->>B: template_count (never an embedding)
  end
  Note over A,B: Uploaded images are discarded after the response
```

### 6.3 Live recognition and liveness

```mermaid
sequenceDiagram
  autonumber
  participant F as Faculty browser
  participant A as FastAPI
  participant R as RecognitionService
  participant AI as ai_service
  participant D as PostgreSQL

  F->>A: POST /recognition/recognize (frame, session_id, CSRF)
  A->>R: authN + ownership + rate limit + size/type
  R->>D: session must be active; load roster gallery
  R->>AI: detect + quality + embedding
  R->>AI: match against gallery (max cosine/student)
  alt liveness policy != off
    R->>AI: MiniFASNet score for each face
  end
  alt confidently matched, eligible, liveness OK
    R->>D: BEGIN; INSERT attendance ON CONFLICT DO NOTHING;<br/>INSERT recognition_event; COMMIT
    R-->>F: outcome=recognized, attendance.committed=true
  else low confidence / ambiguous / not eligible
    R->>D: INSERT recognition_event (review pending or metadata)
    R-->>F: low_confidence | not_eligible — no attendance
  else liveness failed / inconclusive
    alt policy=flag
      R->>D: attendance + event pending review
      R-->>F: recorded, flagged for review
    else policy=enforce
      R->>D: event only (liveness_failed / error)
      R-->>F: not marked
    end
  end
  Note over F,R: The raw frame is discarded after the response
```

### 6.4 Review of an uncertain event

```mermaid
sequenceDiagram
  autonumber
  participant F as Faculty / admin
  participant A as FastAPI
  participant D as PostgreSQL

  F->>A: GET /recognition/events?status=pending
  A-->>F: candidates (low confidence / liveness / multiple faces)
  F->>A: POST /recognition/events/{id}/resolve {action, note}
  A->>D: SELECT event FOR UPDATE; must be pending
  alt mark_present / mark_late
    A->>D: create or update attendance + audit + resolved
  else dismiss
    A->>D: event resolved/dismissed + audit (record unchanged)
  end
  A-->>F: resolved event
```

### 6.5 Student correction request and approval

```mermaid
sequenceDiagram
  autonumber
  participant S as Student
  participant F as Faculty / admin
  participant A as FastAPI
  participant D as PostgreSQL

  S->>A: POST /corrections {session_id, requested_status, reason}
  A->>D: own session; no pending request; insert pending
  F->>A: POST /corrections/{id}/reject {note}
  A->>D: status=rejected + audit; attendance unchanged
  Note over S,D: A rejected request never changes attendance
  F->>A: POST /corrections/{id}/approve {note}
  A->>D: BEGIN; upsert attendance; audit before/after;<br/>status=approved; COMMIT
  A-->>F: updated record
```

### 6.6 Report query and export

```mermaid
sequenceDiagram
  autonumber
  participant U as Staff browser
  participant A as FastAPI
  participant D as PostgreSQL

  U->>A: GET /reports/attendance?type=...&filters
  A->>A: validate dates/type/granularity; derive scope
  A->>D: aggregate attendance rows within scope
  A-->>U: columns + rows + summary (paged)
  U->>A: GET /reports/export?same filters&fmt=csv|pdf
  A->>D: same query, cap 10,000 rows
  alt CSV
    A->>A: neutralise = + - @ tab CR prefixes
  else PDF
    A->>A: reportlab landscape A4
  end
  A-->>U: attachment (Content-Disposition)
```

## 7. State machines

### 7.1 Attendance session

```mermaid
stateDiagram-v2
  [*] --> scheduled
  scheduled --> active: start
  scheduled --> cancelled: cancel
  active --> paused: pause
  paused --> active: resume
  active --> closed: close
  paused --> closed: close
  closed --> active: reopen (admin, reason, audited)
  closed --> finalized: finalize (absences generated)
  finalized --> [*]
```

Automated and manual present/late marks are accepted only while `active`. Finalisation is
idempotent; later changes require an audited correction.

### 7.2 Recognition event review

```mermaid
stateDiagram-v2
  [*] --> not_required: recognized / unknown / duplicate / poor_quality / no_face / not_eligible
  [*] --> pending: low_confidence / multiple_faces / liveness_failed / flagged
  pending --> resolved: mark_present / mark_late
  pending --> dismissed: dismiss
  resolved --> [*]
  dismissed --> [*]
```

Resolving twice is rejected with `409 already_reviewed`. Dismissal leaves attendance untouched.

### 7.3 Correction request

```mermaid
stateDiagram-v2
  [*] --> pending
  pending --> approved: staff approves (applies record)
  pending --> rejected: staff rejects (record unchanged)
  pending --> withdrawn: student withdraws
  approved --> [*]
  rejected --> [*]
  withdrawn --> [*]
```

### 7.4 Liveness policy (per session snapshot)

```mermaid
stateDiagram-v2
  state "off — no check" as off
  state "flag — mark and review failures" as flag
  state "enforce — mark only on pass" as enforce
  [*] --> off
  off --> flag: admin sets policy before session
  flag --> enforce: stricter policy
  enforce --> flag: relax policy
  note right of enforce : Model unavailable → no mark (liveness_unavailable / error)
```

The policy is copied into the session when it is created, so mid-session setting changes do not
retroactively alter an ongoing session.

## 8. Privacy data flow for a single frame

```mermaid
flowchart LR
  Cam["Camera frame<br/>(JPEG in motion)"] --> Mem["API request memory"]
  Mem --> Det["YuNet + quality"]
  Det --> Emb["SFace embedding<br/>(float32)"]
  Emb --> Match["Cosine match<br/>(session gallery in RAM)"]
  Det --> Live["MiniFASNet score<br/>(optional)"]
  Match --> Decide["Backend decision"]
  Live --> Decide
  Decide --> Meta["recognition_events<br/>outcome · scores · quality<br/>no pixels · no embedding"]
  Decide --> Att["attendance_records<br/>status · source · audit"]
  Emb -.->|"only at enrolment"| Enc["AES-256-GCM ciphertext<br/>biometric_templates"]
  Mem -.->|"discarded after response"| X["No raw image / video store"]
  Log["Logs & audit"] -.->|"never contain"| X
```

## 9. Diagram-to-requirement map

| Diagram | Primary requirements |
|---|---|
| Context, container view | NFR-DEP-02/03, NFR-SEC-01/08, C3/C4 |
| Use cases | AUTH, USR, PPL, CRS, BIO, SES, REC, REV, COR, RPT, AUD |
| Deployment | NFR-DEP-01/02/03/04, NFR-SEC-07 |
| ER summary | Database invariants, NFR-REL-01/02, NFR-PRV-02/03 |
| Sign-in sequence | AUTH-01…06, NFR-SEC-02/03 |
| Enrolment sequence | BIO-01…08, NFR-PRV-01/02 |
| Recognition sequence | REC-01…12, NFR-REL-04 |
| Review sequence | REV-01…05, NFR-REL-01 |
| Correction sequence | COR-01…04, AUD-01/02 |
| Report sequence | RPT-01…06, NFR-PERF-04, NFR-SEC-06 |
| Session / review / correction states | SES-01…06, REV-02, COR-01…04 |
| Privacy flow | C4/C5, NFR-PRV-02/05, NFR-SEC-05 |
