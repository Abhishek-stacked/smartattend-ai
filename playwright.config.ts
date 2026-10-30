import { defineConfig, devices } from "@playwright/test";

// Point the suite at any environment with E2E_BASE_URL; the default is the
// local preview server that `npm --prefix frontend run preview` starts.
// E2E_CHANNEL=chrome reuses an installed Chrome instead of downloading a
// Playwright browser; E2E_ALL_BROWSERS=1 adds the Firefox and WebKit projects
// (requires `npx playwright install firefox webkit`).
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:4173";
const channel = process.env.E2E_CHANNEL;
const allBrowsers = process.env.E2E_ALL_BROWSERS === "1";

function project(name: string, device: (typeof devices)[string]) {
  return {
    name,
    use: { ...device, ...(name === "chromium" && channel ? { channel } : {}) },
  };
}

export default defineConfig({
  testDir: "./e2e/tests",
  outputDir: "test-results",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Video would need Playwright's bundled ffmpeg; traces already capture every action.
    video: "off",
    actionTimeout: 15_000,
    // The free Render instance sleeps after 15 idle minutes and needs ~50 s to wake.
    navigationTimeout: 90_000,
  },
  projects: [
    project("chromium", devices["Desktop Chrome"]),
    ...(allBrowsers
      ? [project("firefox", devices["Desktop Firefox"]), project("webkit", devices["Desktop Safari"])]
      : []),
  ],
});
