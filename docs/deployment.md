# Deployment

SmartAttend AI ships as three containers: PostgreSQL, the FastAPI backend, and nginx serving the built
React SPA while proxying `/api` to the backend. Only the web container publishes a port; the database and
API stay on the Compose network.

```
browser ──▶ web (nginx :8080) ──▶ api (uvicorn :8000) ──▶ db (postgres :5432)
                 │                      │
                 └── static SPA         └── ai_service/ (YuNet, SFace, optional MiniFASNet)
```

## Prerequisites

- Docker Engine 24+ with Compose v2 (`docker compose version`).
- The AI model files on the host. They are mounted read-only and never baked into an image.
- A `.env` file at the repository root with real secrets.

## 1. Configure secrets

```bash
cp .env.example .env
python -c "import secrets;print(secrets.token_urlsafe(32))"                     # POSTGRES_PASSWORD
python -c "import secrets,base64;print('k1:' + base64.b64encode(secrets.token_bytes(32)).decode())"  # BIOMETRIC_ENCRYPTION_KEYS
```

Set `POSTGRES_PASSWORD` to the URL-safe value printed first: Compose inserts it into `DATABASE_URL`
without percent-encoding. Set `BIOMETRIC_ENCRYPTION_KEYS` to the second value. Leave
`SEED_ADMIN_PASSWORD` empty in production; the development `seed-admin` command refuses to run when
`APP_ENV=production`. Compose overrides `DATABASE_URL` to point at the `db` service, so the local
`DATABASE_URL` value is only used outside Docker.

Keep the encryption keys somewhere safe and separate from database backups. If they are lost, every
enrolled biometric template becomes undecryptable and students must re-enroll.

## 2. Provide the models

```bash
python ai_service/scripts/fetch_models.py          # YuNet + SFace, SHA-256 verified
python ai_service/scripts/fetch_models.py --check  # verify later
```

The liveness model is optional and experimental. Without it the API reports `not_enabled` and never
fabricates a pass; see [ai-models.md](ai-models.md). `docker compose` mounts `./ai_service/models` at
`/app/ai_service/models` read-only.

## 3. Start the stack

```bash
docker compose up -d --build
docker compose ps          # wait for api and web to report healthy
```

The backend entrypoint runs `alembic upgrade head` before starting uvicorn, so schema migrations are
applied on every start. The frontend is built once in a Node stage and served by nginx.

Open <http://localhost:8080>. FastAPI's own `/api/docs` page is available in development and test
environments only: the production build hides it, because Swagger UI loads its assets from a CDN that the
Content-Security-Policy forbids.

## 4. Create the first administrator

There is no default account and no password in the repository. Create the first admin interactively:

```bash
docker compose exec api python -m app.cli create-admin --email admin@example.edu --name "Institution Admin"
```

The command prompts for the password twice, validates its strength, stores only an Argon2id hash and
writes an audit entry. It works in production because it requires shell access to the running container.
Additional staff accounts are created from the Admin → Users console, which can set a password directly or
issue one-time reset links. Student passwords are set from Admin → Students → Password.

## 5. Verify

```bash
curl -fsS http://localhost:8080/healthz
curl -fsS http://localhost:8080/api/health
docker compose logs -f api
```

`/api/health` reports database connectivity and whether each model file is present. A missing liveness
model yields `not_enabled` behaviour, not fabricated results.

## Hosted demo (Render + Neon)

The public demo does not use Compose. It builds the root `Dockerfile`: one image in which Caddy serves the
built SPA and reverse-proxies `/api` to uvicorn on `127.0.0.1:8000`, with supervisord (`deploy/web`)
keeping both processes alive. Caddy listens on the `PORT` the host injects, so the same image fits any
single-port container platform.

The database is a Neon Postgres branch. Point `DATABASE_URL` at the **direct** (unpooled) endpoint: the
pooled endpoint runs PgBouncer in transaction mode, which does not carry session state across a migration
and trips over the prepared statements psycopg 3 uses. URLs without a driver (`postgres://`,
`postgresql://`) are coerced to `postgresql+psycopg://` on load, because only psycopg 3 is installed.

1. **Fill the database** — on an empty Neon branch, restore a dump of a working instance, then let Alembic
   confirm the schema:

   ```bash
   pg_dump -Fc "$LOCAL_DATABASE_URL" -f demo.dump
   pg_restore --no-owner --no-privileges --no-comments --dbname "$NEON_DIRECT_URL" demo.dump
   DATABASE_URL="$NEON_DIRECT_URL" alembic upgrade head
   ```

