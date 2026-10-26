import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LivePage } from "./LivePage";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const session = {
  id: 4,
  course_id: 1,
  course_code: "CS301",
  course_name: "Database Systems",
  faculty_id: 1,
  faculty_name: "Meera Iyer",
  title: "Lecture 3",
  session_date: "2026-10-25",
  scheduled_start: "2026-10-25T09:00:00Z",
  scheduled_end: "2026-10-25T10:00:00Z",
  late_after: "2026-10-25T09:10:00Z",
  attendance_closes_at: "2026-10-25T10:00:00Z",
  status: "active",
  liveness_policy: "enforce",
  started_at: "2026-10-25T09:00:00Z",
  closed_at: null,
  finalized_at: null,
  created_at: "2026-10-24T09:00:00Z",
  counts: { participants: 1, present: 0, late: 0, absent: 0, pending_review: 0, excused: 0, unmarked: 1 },
};

const rosterEntry = {
  student_id: 7,
  registration_number: "CS21-001",
  full_name: "Asha Rao",
  status: null,
  source: null,
  marked_at: null,
  biometric_enrolled: true,
};

function stubFetch(policy: "off" | "flag" | "enforce" = "enforce") {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  let marked = false;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      calls.push({ url, method, body });
      if (url.includes("/api/settings/client")) {
        return Promise.resolve(
          json({
            liveness_policy: policy,
            frame_interval_ms: 1000,
            min_face_px: 80,
            default_late_after_min: 10,
            default_window_min: 20,
            faculty_can_correct: false,
            timezone: "UTC",
          }),
        );
      }
      if (url.includes("/api/sessions?status=active")) {
        return Promise.resolve(
          json({ items: [{ ...session, liveness_policy: policy }], total: 1, page: 1, page_size: 100 }),
        );
      }
      if (url.includes("/api/sessions/4/attendance")) {
        marked = true;
        return Promise.resolve(
          json({
            ...rosterEntry,
            status: "present",
            source: "manual",
            marked_at: "2026-10-25T09:05:00Z",
          }, 201),
        );
      }
      if (url.includes("/api/sessions/4/roster")) {
        return Promise.resolve(
          json([
            marked
              ? { ...rosterEntry, status: "present", source: "manual", marked_at: "2026-10-25T09:05:00Z" }
              : rosterEntry,
          ]),
        );
      }
      if (url.includes("/api/sessions/4")) {
        return Promise.resolve(json({ ...session, liveness_policy: policy }));
      }
      return Promise.resolve(json({ error: { code: "not_found", message: "Not found" } }, 404));
    }),
  );
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe("live attendance page", () => {
  it("explains the liveness policy and keeps manual marking available", async () => {
    stubFetch();
    render(
      <MemoryRouter initialEntries={["/live?session=4"]}>
        <LivePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/written only when the liveness check passes/i)).toBeInTheDocument();
    expect(screen.getByText("Manual fallback")).toBeInTheDocument();
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on camera" })).toBeEnabled();
  });

  it("records a manual mark with a reason and refreshes the roster", async () => {
    const calls = stubFetch();
    render(
      <MemoryRouter initialEntries={["/live?session=4"]}>
        <LivePage />
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /present/i }));
    await user.type(screen.getByLabelText(/reason/i), "Camera station unavailable");
    await user.click(screen.getByRole("button", { name: "Save mark" }));

    expect(await screen.findByText("Present")).toBeInTheDocument();
    const post = calls.find((call) => call.url.includes("/api/sessions/4/attendance"));
    expect(post?.body).toEqual({ student_id: 7, status: "present", reason: "Camera station unavailable" });
    expect(screen.getByText(/Liveness policy: enforce/i)).toBeInTheDocument();
  });

  it("explains that the flag policy queues failed checks for review", async () => {
    stubFetch("flag");
    render(
      <MemoryRouter initialEntries={["/live?session=4"]}>
        <LivePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Liveness policy: flag")).toBeInTheDocument();
    expect(screen.getByText(/queued for staff review/i)).toBeInTheDocument();
  });

  it("hides the liveness banner when the session policy is off", async () => {
    stubFetch("off");
    render(
      <MemoryRouter initialEntries={["/live?session=4"]}>
        <LivePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Manual fallback")).toBeInTheDocument();
    expect(screen.queryByText(/Liveness policy:/i)).not.toBeInTheDocument();
  });
});
