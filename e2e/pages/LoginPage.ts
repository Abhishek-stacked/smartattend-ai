import { expect, type Locator, type Page } from "@playwright/test";

export class LoginPage {
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly error: Locator;

  constructor(readonly page: Page) {
    this.email = page.getByRole("textbox", { name: /email address/i });
    this.password = page.getByRole("textbox", { name: /^password/i });
    this.submit = page.getByRole("button", { name: /sign in/i });
    this.error = page.getByRole("alert");
  }

  async open() {
    await this.page.goto("/login");
    await expect(this.page.getByRole("button", { name: /sign in/i })).toBeVisible();
  }

  async signIn(email: string, password: string) {
    await this.email.fill(email);
    await this.password.fill(password);
    await this.submit.click();
  }

  async showPassword() {
    await this.page.getByRole("button", { name: /show password/i }).click();
  }

  async hidePassword() {
    await this.page.getByRole("button", { name: /hide password/i }).click();
  }
}
