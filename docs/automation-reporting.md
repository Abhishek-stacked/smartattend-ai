# Automation reporting and CI

Every automated check in this repository writes machine-readable results on each
run, and one Allure report is assembled from all of them in CI.

| Layer | Runner | Command | Results directory | Count |
| --- | --- | --- | --- | --- |
| Backend API tests | pytest + FastAPI TestClient, real PostgreSQL | `cd backend && pytest` | `allure-results-api/` (`--alluredir`) | 101 tests |
| HTTP contract tests | pytest + httpx against the deployed API | `pytest api_contract` | `allure-results-contract/` | see `api_contract/` |
| Frontend unit tests | Vitest (jsdom) | `cd frontend && npm test` | JUnit XML, not Allure | 54 tests |
| Browser specs | Playwright (`e2e/`) | `npx playwright test` | `allure-results/` | 9 tests |
| Gherkin scenarios | playwright-bdd (`features/`) | `npm run bdd` | `allure-results-bdd/` | 12 tests |

## 1. Producing Allure results locally

Allure **results** are just JSON files; they need no JVM. They are written on
every run because `allure-playwright` is part of the reporter array:

```ts
// playwright.config.ts — list + html always, Allure when the package resolves
reporter: [["list"], ["html", {...}], ["allure-playwright", { resultsDir: "allure-results" }]];
```

Note the option name: it is `resultsDir` (allure-js-commons v3), **not**
`outputDir`; with the wrong key the reporter silently falls back to
`./allure-results`.

```bash
# specs -> allure-results/
E2E_BASE_URL=https://smartattend-ai-sblb.onrender.com E2E_CHANNEL=chrome npx playwright test
# Gherkin -> allure-results-bdd/
npm run bdd
# opt out of Allure for a plain run
E2E_ALLURE=0 npx playwright test
```

Windows PowerShell — environment variables use `$env:NAME="value"`:

```powershell
$env:E2E_BASE_URL = "https://smartattend-ai-sblb.onrender.com"
$env:E2E_CHANNEL  = "chrome"
$env:E2E_EMAIL    = "abhishek.mishra@faculty.edu"
$env:E2E_PASSWORD = "SmartAttend2026"
npx playwright test
npm run bdd

Remove-Item Env:\E2E_CHANNEL        # clears one variable
Get-ChildItem Env:                  # shows what is still set
```

The pytest suites need the `allure-pytest` plugin, pinned in
`backend/requirements-dev.txt`:

```powershell
.venv\Scripts\Activate.ps1
pytest backend --alluredir=allure-results-api
```

## 2. Why the HTML report is built in CI

`allure serve` and `allure generate` are **Java** applications. The development
laptop has no JDK and no Docker, so the split is deliberate:

- laptop: produces `allure-results/*.json` (pure Node/Python, no JVM);
- CI: installs a JDK, merges every `allure-results-*` artifact and generates the
  HTML — GitHub Actions with `actions/setup-java` + `allure-commandline`, Jenkins
  with the Allure plugin and a JDK configured on the agent.

Nothing about the report is CI-only in principle: on any machine with a JDK,
`npm i -g allure-commandline && allure generate allure-results -o allure-report --clean`
turns the same JSON into the same HTML.

## 3. GitHub Actions

`.github/workflows/automation.yml` runs on push to `main`, on every pull request
and manually. Jobs: `api-unit` (pytest against a `postgres:16-alpine` service
container), `api-contract`, `frontend-unit`, `e2e` (chromium),
`e2e-crossbrowser` (firefox + webkit matrix, public specs only), `bdd`, then
`allure-report`, which downloads all `allure-results-*` artifacts, merges them
flat into one directory and publishes `allure-report/`.

```
api-unit ─┐
frontend-unit ─┤
e2e ─┬─ e2e-crossbrowser ─┬─ allure-report   (needs: [...], if: always())
     └─ bdd ──────────────┘
```

- `workflow_dispatch` takes a `base_url` input, so the browser suites can be
  pointed at a preview deployment instead of the demo.
- Secrets referenced, never valued in the repository: `E2E_ADMIN_EMAIL`,
  `E2E_ADMIN_PASSWORD`, `API_TEST_EMAIL`, `API_TEST_PASSWORD` (plus optional
  `E2E_EMAIL`/`E2E_PASSWORD` overrides for the demo faculty account that README
  already publishes). When a secret is absent the dependent journeys **skip** —
  the specs and the Gherkin steps call `test.skip()`/`pytest.skip()` first, so a
  fork with no secrets still reports green rather than red.
- Concurrency is limited to one run per ref, credentialed jobs use
  `--workers=1`, and the cross-browser matrix runs without credentials: the demo
  instance allows 10 sign-ins per minute on a shared account.
- Enabling Pages (Settings → Pages → source: *GitHub Actions*) turns the
  `upload-pages-artifact` step into a live report URL; without it the report is
  still downloadable as the `allure-report` run artifact.

## 4. Jenkins

`Jenkinsfile` mirrors the same stages (PostgreSQL container → pytest → Vitest →
contract checks → Playwright → playwright-bdd) and publishes the merged report
with the Allure plugin in `post { always { ... } }`. The header comment lists the
plugins, the JDK, the Docker CLI and the four `Secret text` credentials it
assumes.

## 5. Viewing a report

- Playwright HTML report (no JVM needed, links traces/screenshots of failures):
  `npm run e2e:report` / `npm run bdd:report`, or download the
  `playwright-report*` artifact from the run.
- Allure HTML from CI: open the published Pages URL, or download the
  `allure-report` artifact and serve the folder — an Allure report loads its data
  over HTTP, so double-clicking `index.html` from the file system shows a blank
  page:
  ```powershell
  cd allure-report
  python -m http.server 8080      # then open http://localhost:8080
  ```
- Raw evidence of a failure: `test-results/` and `test-results-bdd/` hold the
  trace and screenshot of each failed test (trace `retain-on-failure`, video off
  on purpose — the trace already records every action and network call).

## 6. Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Cannot find plugin "allure-playwright"` | dependencies not installed — `npm ci` at the repository root |
| `allure-results/` stays empty | `E2E_ALLURE=0` is set, or the reporter options use `outputDir` instead of `resultsDir` |
| Generated specs refuse to run | step text changed — re-run `npm run bdd:codegen`; `missingSteps` fails generation on purpose |
| Allure HTML empty in CI | upstream jobs uploaded nothing; check the `if-no-files-found: warn` notice on the artifact |
| Signed-in journeys skip in CI | the credentials/secret is not defined for that branch or fork — by design |
| Browser run fails on the first navigation only | the free Render instance was asleep (~50 s cold start); `navigationTimeout` is 90 s and CI retries twice |
