import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewPage } from "./ReviewPage";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const event = {
  id: 11,
  occurred_at: "2026-10-25T09:04:00Z",
  outcome: "liveness_failed",
  review_status: "pending",
  session_id: 4,
  session_title: "Lecture 3",
  course_id: 1,
  course_code: "CS301",
  course_name: "Database Systems",
  student_id: 7,
  student_name: "Asha Rao",
  registration_number: "CS21-001",
  similarity: 0.81,
  second_similarity: 0.22,
  threshold_used: 0.42,
  liveness_status: "failed",
  liveness_score: 0.094,
  liveness_model: "MiniFASNetV2",
  quality: null,
  error_code: "liveness_failed",
  reviewed_at: null,
  review_note: null,
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
      if (url.includes("/api/recognition/events/11/resolve")) {
        return Promise.resolve(json({ event_id: 11, review_status: "resolved", record_id: 21, record_status: "late" }));
      }
      if (url.includes("/api/recognition/events?")) {
        return Promise.resolve(json({ items: [event], total: 1, page: 1, page_size: 20 }));
      }
      return Promise.resolve(json({ error: { code: "not_found", message: "Not found" } }, 404));
    }),
  );
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe("recognition review page", () => {
  it("loads the pending queue and shows the liveness verdict", async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <ReviewPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("Liveness: Failed")).toBeInTheDocument();
    expect(screen.getByText("Liveness failed", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/0\.094/)).toBeInTheDocument();
  });

  it("requires a note and resolves the event as late", async () => {
    const calls = stubFetch();
    render(
      <MemoryRouter>
        <ReviewPage />
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Resolve" }));
    await user.selectOptions(screen.getByLabelText("Decision"), "mark_late");
    await user.type(screen.getByLabelText(/review note/i), "Matched student ID in person");
    await user.click(screen.getByRole("button", { name: "Save decision" }));

    expect(await screen.findByText(/marked late/i)).toBeInTheDocument();
    const post = calls.find((call) => call.url.includes("/api/recognition/events/11/resolve"));
    expect(post?.method).toBe("POST");
    expect(post?.body).toEqual({ action: "mark_late", note: "Matched student ID in person" });
  });
});
