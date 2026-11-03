# Behaviour-driven tests (Gherkin + playwright-bdd)

Requirements written as Gherkin scenarios and executed by the **Playwright test
runner** through [`playwright-bdd`](https://github.com/vitalets/playwright-bdd)
(formerly `cppcresser/playwright-bdd`). The scenarios are not a separate engine:
`bddgen` turns every `.feature` into a real Playwright test file, so this suite
inherits the same browser, the same retries, the same traces and the same Allure
reporter as the specs in `e2e/tests`.

```
features/
  sign-in.feature             # 2 scenarios + 2 examples  -> 4 tests
  access-control.feature      # 2 scenarios + 6 examples  -> 8 tests
  steps/
    fixtures.ts               # per-scenario 'api' fixture (test-scoped state)
    sign-in.steps.ts          # 15 step definitions
    access-control.steps.ts   # 13 step definitions
    .features-gen/            # generated Playwright specs, git-ignored
playwright-bdd.config.ts      # BDD config + its own Playwright config
```

12 tests in total, and the step definitions contain **no locators**: every action
and assertion goes through the Page Objects in `e2e/pages/`, so the Gherkin layer
and the spec layer break together on a UI change rather than drifting apart.

## Running

```bash
npm run bdd:codegen   # features/*.feature -> features/.features-gen/*.spec.js
npm run bdd           # codegen + playwright test -c playwright-bdd.config.ts

# against the deployed demo
E2E_BASE_URL=https://smartattend-ai-sblb.onrender.com E2E_CHANNEL=chrome npm run bdd
# signed-in scenarios run only when both variables are set, otherwise they skip
E2E_EMAIL=abhishek.mishra@faculty.edu E2E_PASSWORD=SmartAttend2026 npm run bdd
```

The same commands in Windows PowerShell:

```powershell
$env:E2E_BASE_URL   = "https://smartattend-ai-sblb.onrender.com"
$env:E2E_CHANNEL    = "chrome"
$env:E2E_EMAIL      = "abhishek.mishra@faculty.edu"
$env:E2E_PASSWORD   = "SmartAttend2026"
npm run bdd          # 12 passed
npm run bdd:report   # Playwright HTML report for the BDD run

Remove-Item Env:\E2E_EMAIL, Env:\E2E_PASSWORD   # signed-in scenarios then skip
```

Reports: `playwright-report-bdd/` (Playwright HTML) and `allure-results-bdd/`
(Allure results, kept separate from the spec run so CI can merge both). See
[`docs/automation-reporting.md`](../docs/automation-reporting.md).

## Writing the scenarios

- `Feature:` / `Background:` / `Scenario:` / `Scenario Outline:` + `Examples:`.
  A named `Examples:` block (`Examples: rejected for <email>`) becomes the test
  title, so a failure names the row instead of `Example #2`.
- Data-driven cases use `Scenario Outline`; a single behaviour stays a plain
  `Scenario`. Do not turn a one-row outline into a table for symmetry.
- `Given` puts the system in a state, `When` performs one action, `Then` asserts
  one observable outcome. `And`/`But` continue the previous keyword.
- Tags drive filtering, not logic: `@ui`, `@auth`, `@access-control`,
  `@requires-faculty-credentials`. Run a subset with
  `npx bddgen -c playwright-bdd.config.ts --tags "@access-control"` before the
  test run.
- Missing step definitions fail **generation**, not the run
  (`missingSteps: "fail-on-gen"`), so a typo is caught before a browser starts.

## Optional credentials

`When I am signed in with the faculty credentials from the environment` calls
`test.skip()` when `E2E_EMAIL`/`E2E_PASSWORD` are unset, and again when the
account turns out to be an administrator. That is the exact contract
`e2e/tests/access-control.spec.ts` keeps, which is what lets CI report green on a
fork where no secrets exist. Administrator credentials are never committed, so
the register journeys only run when `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` are
supplied (GitHub Actions secrets, Jenkins credentials).

## Conventions

- One step file per feature file; step text is written from the user's point of
  view ("I sign in as ..."), never from the implementation ("click button ...").
- Per-scenario state (the API response reused by two `Then` steps) lives in a
  test-scoped Playwright fixture in `steps/fixtures.ts`, never in a module-level
  variable — tests run in parallel and would leak into each other.
- The demo instance rate limits sign-ins to 10 per minute and the account is
  shared, so invalid-credential examples use addresses that do not exist.
