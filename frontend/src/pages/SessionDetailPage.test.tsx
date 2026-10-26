import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { SessionDetailPage } from "./SessionDetailPage";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const admin = {
  id: 1,
  email: "admin@example.edu",
  full_name: "Campus Admin",
  role: "admin",
  student_id: null,
  faculty_id: null,
  last_login_at: null,
};

const faculty = { ...admin, id: 3, email: "meera.iyer@example.edu", role: "faculty", faculty_id: 1 };

const session = {
  id: 4,
  course_id: 1,
  course_code: "CS301",
  course_name: "Database Systems",
  faculty_id: 1,
  faculty_name: "Meera Iyer",
  title: "Lecture 3",
  session_date: "2026-10-26",
  scheduled_start: "2026-10-26T09:00:00Z",
  scheduled_end: "2026-10-26T10:00:00Z",
  late_after: "2026-10-26T09:10:00Z",
  attendance_closes_at: "2026-10-26T09:30:00Z",
  status: "active",
  liveness_policy: "off",
  self_marking_enabled: false,
  started_at: "2026-10-26T09:00:00Z",
  closed_at: null,
  finalized_at: null,
  created_at: "2026-10-25T09:00:00Z",
  counts: {
    participants: 1,
    present: 0,
    late: 0,
    absent: 0,
    pending_review: 0,
    excused: 0,
    unmarked: 1,
  },
};

function rosterEntry(overrides: Record<string, unknown> = {}) {
  return {
    student_id: 7,
    registration_number: "CS21-001",
    full_name: "Asha Rao",
    status: null,
    source: null,
    marked_at: null,
    biometric_enrolled: true,
    self_marking_locked: false,
    self_marking_lock_reason: null,
    ...overrides,
  };
}

function stubFetch(me: unknown, roster: unknown[]) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      calls.push({ url, method, body });
      if (url.includes("/api/auth/me")) return Promise.resolve(json(me));
      if (url.includes("/api/sessions/4/roster")) return Promise.resolve(json(roster));
      if (url.includes("/api/sessions/4/self-marking")) {
        return Promise.resolve(json({ ...session, self_marking_enabled: true }));
      }
      if (url.includes("/self-marking") && method === "PATCH") {
        return Promise.resolve(json(roster.map((entry) => ({ ...(entry as object), self_marking_locked: true }))));
      }
      if (url.endsWith("/api/sessions/4")) return Promise.resolve(json(session));
      return Promise.resolve(json({ error: { code: "not_found", message: "Not found" } }, 404));
    }),
  );
  return calls;
}

afterEach(() => vi.restoreAllMocks());

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/sessions/4"]}>
      <AuthProvider>
        <Routes>
          <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("session detail self-marking controls", () => {
  it("lets an admin switch student self-marking on for the session", async () => {
    const calls = stubFetch(admin, [rosterEntry()]);
    renderPage();

    const user = userEvent.setup();
    const toggle = await screen.findByRole("switch", { name: /student self-marking/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);

    const patch = calls.find((call) => call.url.endsWith("/api/sessions/4/self-marking"));
    expect(patch?.method).toBe("PATCH");
    expect(patch?.body).toEqual({ enabled: true });
  });

  it("lets staff lock one student out of self-marking with a reason", async () => {
    const calls = stubFetch(faculty, [rosterEntry()]);
    renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^lock$/i }));
    await user.type(screen.getByLabelText(/reason/i), "Verifying presence in person");
    await user.click(screen.getByRole("button", { name: /lock self-marking/i }));

    const patch = calls.find((call) => call.url.includes("/participants/7/self-marking"));
    expect(patch?.method).toBe("PATCH");
    expect(patch?.body).toEqual({ locked: true, reason: "Verifying presence in person" });
  });

  it("hides the session switch from faculty", async () => {
    stubFetch(faculty, [rosterEntry()]);
    renderPage();

    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /student self-marking/i })).not.toBeInTheDocument();
  });
});
