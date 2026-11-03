import { defineConfig, devices, type ReporterDescription } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

// Gherkin/BDD suite (features/*.feature) driven by the same Playwright runner as
// the specs in e2e/, so it inherits baseURL, retries, traces and reporters.
// Run it with `npm run bdd` (codegen + run) or `npm run bdd:codegen` alone.
// E2E_EMAIL / E2E_PASSWORD gate the signed-in journeys exactly as they do in
// e2e/tests/access-control.spec.ts — unset means skip, never fail.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:4173";
const channel = process.env.E2E_CHANNEL;

// bddgen turns each .feature into a real Playwright test file under
// features/.features-gen (generated, git-ignored; never edited by hand).
const testDir = defineBddConfig({
  features: "features/**/*.feature",
  steps: "features/steps/**/*.ts",
  outputDir: "features/.features-gen",
  missingSteps: "fail-on-gen",
});

function reporters(): ReporterDescription[] {
  const active: ReporterDescription[] = [
    ["list"],
    ["html", { outputFolder: "playwright-report-bdd", open: "never" }],
  ];
  if (process.env.E2E_ALLURE !== "0") {
    try {
      require.resolve("allure-playwright");
      // Separate folder from the spec run, so the two suites can be merged into
      // one Allure report in CI without overwriting each other's results.
      active.push(["allure-playwright", { resultsDir: "allure-results-bdd", detail: true, suiteTitle: true }]);
    } catch {
      console.warn("allure-playwright is not installed; skipping the Allure reporter.");
    }
  }
  return active;
}

export default defineConfig({
  testDir,
  outputDir: "test-results-bdd",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: reporters(),
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    // The free Render instance sleeps after 15 idle minutes and needs ~50 s to wake.
    navigationTimeout: 90_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...(channel ? { channel } : {}) },
    },
  ],
});