2. **Create the service** — `render.yaml` declares a free Docker web service with its health check on
   `/api/health`. The blueprint asks for the four values it does not keep in the repository:
   `DATABASE_URL`, `BIOMETRIC_ENCRYPTION_KEYS` (must be the key that encrypted the restored templates),
   and `FRONTEND_BASE_URL` / `CORS_ORIGINS` (both the service's `https://…onrender.com` origin, which
   Render reveals only after the service exists).

3. **Verify** — the same health checks as Compose, plus a login:

   ```bash
   curl -fsS https://<service>.onrender.com/api/health
   curl -fsS -c jar -X POST https://<service>.onrender.com/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"you@example.edu","password":"…"}'
   ```

Free instances get 0.1 CPU and 512 MB and sleep after 15 minutes without traffic, so the first request
after a quiet period takes roughly a minute. Bandwidth is metered per month; exceeding the free allowance
without a payment method suspends every free service on the account.

## Operations

**Backups** — back up the database and the encryption keys separately:

```bash
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-smartattend}" "${POSTGRES_DB:-smartattend}" > smartattend-$(date +%F).sql
```

Restore into an empty database with `docker compose exec -T db psql -U ... -d ... < backup.sql`. The
`pgdata` named volume survives `docker compose down`; `docker compose down -v` deletes it.

**Upgrades** — take a backup, then:

```bash
docker compose build api web
docker compose up -d
```

Migrations run automatically. Rolling back code does not roll back applied migrations; restore the
backup or add a forward migration.

**Biometric retention** — templates for students deactivated longer than
`biometric_retention_days` (default 30) must be purged. Inspect first, then run on a protected
schedule:

```bash
docker compose exec api python -m app.cli purge-biometrics --dry-run
docker compose exec api python -m app.cli purge-biometrics --yes
```

The command deletes templates, withdraws consent and writes an audit entry per affected student.
It prints counts only. Record the schedule and outcome in the institution's retention log.

**Logs and resources** — `docker compose logs -f api web db`. Recognition is CPU-heavy; one uvicorn
worker is the default because the rate limiter and recognition cooldown are in-process. Raising
`UVICORN_WORKERS` weakens those limits until a shared store (Redis) is added.

## HTTPS

Terminate TLS at a reverse proxy (Caddy, Traefik, or an institution gateway) in front of the `web`
container, then set:

```dotenv
PUBLIC_URL=https://attendance.example.edu
COOKIE_SECURE=true
```

Restart the API (`docker compose up -d api`). `COOKIE_SECURE=true` makes the session and CSRF cookies
HTTPS-only; leave it `false` only for local HTTP demos. The bundled nginx does not terminate TLS.

Do not expose the `api` or `db` containers directly. Compose publishes only `WEB_PORT` (default 8080).

## Configuration reference

| Variable | Purpose | Compose default |
|---|---|---|
| `POSTGRES_PASSWORD` | Database password (URL-safe) | required |
| `BIOMETRIC_ENCRYPTION_KEYS` | AES-256-GCM template keys (`key_id:base64`) | required |
| `PUBLIC_URL` | Public origin used in password-reset links | `http://localhost:8080` |
| `WEB_PORT` | Host port for nginx | `8080` |
| `APP_TIMEZONE` | Institution timezone for dates and sessions | `UTC` |
| `SESSION_TTL_MINUTES` / `SESSION_IDLE_MINUTES` | Absolute / idle session lifetime | 480 / 60 |
| `COOKIE_SECURE` | HTTPS-only cookies | `false` (set `true` with TLS) |
| `MAX_UPLOAD_BYTES` | Largest decoded frame/upload | 2097152 |

Compose sets `APP_ENV=production` and an empty `CORS_ORIGINS` because nginx serves the SPA and API from
one origin. If you split the origins, set `CORS_ORIGINS` to the exact frontend origin and update the API
proxy accordingly; never use `*` with credentialed requests.

## Troubleshooting

| Symptom | Check |
|---|---|
| `api` restarts at boot | `docker compose logs api`; usually a missing/invalid `BIOMETRIC_ENCRYPTION_KEYS` or database credentials |
| `api` unhealthy, `/api/health` shows `degraded` | Database container health, `DATABASE_URL`, `pg_isready` |
| Models show `missing` | Run `fetch_models.py` on the host; the mount is read-only by design |
| Passwords reset links point at `localhost` | Set `PUBLIC_URL` to the real origin and restart `api` |
| Login succeeds but the session is not kept | Over HTTPS set `COOKIE_SECURE=true`; over plain HTTP set it `false` |
| `413` on enrollment | `client_max_body_size` in `frontend/nginx.conf` and `MAX_UPLOAD_BYTES` |
| First admin creation says already exists | The email is registered; use the Users console to reset its password |
