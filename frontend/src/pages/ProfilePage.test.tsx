import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import type { Me } from "../lib/types";
import { ProfilePage } from "./ProfilePage";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const me: Me = {
  id: 1,
  email: "admin@example.edu",
  full_name: "Admin User",
  role: "admin",
  student_id: null,
  faculty_id: null,
  last_login_at: "2026-10-20T09:00:00Z",
  can_create_admins: true,
};

const studentMe: Me = {
  id: 5,
  email: "asha.rao@niet.edu",
  full_name: "Asha Rao",
  role: "student",
  student_id: 7,
  faculty_id: null,
  last_login_at: "2026-10-20T09:00:00Z",
  can_create_admins: false,
};

function stubFetch(profile: Me = me) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      calls.push({ url, method, body });
      if (url.endsWith("/api/auth/me")) return Promise.resolve(json(profile));
      if (url.endsWith("/api/auth/change-password")) {
        return Promise.resolve(json({ message: "Password changed. Other signed-in devices were signed out." }));
      }
      if (url.endsWith("/api/enrollment/7")) {
        return Promise.resolve(
          json({
            student_id: 7,
            consent: {
              status: "granted",
              policy_version: "1.0",
              capture_method: "self_service",
              granted_at: "2026-10-21T09:00:00Z",
              withdrawn_at: null,
            },
            template_count: 3,
            model: "SFace",
            model_version: "2021dec",
            enrolled_at: "2026-10-21T09:05:00Z",
          }),
        );
      }
      if (url.includes("/api/privacy/policy")) {
        return Promise.resolve(
          json({
            policy_version: "1.0",
            title: "Facial attendance enrolment notice",
            sections: [{ heading: "What we collect", body: "Encrypted templates only." }],
            retention_days: 365,
          }),
        );
      }
      if (url.endsWith("/api/settings/client")) {
        return Promise.resolve(
          json({
            liveness_policy: "off",
            frame_interval_ms: 1000,
            min_face_px: 80,
            default_late_after_min: 10,
            default_window_min: 20,
            faculty_can_correct: false,
            timezone: "UTC",
          }),
        );
      }
      return Promise.resolve(json({ error: { code: "not_found", message: "Not found" } }, 404));
    }),
  );
  return calls;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <ProfilePage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("profile page", () => {
  it("rejects mismatched passwords before calling the API", async () => {
    const calls = stubFetch();
    renderPage();

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^current password/i), "OldPassw0rd!234");
    await user.type(screen.getByLabelText(/^new password/i), "NewPassw0rd!2345");
    await user.type(screen.getByLabelText(/^confirm new password/i), "DifferentPassw0rd!2");
    await user.click(screen.getByRole("button", { name: /update password/i }));

    expect(await screen.findByText(/the new passwords do not match/i)).toBeInTheDocument();
    expect(calls.some((call) => call.url.includes("/auth/change-password"))).toBe(false);
  });

  it("changes the password and shows the server confirmation", async () => {
    const calls = stubFetch();
    renderPage();

    const user = userEvent.setup();
    await screen.findByText("admin@example.edu");
    await user.type(screen.getByLabelText(/^current password/i), "OldPassw0rd!234");
    await user.type(screen.getByLabelText(/^new password/i), "NewPassw0rd!2345");
    await user.type(screen.getByLabelText(/^confirm new password/i), "NewPassw0rd!2345");
    await user.click(screen.getByRole("button", { name: /update password/i }));

    expect(await screen.findByRole("status")).toHaveTextContent("Other signed-in devices were signed out");
    const post = calls.find((call) => call.url.includes("/auth/change-password"));
    expect(post?.method).toBe("POST");
    expect(post?.body).toEqual({ current_password: "OldPassw0rd!234", new_password: "NewPassw0rd!2345" });
    expect(screen.getByLabelText(/^current password/i)).toHaveValue("");
  });

  it("shows a student their face registration status and opens self-enrolment", async () => {
    stubFetch(studentMe);
    renderPage();

    expect(await screen.findByText("Templates")).toBeInTheDocument();
    expect(screen.getByText("Granted")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /update my face data/i }));

    expect(await screen.findByText(/camera is off/i)).toBeInTheDocument();
    expect(screen.getByText("Register your face")).toBeInTheDocument();
  });
});
