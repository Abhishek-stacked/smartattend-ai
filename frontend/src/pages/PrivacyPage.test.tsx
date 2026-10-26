import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { PrivacyPage } from "./PrivacyPage";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const student = {
  id: 2,
  email: "asha.rao@example.edu",
  full_name: "Asha Rao",
  role: "student",
  student_id: 1,
  faculty_id: null,
  last_login_at: null,
};

const policy = {
  policy_version: "1.0",
  title: "Facial attendance enrolment notice",
  sections: [{ heading: "What we collect", body: "Encrypted face templates, never photographs." }],
  retention_days: 365,
};

function enrollment(templateCount: number, status: "granted" | "withdrawn" = "granted") {
  return {
    student_id: 1,
    consent: {
      status,
      policy_version: "1.0",
      capture_method: "camera",
      granted_at: "2026-10-01T09:00:00Z",
      withdrawn_at: status === "withdrawn" ? "2026-10-20T09:00:00Z" : null,
    },
    template_count: templateCount,
    model: "SFace",
    model_version: "2021dec",
    enrolled_at: templateCount > 0 ? "2026-10-02T09:00:00Z" : null,
  };
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function stubFetch(handlers: Array<[(url: string, method: string) => boolean, (call: Call) => Response]>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      const call = { url, method, body };
      calls.push(call);
      const handler = handlers.find(([match]) => match(url, method));
      if (!handler) return Promise.resolve(json({ error: { code: "not_found", message: "Not found" } }, 404));
      return Promise.resolve(handler[1](call));
    }),
  );
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe("student privacy page", () => {
  it("shows consent and template status without ever exposing templates", async () => {
    stubFetch([
      [(url, method) => url.includes("/api/auth/me") && method === "GET", () => json(student)],
      [(url) => url.includes("/api/privacy/policy"), () => json(policy)],
      [(url) => url.includes("/api/enrollment/1"), () => json(enrollment(3))],
    ]);

    render(
      <MemoryRouter>
        <AuthProvider>
          <PrivacyPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Your biometric status")).toBeInTheDocument();
    expect(screen.getByText("Granted")).toBeInTheDocument();
    expect(screen.getByText("SFace 2021dec")).toBeInTheDocument();
    expect(screen.getByText("Encrypted face templates, never photographs.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete my face data/i })).toBeInTheDocument();
  });

  it("deletes templates with consent withdrawal and a reason", async () => {
    let deleted = false;
    const calls = stubFetch([
      [(url, method) => url.includes("/api/auth/me") && method === "GET", () => json(student)],
      [(url) => url.includes("/api/privacy/policy"), () => json(policy)],
      [(url) => url.includes("/api/enrollment/1"), () => json(enrollment(deleted ? 0 : 3, deleted ? "withdrawn" : "granted"))],
      [
        (url, method) => url.includes("/api/biometrics/1/delete") && method === "POST",
        () => {
          deleted = true;
          return json({ deleted_templates: 3, consent_withdrawn: true });
        },
      ],
    ]);

    render(
      <MemoryRouter>
        <AuthProvider>
          <PrivacyPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /delete my face data/i }));
    await user.type(screen.getByLabelText(/reason/i), "I no longer want facial recognition");
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText(/3 encrypted templates deleted and consent withdrawn/i)).toBeInTheDocument();
    const post = calls.find((call) => call.url.includes("/api/biometrics/1/delete"));
    expect(post?.body).toEqual({
      withdraw_consent: true,
      reason: "I no longer want facial recognition",
    });
    expect(await screen.findByRole("button", { name: /withdraw consent/i })).toBeInTheDocument();
  });
});
