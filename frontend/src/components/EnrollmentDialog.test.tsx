import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnrollmentDialog } from "./EnrollmentDialog";
import type { Student } from "../lib/types";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const student: Student = {
  id: 1,
  user_id: 2,
  registration_number: "CS21-001",
  full_name: "Asha Rao",
  email: "asha.rao@example.edu",
  department: "Computer Science",
  program: "B.Sc. Computer Science",
  enrollment_year: 2021,
  status: "active",
  deactivated_at: null,
  created_at: "2026-08-01T09:00:00Z",
  updated_at: "2026-08-01T09:00:00Z",
};

const policy = {
  policy_version: "1.0",
  title: "Facial attendance enrolment notice",
  sections: [{ heading: "What we collect", body: "Encrypted templates only." }],
  retention_days: 365,
};

function stubFetch() {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      calls.push({ url, method, body });
      if (url.includes("/api/privacy/policy")) return Promise.resolve(json(policy));
      if (url.includes("/api/enrollment/1/consent")) {
        return Promise.resolve(
          json({
            status: "granted",
            policy_version: "1.0",
            capture_method: "in_person",
            granted_at: "2026-10-25T10:00:00Z",
            withdrawn_at: null,
          }),
        );
      }
      if (url.includes("/api/enrollment/1")) {
        return Promise.resolve(
          json({
            student_id: 1,
            consent: null,
            template_count: 0,
            model: "SFace",
            model_version: "2021dec",
            enrolled_at: null,
          }),
        );
      }
      if (url.includes("/api/settings/client")) {
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

afterEach(() => vi.restoreAllMocks());

describe("enrolment dialog", () => {
  it("requires the participant notice to be acknowledged before recording consent", async () => {
    const calls = stubFetch();
    render(<EnrollmentDialog open student={student} onClose={() => {}} onChanged={() => {}} />);

    expect(await screen.findByText("Facial attendance enrolment notice")).toBeInTheDocument();
    expect(screen.getByText("Encrypted templates only.")).toBeInTheDocument();

    const continueButton = screen.getByRole("button", { name: /record consent and continue/i });
    expect(continueButton).toBeDisabled();

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox"));
    expect(continueButton).toBeEnabled();

    await user.click(continueButton);

    expect(await screen.findByText(/camera is off/i)).toBeInTheDocument();
    const post = calls.find((call) => call.url.includes("/api/enrollment/1/consent"));
    expect(post?.body).toEqual({ policy_version: "1.0", participant_confirmed: true });
    expect(screen.queryByText(/good sample/i)).not.toBeInTheDocument();
  });
});
