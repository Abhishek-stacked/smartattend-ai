import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { attendanceLabel, attendanceRate, attendanceTone, sessionTone } from "../lib/attendance";
import { AttendancePage } from "./AttendancePage";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubFetch(routes: Array<[string, () => Response]>) {
  const mock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const route = routes.find(([path]) => url.includes(path));
    if (!route) return Promise.resolve(json({ error: { code: "not_found", message: "Not found" } }, 404));
    return Promise.resolve(route[1]());
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const student = {
  id: 2,
  email: "asha.rao@example.edu",
  full_name: "Asha Rao",
  role: "student",
  student_id: 1,
  faculty_id: null,
  last_login_at: null,
};

const record = {
  id: 9,
  session_id: 4,
  course_id: 1,
  course_code: "CS301",
  course_name: "Database Systems",
  session_title: "Lecture 3 - Normalisation",
  session_date: "2026-10-24",
  session_status: "finalized",
  student_id: 1,
  registration_number: "CS21-001",
  student_name: "Asha Rao",
  status: "present",
  source: "manual",
  marked_at: "2026-10-24T09:12:00Z",
  correction_reason: null,
  corrected_at: null,
  reviewer_id: null,
};

afterEach(() => vi.restoreAllMocks());

describe("attendance helpers", () => {
  it("labels and tones every status", () => {
    expect(attendanceLabel("pending_review")).toBe("Pending review");
    expect(attendanceLabel(null)).toBe("Not marked");
    expect(attendanceTone("absent")).toBe("danger");
    expect(sessionTone("finalized")).toBe("brand");
  });

  it("computes the attendance rate from marked records only", () => {
    expect(
      attendanceRate({ participants: 10, present: 6, late: 1, absent: 1, pending_review: 0, excused: 2, unmarked: 0 }),
    ).toBeCloseTo(70);
    expect(
      attendanceRate({ participants: 0, present: 0, late: 0, absent: 0, pending_review: 0, excused: 0, unmarked: 0 }),
    ).toBe(0);
  });
});

describe("student attendance page", () => {
  it("shows only the record details and the audit history", async () => {
    stubFetch([
      ["/api/auth/me", () => json(student)],
      ["/api/attendance/9", () =>
        json({
          ...record,
          event: null,
          history: [
            {
              id: 1,
              occurred_at: "2026-10-24T09:12:00Z",
              action: "attendance.manual",
              actor_name: "Meera Iyer",
              actor_role: "faculty",
              before: null,
              after: { status: "present" },
              reason: "Roll call",
            },
          ],
        })],
      ["/api/attendance?", () => json({ items: [record], total: 1, page: 1, page_size: 15 })],
    ]);

    render(
      <MemoryRouter>
        <AuthProvider>
          <AttendancePage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("CS301")).toBeInTheDocument();
    expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "View" }));

    expect(await screen.findByText("Audit history")).toBeInTheDocument();
    expect(screen.getByText(/Roll call/)).toBeInTheDocument();
    expect(screen.queryByText("Record correction")).not.toBeInTheDocument();
  });

  it("lets a student raise a correction request from the record detail", async () => {
    const fetchMock = stubFetch([
      ["/api/auth/me", () => json(student)],
      ["/api/attendance/9", () => json({ ...record, event: null, history: [] })],
      ["/api/corrections", () => json({ id: 6, status: "pending" }, 201)],
      ["/api/attendance?", () => json({ items: [record], total: 1, page: 1, page_size: 15 })],
    ]);

    render(
      <MemoryRouter>
        <AuthProvider>
          <AttendancePage />
        </AuthProvider>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "View" }));
    await user.selectOptions(await screen.findByLabelText("Requested status"), "excused");
    await user.type(screen.getByLabelText(/reason/i), "Medical appointment off campus.");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    expect(await screen.findByText(/correction request submitted/i)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/api/corrections"));
    expect(call).toBeDefined();
    const init = call?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      session_id: 4,
      requested_status: "excused",
      reason: "Medical appointment off campus.",
    });
  });
});
