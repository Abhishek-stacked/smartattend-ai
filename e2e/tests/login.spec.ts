import { expect, test } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage";

test.describe("sign-in page", () => {
  test("keeps submit disabled until both credentials are entered", async ({ page }) => {
    const login = new LoginPage(page);
    await login.open();

    await expect(login.submit).toBeDisabled();
    await login.email.fill("qa@nowhere-university.edu");
    await expect(login.submit).toBeDisabled();
    await login.password.fill("SomePassw0rd!");
    await expect(login.submit).toBeEnabled();
  });

  test("toggles password visibility without losing the value", async ({ page }) => {
    const login = new LoginPage(page);
    await login.open();
    await login.password.fill("SomePassw0rd!");
    await expect(login.password).toHaveAttribute("type", "password");

    await login.showPassword();
    await expect(login.password).toHaveAttribute("type", "text");
    await expect(login.password).toHaveValue("SomePassw0rd!");

    await login.hidePassword();
    await expect(login.password).toHaveAttribute("type", "password");
  });

  test("reports invalid credentials and keeps the email for a retry", async ({ page }) => {
    // A reserved TLD such as .test is rejected by the API's email validator before
    // the credential check runs, so this uses an ordinary, well-formed address.
    const email = "nobody@nowhere-university.edu";
    const login = new LoginPage(page);
    await login.open();
    await login.signIn(email, "WrongPassw0rd!");

    await expect(login.error).toContainText(/invalid email or password/i);
    await expect(login.email).toHaveValue(email);
    await expect(page).toHaveURL(/\/login/);
  });
});
