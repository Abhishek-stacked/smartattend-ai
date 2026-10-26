import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { CorrectionsPage } from "./CorrectionsPage";

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

const faculty = {
  id: 1,
  email: "meera.iyer@example.edu",
  full_name: "Meera Iyer",
  role: "faculty",
  student_id: null,
  faculty_id: 1,
  last_login_at: null,
};

const request = {
  id: 5,
  student_id: 7,
  student_name: "Asha Rao",
  registration_number: "CS21-001",
  session_id: 4,
  course_code: "CS301",
  course_name: "Database Systems",
  session_title: "Lecture 3",
  session_date: "2026-10-25",
  session_status: "finalized",
  attendance_record_id: 21,
  current_status: "absent",
  request_type: "correction",
  requested_status: "present",
  reason: "I was in the lab but the camera missed me.",
  status: "pending",
  created_at: "2026-10-25T11:00:00Z",
  reviewed_at: null,
  reviewer_note: null,
};

const studentSession = {
  id: 4,
  course_id: 1,
  course_code: "CS301",
  course_name: "Database Systems",
  title: "Lecture 3",
  session_date: "2026-10-25",
  scheduled_start: "2026-10-25T09:00:00Z",
  scheduled_end: "2026-10-25T10:00:00Z",
  status: "finalized",
  record_status: "absent",
  has_pending_request: false,
};

function stubFetch(me: unknown) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      calls.push({ url, method, body });
      if (url.includes("/api/auth/me")) return Promise.resolve(json(me));
      if (url.includes("/api/corrections/5/approve")) {
        return Promise.resolve(json({ ...request, status: "approved", current_status: "present" }));
      }
      if (url.includes("/api/corrections?")) {
        return Promise.resolve(
          json({ items: me === faculty ? [request] : [], total: me === faculty ? 1 : 0, page: 1, page_size: 15 }),
        );
      }
      if (url.includes("/api/corrections")) return Promise.resolve(json({ ...request, id: 6 }, 201));
      if (url.includes("/api/sessions/mine")) return Promise.resolve(json([studentSession]));
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
        <CorrectionsPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("corrections page", () => {
  it("lets a student raise a request for a finished session", async () => {
    const calls = stubFetch(student);
    renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /new request/i }));
    await user.selectOptions(screen.getByLabelText("Session"), "4");
    await user.selectOptions(screen.getByLabelText("Requested status"), "late");
    await user.type(screen.getByLabelText(/what happened/i), "Bus was late, camera queue was long.");
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByText(/your official record stays unchanged/i)).toBeInTheDocument();
    const post = calls.find((call) => call.url.endsWith("/api/corrections") && call.method === "POST");
    expect(post?.body).toEqual({
      session_id: 4,
      requested_status: "late",
      reason: "Bus was late, camera queue was long.",
    });
  });

  it("lets faculty approve a pending request with a required note", async () => {
    const calls = stubFetch(faculty);
    renderPage();

    const user = userEvent.setup();
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.type(screen.getByLabelText(/review note/i), "Verified the lab sign-in sheet");
    await user.click(screen.getByRole("button", { name: "Approve and apply" }));

    expect(await screen.findByText(/request approved/i)).toBeInTheDocument();
    const post = calls.find((call) => call.url.includes("/api/corrections/5/approve"));
    expect(post?.method).toBe("POST");
    expect(post?.body).toEqual({ note: "Verified the lab sign-in sheet" });
  });
});
