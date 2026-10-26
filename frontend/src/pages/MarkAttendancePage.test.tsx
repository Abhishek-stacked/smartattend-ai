import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { MarkAttendancePage } from "./MarkAttendancePage";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const student = {
  id: 2,
  email: "asha.rao@example.edu",
  full_name: "Asha Rao",
  role: "student",
  student_id: 7,
  faculty_id: null,
  last_login_at: null,
};

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 4,
    course_id: 1,
    course_code: "CS301",
    course_name: "Database Systems",
    title: "Lecture 3",
    session_date: "2026-10-26",
    scheduled_start: "2026-10-26T09:00:00Z",
    scheduled_end: "2026-10-26T10:00:00Z",
    status: "active",
    record_status: null,
    has_pending_request: false,
    self_marking_open: true,
    self_marking_message: null,
    self_marking_closes_at: "2026-10-26T09:30:00Z",
    ...overrides,
  };
}

function stubFetch(sessions: unknown[], markResult: unknown) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (url.includes("/api/auth/me")) return Promise.resolve(json(student));
      if (url.includes("/api/sessions/mine")) return Promise.resolve(json(sessions));
      if (url.includes("/self-mark")) return Promise.resolve(json(markResult));
      return Promise.resolve(json({ error: { code: "not_found", message: "Not found" } }, 404));
    }),
  );
  return calls;
}

afterEach(() => vi.restoreAllMocks());

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <MarkAttendancePage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("student mark attendance page", () => {
  it("lets a student mark an open session and confirms it", async () => {
    const calls = stubFetch(
      [session()],
      {
        session_id: 4,
        student_id: 7,
        status: "present",
        source: "self_reported",
        marked_at: "2026-10-26T09:05:00Z",
        already_marked: false,
      },
    );
    renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /mark me present/i }));

    expect(await screen.findByText(/you are marked present for lecture 3/i)).toBeInTheDocument();
    const post = calls.find((call) => call.url.endsWith("/api/sessions/4/self-mark"));
    expect(post?.method).toBe("POST");
  });

  it("explains why a session cannot be marked yet", async () => {
    stubFetch(
      [
        session({
          self_marking_open: false,
          self_marking_message: "Self-marking opens when the session starts",
          scheduled_start: "2026-10-26T14:00:00Z",
          scheduled_end: "2026-10-26T15:00:00Z",
        }),
      ],
      {},
    );
    renderPage();

    expect(await screen.findByText(/self-marking opens when the session starts/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark me present/i })).not.toBeInTheDocument();
  });

  it("reports that attendance was already recorded", async () => {
    stubFetch(
      [session()],
      {
        session_id: 4,
        student_id: 7,
        status: "present",
        source: "automated",
        marked_at: "2026-10-26T09:05:00Z",
        already_marked: true,
      },
    );
    renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /mark me present/i }));

    expect(await screen.findByText(/already recorded as present/i)).toBeInTheDocument();
  });

  it("shows an empty state when the student has no sessions", async () => {
    stubFetch([], {});
    renderPage();

    expect(await screen.findByText(/you are not on the roster for any session/i)).toBeInTheDocument();
  });

  it("keeps a closed session out of the upcoming list even before its end time", async () => {
    const futureEnd = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    stubFetch(
      [
        session({
          id: 9,
          title: "Closed but not finished",
          status: "closed",
          self_marking_open: false,
          self_marking_message: "This session is closed for attendance",
          scheduled_end: futureEnd,
        }),
      ],
      {},
    );
    renderPage();

    expect(await screen.findByText(/closed but not finished/i)).toBeInTheDocument();
    expect(screen.queryByText(/upcoming/i)).not.toBeInTheDocument();
    expect(screen.getByText(/earlier sessions/i)).toBeInTheDocument();
  });
});
