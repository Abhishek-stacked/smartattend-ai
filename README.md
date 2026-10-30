# SmartAttend AI

[![License: MIT](https://img.shields.io/badge/License-MIT-indigo.svg)](LICENSE)

An intelligent facial-recognition attendance management system with consent-based enrollment, liveness
verification (experimental), exception review, and web-based analytics.

Built as a final-year engineering major project. The system is deliberately honest about what is and is not
implemented — see [docs/ai-models.md](docs/ai-models.md) for model provenance and limitations, and
[docs/evaluation.md](docs/evaluation.md) for evaluation status (no accuracy metrics are claimed yet).

## Live demo

**<https://smartattend-ai-sblb.onrender.com>** — sign in with `abhishek.mishra@faculty.edu` /
`SmartAttend2026` (faculty scope over seeded demo data; no real student records).

The demo is a single container on a Render free instance with PostgreSQL on Neon: Caddy serves the built
SPA and proxies `/api` to uvicorn. Free instances sleep after 15 minutes without traffic, so the first
visit after a quiet period spends about a minute waking up. Deployment steps:
[deploy/web/README.md](deploy/web/README.md) and
[docs/deployment.md](docs/deployment.md#hosted-demo-render--neon).

## Documentation

| Document | Contents |
|---|---|
| [SRS](docs/srs.md) | Functional/non-functional requirements, acceptance and traceability |
| [Diagrams](docs/diagrams.md) | Context, use cases, components, ERD, sequences, state machines, deployment |
| [Architecture](docs/architecture.md) | Layering, runtime flows, hardware budget |
| [Database design](docs/database-design.md) | Tables, invariants, transactions |
| [API contract](docs/api-documentation.md) | Endpoints, roles, errors, rate limits |
| [AI models](docs/ai-models.md) | Provenance, licences, checksums, limitations |
| [Evaluation](docs/evaluation.md) | Recognition/PAD evaluation protocol and current status |
| [Privacy & security](docs/privacy-security.md) | Consent, encryption, threat model, retention, operations |
| [Deployment](docs/deployment.md) | Docker Compose, secrets, HTTPS, backups, upgrades |
| [UI wireframes](docs/ui-wireframes.md) | Screen flows and states |
| [Report material](docs/report-material.md) | Report outline, drafting guidance, evidence table |
| [Viva preparation](docs/viva-prep.md) | Demo runbook, Q&A, limitation answers |
| [Complete guide (PDF)](docs/SmartAttend-AI-Complete-Guide.pdf) | 116-page walkthrough from first principles to the hosted deployment, including the failures along the way |

## Repository layout

```
smartattend-ai/
├── backend/        FastAPI + SQLAlchemy + Alembic (Python 3.10+)
├── frontend/       React + TypeScript + Vite + Tailwind CSS
├── ai_service/     Face detection / recognition / liveness (no database access)
├── e2e/            Playwright end-to-end suite (Page Object Model, real API)
├── docs/           Architecture, deployment, database, API, model and UI documentation
├── backend/Dockerfile        API image (Alembic on start, non-root user, healthcheck)
├── frontend/Dockerfile       SPA build + nginx (security headers, /api reverse proxy)
├── Dockerfile                Single-image build used by the hosted demo (Caddy + uvicorn)
├── deploy/web/               Caddyfile and supervisord config for that image
├── render.yaml               Render blueprint for the live demo
└── docker-compose.yml        PostgreSQL + API + web
```

## Local development (Windows, no Docker)

Prerequisites: Python 3.10+, Node 20+, PostgreSQL 16 (a portable copy is used in this workspace).

1. **Start PostgreSQL** (this workspace uses a portable instance under the workspace root, one level
   above this repository):

   ```bash
   # run from the folder that contains smartattend-ai/ and .tools/
   .tools/pgsql/bin/pg_ctl.exe -D .tools/pgdata -l .tools/pg.log \
     -o "-p 5432 -c listen_addresses=localhost" -w start

   # stop it later
   .tools/pgsql/bin/pg_ctl.exe -D .tools/pgdata stop -m fast
   ```

2. **Configure environment**: copy `.env.example` to `.env` and fill in the database password, a
   `BIOMETRIC_ENCRYPTION_KEYS` value, and a strong `SEED_ADMIN_PASSWORD`. Secrets are never committed.

3. **AI models** (downloaded, never committed):

   ```bash
   python ai_service/scripts/fetch_models.py          # YuNet + SFace with SHA-256 checks
   python ai_service/scripts/fetch_models.py --check  # verify later

   # Optional, experimental liveness: convert the upstream Apache-2.0 checkpoint once.
   # Place 2.7_80x80_MiniFASNetV2.pth in ai_service/liveness/upstream/ first (not committed).
   python ai_service/liveness/convert_minifasnet.py
   ```

   Without the liveness ONNX file the API reports `not_enabled`; it never fakes a pass.
   See [docs/ai-models.md](docs/ai-models.md) for the checksum and limitations.

4. **Backend**:

   ```bash
   cd backend
   python -m venv .venv
   .venv/Scripts/pip install -r requirements-dev.txt
   .venv/Scripts/alembic upgrade head
   .venv/Scripts/python -m app.cli seed-admin
   .venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
   ```

   API documentation: <http://127.0.0.1:8000/api/docs>

5. **Frontend**:

   ```bash
   cd frontend
   npm install
   npm run dev        # http://localhost:5173, proxies /api to port 8000
   ```

6. **Tests**:

   ```bash
   cd backend && .venv/Scripts/python -m pytest     # uses smartattend_test (APP_ENV=test)
   cd frontend && npm test && npm run lint && npm run build
   ```

7. **End-to-end tests (Playwright)** — from the repository root:

   ```bash
   npm install
   E2E_BASE_URL=https://smartattend-ai-sblb.onrender.com E2E_CHANNEL=chrome npx playwright test
   ```

   Page Object Model suite that drives the real SPA against the real API. It is
   read-only, so it is safe against the public demo. See [e2e/README.md](e2e/README.md)
   for the credentials variables and reports.

`APP_ENV=test` makes the backend refuse to run unless `TEST_DATABASE_URL` is set and differs from
`DATABASE_URL`, so the test suite cannot touch development data.

## Docker deployment

The production stack runs PostgreSQL, the API, and an nginx-served SPA. Only the web container publishes a
port; the API is reachable only through nginx on the Compose network.

```bash
cp .env.example .env    # set POSTGRES_PASSWORD, BIOMETRIC_ENCRYPTION_KEYS, PUBLIC_URL
docker compose up -d --build
docker compose exec api python -m app.cli create-admin --email you@example.edu --name "Your Name"
```

Open <http://localhost:8080> (or the value of `PUBLIC_URL`). Model files are mounted read-only from
`ai_service/models` and are never baked into the image. For HTTPS, TLS termination, backups, upgrades, and
troubleshooting, see [docs/deployment.md](docs/deployment.md).

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 1 | Architecture, schema, API contract, model and UI design docs | Complete |
| 2 | Database, auth, CSRF, RBAC, account management, settings, audit | Complete |
| 3 | React shell, login, route guards, account pages, admin user console | Complete |
| 4 | Students, faculty, courses, sessions, attendance records | Complete |
| 5 | Recognition engine, enrollment, live camera | Complete |
| 6 | Liveness integration, exception review, corrections | Complete |
| 7 | Dashboards, reports and exports | Complete |
| 8 | Deployment, broader test coverage | Complete |
| 9 | SRS, diagrams, evaluation harness, report material, viva preparation | Complete |

Placeholders in the UI are labelled as scheduled work and never display fabricated statistics.

## License

The project source code is released under the [MIT License](LICENSE) — see [LICENSE](LICENSE) for the full text.

This licence covers **this repository's own code only**. It does not cover the third-party model weights,
which are downloaded by `ai_service/scripts/fetch_models.py` and are never committed here; each carries its
own licence (YuNet MIT, SFace Apache-2.0), recorded with provenance and SHA-256 checksums in
[docs/ai-models.md](docs/ai-models.md). The vendored liveness detector under
`ai_service/liveness/upstream/` keeps its original Apache-2.0 licence file.
