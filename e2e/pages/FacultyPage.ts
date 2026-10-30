import { expect, type Locator, type Page } from "@playwright/test";

export class FacultyPage {
  readonly heading: Locator;
  readonly rows: Locator;
  readonly search: Locator;
  readonly detail: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole("heading", { name: /faculty/i, level: 1 });
    this.rows = page.getByRole("row");
    this.search = page.getByRole("searchbox", { name: /search faculty/i });
    this.detail = page.getByRole("dialog");
  }

  async open() {
    await this.page.goto("/faculty");
    await expect(this.heading).toBeVisible();
  }

  async searchFor(text: string) {
    await this.search.fill(text);
  }

  async openFirstDetail() {
    await this.rows.nth(1).getByRole("button", { name: "View" }).click();
    await expect(this.detail).toBeVisible();
  }
}
