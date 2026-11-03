import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import type { Page } from "@playwright/test";
import { LoginPage } from "../../e2e/pages/LoginPage";
import { SessionsPage } from "../../e2e/pages/SessionsPage";
import { test } from "./fixtures";

// Same Page Objects as the Playwright specs; the Gherkin layer only adds words.
const { Given, When, Then } = createBdd(test);

// Optional credentials, treated exactly the way e2e/tests/access-control.spec.ts
// treats them: unset means the signed-in journey is skipped, never failed, so a
// fork or a pull request without secrets still reports green.
async function signInAsFaculty(page: Page) {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  test.skip(
    !email || !password,
    "Set E2E_EMAIL and E2E_PASSWORD to run the signed-in journeys",
  );

  const login = new LoginPage(page);
  await login.open();
  await login.signIn(email as string, password as string);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });

  const me = await page.request.get("/api/auth/me");
  expect(me.status()).toBe(200);
  const role = (await me.json()).role as string;
  test.skip(role === "admin", "These credentials belong to an administrator account");
}

When("I open {string} without a session", async ({ page }, path: string) => {
  await page.goto(path);
});

When("I open {string}", async ({ page }, path: string) => {
  await page.goto(path);
});

When(
  "I call the protected endpoint {string} without a session",
  async ({ request, api }, endpoint: string) => {
    if (!api) throw new Error("The 'api' fixture is not wired into this scenario");
    api.response = await request.get(endpoint);
  },
);

When("I am signed in with the faculty credentials from the environment", async ({ page }) => {
  await signInAsFaculty(page);
});

When("I open the attendance sessions screen", async ({ page }) => {
  await new SessionsPage(page).open();
});

When("I filter the sessions by {string}", async ({ page }, text: string) => {
  await new SessionsPage(page).filterBy(text);
});

Then("I am redirected to the sign-in page", async ({ page }) => {
  await expect(page).toHaveURL(/\/login/);
});

Then("the API responds with status {int}", async ({ api }, status: number) => {
  if (!api?.response) throw new Error("No API call was made by this scenario");
  expect(api.response.status()).toBe(status);
});

Then("the API error code is {string}", async ({ api }, code: string) => {
  if (!api?.response) throw new Error("No API call was made by this scenario");
  expect((await api.response.json()).error.code).toBe(code);
});

Then("I am redirected to the unauthorized page", async ({ page }) => {
  await expect(page).toHaveURL(/\/unauthorized/);
});

Then("I see the access denied message", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /do not have access/i })).toBeVisible();
});

Then("at least one session row is listed", async ({ page }) => {
  await expect(new SessionsPage(page).rows.first()).toBeVisible();
});

Then("the sessions empty state is shown", async ({ page }) => {
  await expect(new SessionsPage(page).emptyState).toBeVisible();
});
