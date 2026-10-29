import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { AdminUsersPage } from "./AdminUsersPage";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const reset = {
  reset_url: "https://attendance.example.edu/reset-password?token=one-time",
  expires_at: "2026-10-26T09:00:00Z",
  note: "Share this link privately.",
};

const account = {
  id: 2,
  email: "priya.nair@example.edu",
  full_name: "Priya Nair",
  role: "admin",
  is_active: true,
  locked: true,
  last_login_at: "2026-10-20T09:00:00Z",
};

type Call = { url: string; method: string; body: unknown };

const me = {
  id: 1,
  email: "admin@example.edu",
  full_name: "Primary Admin",
  role: "admin" as const,
  student_id: null,
  faculty_id: null,
  last_login_at: null,
};

function stubFetch(options: { onList?: () => Response; canCreateAdmins?: boolean } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      calls.push({ url, method, body });
      if (url.endsWith("/api/auth/me")) {
        return Promise.resolve(json({ ...me, can_create_admins: options.canCreateAdmins ?? true }));
      }
      if (url.includes("/reset-link")) return Promise.resolve(json(reset));
      if (url.endsWith("/api/users") && method === "POST") {
        return Promise.resolve(
          json({
            user: { ...account, id: 3, email: "new.admin@example.edu", full_name: "New Admin", locked: false },
            reset,
          }),
        );
      }
      if (url.includes("/api/users/") && method === "PATCH") {
        return Promise.resolve(json({ ...account, ...(body as object) }));
      }
      if (url.includes("/api/users?")) {
        return Promise.resolve(
          options.onList?.() ??
            json({ items: [account], total: 1, page: 1, page_size: 10 }),
        );
      }
      return Promise.resolve(json({ error: { code: "not_found", message: "Not found" } }, 404));
    }),
  );
  return calls;
}

function renderPage(options: Parameters<typeof stubFetch>[0] = {}) {
  const calls = stubFetch(options);
  render(
    <AuthProvider>
      <MemoryRouter>
        <AdminUsersPage />
      </MemoryRouter>
    </AuthProvider>,
  );
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe("admin user console", () => {
  it("shows locked accounts and issues a one-time reset link", async () => {
    const calls = renderPage();

    expect(await screen.findByText("Priya Nair")).toBeInTheDocument();
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.getByText("Showing 1–1 of 1")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /reset link/i }));

    expect(await screen.findByText(reset.reset_url)).toBeInTheDocument();
    expect(screen.getByText(/works a single time/i)).toBeInTheDocument();

    const post = calls.find((call) => call.url.includes("/api/users/2/reset-link"));
    expect(post?.method).toBe("POST");
  });

  it("unlocks and deactivates an account through the API", async () => {
    const calls = renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Unlock" }));
    await vi.waitFor(() => {
      const patch = calls.find((call) => call.method === "PATCH");
      expect(patch?.body).toEqual({ unlock: true });
    });

    await user.click(screen.getByRole("button", { name: "Deactivate" }));
    const confirm = await screen.findByRole("dialog", { name: /deactivate account/i });
    await user.click(within(confirm).getByRole("button", { name: "Deactivate" }));

    await vi.waitFor(() => {
      const patches = calls.filter((call) => call.method === "PATCH");
      expect(patches.at(-1)?.body).toEqual({ is_active: false });
    });
  });

  it("creates an administrator without a password and shows the reset link", async () => {
    const calls = renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /add administrator/i }));
    await user.type(screen.getByLabelText(/full name/i), "New Admin");
    await user.type(screen.getByLabelText(/email address/i), "new.admin@example.edu");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText(reset.reset_url)).toBeInTheDocument();
    const post = calls.find((call) => call.method === "POST" && call.url.endsWith("/api/users"));
    expect(post?.body).toEqual({ email: "new.admin@example.edu", full_name: "New Admin", role: "admin" });
  });

  it("hides the add-administrator action for every other administrator", async () => {
    renderPage({ canCreateAdmins: false });

    expect(await screen.findByText("Priya Nair")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add administrator/i })).not.toBeInTheDocument();
  });
});
