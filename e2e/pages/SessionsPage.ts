import { expect, type Page } from "@playwright/test";

export class SessionsPage {
  constructor(private readonly page: Page) {}

  get heading() {
    return this.page.getByRole("heading", { name: /attendance sessions/i, level: 1 });
  }

  get filter() {
    return this.page.getByRole("searchbox", { name: /filter sessions/i });
  }

  get rows() {
    return this.page.locator("tbody tr");
  }

  get emptyState() {
    return this.page.getByText(/no sessions match these filters/i);
  }

  async open() {
    await this.page.goto("/sessions");
    await expect(this.heading).toBeVisible();
  }

  async filterBy(text: string) {
    await this.filter.fill(text);
  }
}
