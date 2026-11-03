import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { LoginPage } from "../../e2e/pages/LoginPage";
import { test } from "./fixtures";

// The Gherkin layer adds no locators of its own: every action and assertion
// goes through the same Page Object Model the Playwright specs use, so a
// re-labelled button breaks one class instead of two suites.
const { Given, When, Then } = createBdd(test);

Given("the sign-in page is open", async ({ page }) => {
  await new LoginPage(page).open();
});

When("I type the email {string}", async ({ page }, email: string) => {
  await new LoginPage(page).email.fill(email);
});

When("I type the password {string}", async ({ page }, password: string) => {
  await new LoginPage(page).password.fill(password);
});

When("I sign in as {string} with {string}", async ({ page }, email: string, password: string) => {
  await new LoginPage(page).signIn(email, password);
});

When("I show the password", async ({ page }) => {
  await new LoginPage(page).showPassword();
});

When("I hide the password", async ({ page }) => {
  await new LoginPage(page).hidePassword();
});

Then("the sign in button is enabled", async ({ page }) => {
  await expect(new LoginPage(page).submit).toBeEnabled();
});

Then("the sign in button is disabled", async ({ page }) => {
  await expect(new LoginPage(page).submit).toBeDisabled();
});

Then("the sign in form is offered", async ({ page }) => {
  await expect(new LoginPage(page).submit).toBeVisible();
});

Then("the password field is masked", async ({ page }) => {
  await expect(new LoginPage(page).password).toHaveAttribute("type", "password");
});

Then("the password field is visible", async ({ page }) => {
  await expect(new LoginPage(page).password).toHaveAttribute("type", "text");
});

Then("the password field still holds {string}", async ({ page }, password: string) => {
  await expect(new LoginPage(page).password).toHaveValue(password);
});

Then("the email field still holds {string}", async ({ page }, email: string) => {
  await expect(new LoginPage(page).email).toHaveValue(email);
});

Then("I see the error {string}", async ({ page }, message: string) => {
  // The feature file states the sentence the user reads; match it the way the
  // specs do — case-insensitively and not anchored — so punctuation changes in
  // the UI do not silently rewrite the expected wording.
  await expect(new LoginPage(page).error).toContainText(new RegExp(message, "i"));
});

Then("I am still on the sign-in page", async ({ page }) => {
  await expect(page).toHaveURL(/\/login/);
});
