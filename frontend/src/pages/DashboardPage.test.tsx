import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { DashboardPage } from "./DashboardPage";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const admin = {
  id: 1,
  email: "admin@example.edu",
  full_name: "Dana Admin",
  role: "admin",
  student_id: null,
  faculty_id: null,
  last_login_at: "2026-10-25T08:00:00Z",
};

const student = {
  id: 2,
  email: "asha.rao@example.edu",
  full_name: "Asha Rao",
  role: "student",
  student_id: 3,
  faculty_id: null,
  last_login_at: null,
};

const summary = {
  scope: "admin",
  date_from: null,
  date_to: null,
  courses: 2,
  sessions: 4,
  participants: 12,
  records: 10,
  present: 6,
  late: 2,
  absent: 1,
  pending_review: 1,
  excused: 0,
  unmarked: 2,
  attendance_rate: 80,
  pending_reviews: 2,
  pending_corrections: 1,
  active_sessions: 1,
  generated_at: "2026-10-25T10:00:00Z",
};

const trends = {
  granularity: "day",
  date_from: null,
  date_to: null,
  series: [
    { bucket: "2026-10-20", label: "20 Oct", present: 4, late: 1, absent: 1, excused: 0, pending_review: 0, total: 6, rate: 83.3 },
  ],
  distribution: { present: 6, late: 2, absent: 1, excused: 0, pending_review: 1 },
  courses: [
    {
      course_id: 1,
      code: "CS301",
      name: "Database Systems",
      present: 4,
      late: 1,
      absent: 1,
      excused: 0,
      pending_review: 0,
      total: 6,
      rate: 83.3,
    },
  ],
};

const activity = {
  events: [],
  sessions: [
    {
      id: 4,
      title: "Lecture 3",
      course_code: "CS301",
      session_date: "2026-10-24",
      status: "finalized",
      counts: { participants: 10, present: 6, late: 2, absent: 1, pending_review: 1, excused: 0, unmarked: 0 },
    },
  ],
  pending_reviews: 2,
  pending_corrections: 1,
};

const meSummary = {
  ...summary,
  scope: "student",
  registration_number: "CS21-001",
  sessions: 2,
  participants: 2,
  records: 2,
  present: 1,
  late: 1,
  absent: 0,
  pending_review: 0,
  unmarked: 0,
  attendance_rate: 100,
  pending_reviews: 0,
  pending_corrections: 1,
  active_sessions: 0,
  student_id: 3,
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
  student_id: 3,
  registration_number: "CS21-001",
  student_name: "Asha Rao",
  status: "late",
  source: "manual",
  marked_at: "2026-10-24T09:12:00Z",
  correction_reason: null,
  corrected_at: null,
  reviewer_id: null,
};

function stubFetch(user: unknown, staff: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/me")) return Promise.resolve(json(user));
      if (url.includes("/api/health")) {
        return Promise.resolve(
          json({
            status: "ok",
            database: "ok",
            models: { face_detection: "present", face_recognition: "present", liveness: "present" },
          }),
        );
      }
      if (staff) {
        if (url.includes("/api/reports/summary")) return Promise.resolve(json(summary));
        if (url.includes("/api/reports/trends")) return Promise.resolve(json(trends));
        if (url.includes("/api/reports/activity")) return Promise.resolve(json(activity));
      } else {
        if (url.includes("/api/me/summary")) return Promise.resolve(json(meSummary));
        if (url.includes("/api/me/attendance")) {
          return Promise.resolve(json({ items: [record], total: 1, page: 1, page_size: 6 }));
        }
      }
      return Promise.resolve(json({ error: { code: "not_found", message: "Not found" } }, 404));
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("dashboard", () => {
  it("shows staff metrics, pending work and recent sessions", async () => {
    stubFetch(admin, true);
    render(
      <MemoryRouter>
        <AuthProvider>
          <DashboardPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Attendance rate")).toBeInTheDocument();
    expect(screen.getByText("80.0%")).toBeInTheDocument();
    expect(screen.getByText("8 of 10 marked")).toBeInTheDocument();
    expect(screen.getByText("1 active · 12 participants")).toBeInTheDocument();
    expect(screen.getByText("2 reviews · 1 corrections")).toBeInTheDocument();
    expect(screen.getByText("2 recognition event(s) to review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /1 correction request/ })).toHaveAttribute("href", "/corrections");
    expect(screen.getByRole("link", { name: /CS301 · Lecture 3/ })).toHaveAttribute("href", "/sessions/4");
    expect(screen.getByText("Operational")).toBeInTheDocument();
  });

  it("shows a student their own attendance without staff metrics", async () => {
    stubFetch(student, false);
    render(
      <MemoryRouter>
        <AuthProvider>
          <DashboardPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Recent attendance")).toBeInTheDocument();
    expect(screen.getByText("100.0%")).toBeInTheDocument();
    expect(screen.getByText("CS21-001")).toBeInTheDocument();
    expect(screen.getByText("CS301")).toBeInTheDocument();
    expect(screen.getByText("Late")).toBeInTheDocument();
    expect(screen.queryByText("Attendance trend")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
  });
});
