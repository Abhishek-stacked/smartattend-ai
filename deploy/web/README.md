# Deployment notes — single container

One image carries everything: Caddy serves the built React app and proxies `/api` to
uvicorn on `127.0.0.1:8000`, started together by supervisord. The image listens on the
`PORT` the host injects (falling back to 7860) and expects a Postgres URL in
`DATABASE_URL`.

- Build: `docker build -t smartattend-ai .`
- Run: `docker run -p 8080:8080 -e PORT=8080 --env-file .env smartattend-ai`
- The compose file at the repo root runs the same app as two containers for local work.

## Render (current public demo)

`render.yaml` declares a free web service that builds this Dockerfile. Free instances get
0.1 CPU / 512 MB and sleep after 15 minutes without traffic; the next visit waits roughly a
minute for the container and Alembic to start. Set these in the service's Environment tab:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon **direct** (unpooled) URL, `sslmode=require` |
| `BIOMETRIC_ENCRYPTION_KEYS` | the same `k1:` key that encrypted the stored templates |
| `FRONTEND_BASE_URL` | the service URL Render assigns, `https://…onrender.com` |
| `CORS_ORIGINS` | same as `FRONTEND_BASE_URL` |

Demo sign-in: `abhishek.mishra@faculty.edu` / `SmartAttend2026`

The app refuses to be framed (`frame-ancestors 'none'`) and asks for camera access, so open
the site directly rather than inside an embed or preview pane.
