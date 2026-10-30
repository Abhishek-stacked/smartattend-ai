import { expect, test, type Page } from "@playwright/test";
import { FacultyPage } from "../pages/FacultyPage";
import { LoginPage } from "../pages/LoginPage";
import { SessionsPage } from "../pages/SessionsPage";

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

const ADMIN_PATHS = ["/students", "/faculty", "/admin/users"];

async function signIn(page: Page, email: string, password: string) {
  const login = new LoginPage(page);
  await login.open();
  await login.signIn(email, password);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
}

async function roleOf(page: Page) {
  const me = await page.request.get("/api/auth/me");
  expect(me.status()).toBe(200);
  return (await me.json()).role as "admin" | "faculty" | "student";
}

test.describe("visitors without a session", () => {
  test("are redirected to the sign-in page from an admin route", async ({ page }) => {
    await page.goto("/students");
    await expect(page).toHaveURL(/\/login/);
    await expect(new LoginPage(page).submit).toBeVisible();
  });

  test("cannot read protected API data", async ({ request }) => {
    const response = await request.get("/api/faculty/1");
    expect(response.status()).toBe(401);
    expect((await response.json()).error.code).toBe("unauthenticated");
  });
});

test.describe("signed-in, non-administrator", () => {
  test.skip(!EMAIL || !PASSWORD, "Set E2E_EMAIL and E2E_PASSWORD to run the signed-in journeys");

  test("is sent away from every administrator register", async ({ page }) => {
    await signIn(page, EMAIL!, PASSWORD!);
    test.skip((await roleOf(page)) === "admin", "This session is already an administrator");

    for (const path of ADMIN_PATHS) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/unauthorized/);
      await expect(page.getByRole("heading", { name: /do not have access/i })).toBeVisible();
    }
  });

  test("reaches their own sessions and the client-side filter", async ({ page }) => {
    await signIn(page, EMAIL!, PASSWORD!);

    const sessions = new SessionsPage(page);
    await sessions.open();
    await expect(sessions.rows.first()).toBeVisible();

    await sessions.filterBy("no-session-matches-this-title");
    await expect(sessions.emptyState).toBeVisible();
  });
});

test.describe("signed-in administrator", () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD,
    "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run the administrator checks",
  );

  test.beforeEach(async ({ page }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    expect(await roleOf(page)).toBe("admin");
  });

  test("opens a faculty member's courses from the register", async ({ page }) => {
    const faculty = new FacultyPage(page);
    await faculty.open();
    await faculty.openFirstDetail();

    await expect(faculty.detail.getByRole("heading", { name: /courses/i })).toBeVisible();
    await expect(faculty.detail.getByText(/students ·/).first()).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("filters the student register by registration number", async ({ page }) => {
    await page.goto("/students");
    await expect(page.getByRole("heading", { name: /students/i, level: 1 })).toBeVisible();

    await page.getByRole("searchbox", { name: /search students/i }).fill("nonexistent-registration");
    await expect(page.getByText(/no students match these filters/i)).toBeVisible();
  });
});
