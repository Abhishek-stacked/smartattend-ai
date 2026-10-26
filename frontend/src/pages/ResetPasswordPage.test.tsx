import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResetPasswordPage } from "./ResetPasswordPage";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubFetch(handler: () => Response) {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      calls.push({ url: String(input), body });
      return Promise.resolve(handler());
    }),
  );
  return calls;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ResetPasswordPage />
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("reset password page", () => {
  it("explains an incomplete link instead of showing the form", () => {
    stubFetch(() => json({}));
    renderAt("/reset-password");

    expect(screen.getByText(/this link is incomplete/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /set new password/i })).not.toBeInTheDocument();
  });

  it("validates confirmation and surfaces an expired token error", async () => {
    stubFetch(() =>
      json({ error: { code: "invalid_reset_token", message: "This reset link is invalid or has expired" } }, 400),
    );
    renderAt("/reset-password?token=used-token");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^new password/i), "NewPassw0rd!2345");
    await user.type(screen.getByLabelText(/^confirm new password/i), "MismatchPassw0rd!2");
    await user.click(screen.getByRole("button", { name: /set new password/i }));
    expect(await screen.findByText(/the two passwords do not match/i)).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/^confirm new password/i));
    await user.type(screen.getByLabelText(/^confirm new password/i), "NewPassw0rd!2345");
    await user.click(screen.getByRole("button", { name: /set new password/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This reset link is invalid or has expired");
  });

  it("confirms a successful reset and links back to sign in", async () => {
    const calls = stubFetch(() => json({ message: "Password updated. You can now sign in." }));
    renderAt("/reset-password?token=one-time");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^new password/i), "NewPassw0rd!2345");
    await user.type(screen.getByLabelText(/^confirm new password/i), "NewPassw0rd!2345");
    await user.click(screen.getByRole("button", { name: /set new password/i }));

    expect(await screen.findByText(/you can now sign in with your new password/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to sign in/i })).toHaveAttribute("href", "/login");
    expect(calls[0].body).toEqual({ token: "one-time", new_password: "NewPassw0rd!2345" });
  });
});
