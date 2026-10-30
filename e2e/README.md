# End-to-end tests (Playwright)

Browser-level tests for SmartAttend AI. They drive the real SPA and the real API,
either against the deployed instance or a local preview, and they are read-only:
no test creates, deactivates or erases a person, so they are safe to point at the
public demo.

```
e2e/
  pages/        # Page Object Model: locators live here, specs stay readable
    LoginPage.ts
    FacultyPage.ts
    SessionsPage.ts
  tests/
    login.spec.ts           # public: form state, password toggle, invalid credentials
    access-control.spec.ts  # public: redirect + 401; signed-in: role guards, sessions, admin registers
```

## Running

```bash
npm install                      # once, at the repository root
npx playwright install chromium  # once per machine, unless you use E2E_CHANNEL=chrome

# against the deployed demo (free tier may need ~50 s to wake)
E2E_BASE_URL=https://smartattend-ai-sblb.onrender.com E2E_CHANNEL=chrome npx playwright test

# against a local preview (backend on :8000, `npm --prefix frontend run build` first)
npm --prefix frontend run preview
npx playwright test
```

On Windows PowerShell the same commands use `$env:NAME="value"` before the command.

| Variable | Effect |
| --- | --- |
| `E2E_BASE_URL` | Target origin. Defaults to `http://localhost:4173` (the preview server). |
| `E2E_EMAIL`, `E2E_PASSWORD` | Any signed-in role (faculty or student). Runs the role-guard and sessions journeys; without them those tests are skipped. |
| `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` | An administrator account. Runs the two register journeys (faculty detail dialog, student search); without them they are skipped. |
| `E2E_CHANNEL` | Set to `chrome` to reuse an installed Chrome instead of downloading a Playwright build. |
| `E2E_ALL_BROWSERS` | Set to `1` to add the Firefox and WebKit projects (needs `npx playwright install firefox webkit`). |

The demo faculty account published in the root README works for the first pair:
`E2E_EMAIL=abhishek.mishra@faculty.edu E2E_PASSWORD=SmartAttend2026`. Administrator
credentials are never committed, so the register journeys stay skipped in CI.

Reports are written to `playwright-report/` (`npx playwright show-report`), and
traces and screenshots of failures to `test-results/`. Both are ignored by git.
Video recording is off on purpose: it needs Playwright's bundled ffmpeg download,
and traces already capture every action and network call.

## Conventions

- One page object per screen, exposing locators and user actions — never assert inside a
  page object beyond waiting for the screen to be ready.
- Prefer accessible locators (`getByRole`, `getByLabel`) over CSS, so a restyle does not
  break the suite.
- Keep tests independent: each starts with `open()`/`goto` and does not rely on another
  test's side effects.
