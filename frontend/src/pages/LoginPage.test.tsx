import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import App from "../App";
import { LoginPage } from "./LoginPage";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const anonymous = () => json({ error: { code: "unauthenticated", message: "Please sign in", details: null } }, 401);

function stubFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = Object.keys(routes).find((path) => url.endsWith(path));
    if (!key) return Promise.resolve(json({ error: { code: "not_found", message: "Not found" } }, 404));
    return Promise.resolve(routes[key](init));
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => vi.restoreAllMocks());

describe("login", () => {
  it("shows the API error message on invalid credentials", async () => {
    stubFetch({
      "/api/auth/me": anonymous,
      "/api/auth/login": () =>
        json({ error: { code: "invalid_credentials", message: "Invalid email or password", details: null } }, 401),
    });

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email address/i), "staff@example.edu");
    await user.type(screen.getByLabelText(/^password/i), "WrongPassw0rd");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
  });
});

describe("route protection", () => {
  it("redirects an anonymous visitor to the login page", async () => {
    stubFetch({ "/api/auth/me": anonymous });

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });

  it("blocks a student from an administrator route", async () => {
    stubFetch({
      "/api/auth/me": () =>
        json({
          id: 3,
          email: "student@example.edu",
          full_name: "Asha Rao",
          role: "student",
          student_id: 1,
          faculty_id: null,
          last_login_at: null,
        }),
      "/api/health": () => json({ status: "ok", database: "ok", models: {} }),
    });

    render(
      <MemoryRouter initialEntries={["/admin/users"]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /do not have access/i })).toBeInTheDocument();
  });

  it("filters navigation by role", async () => {
    stubFetch({
      "/api/auth/me": () =>
        json({
          id: 3,
          email: "student@example.edu",
          full_name: "Asha Rao",
          role: "student",
          student_id: 1,
          faculty_id: null,
          last_login_at: null,
        }),
      "/api/health": () => json({ status: "ok", database: "ok", models: {} }),
    });

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /good (morning|afternoon|evening)/i })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: /main navigation/i });
    expect(nav).toHaveTextContent("Privacy & biometrics");
    expect(nav).not.toHaveTextContent("Students");
    expect(nav).not.toHaveTextContent("Live attendance");
  });
});
