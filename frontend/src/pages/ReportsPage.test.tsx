import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ReportsPage } from "./ReportsPage";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const report = {
  type: "daily",
  columns: [
    { key: "date", label: "Date", align: "left" },
    { key: "present", label: "Present", align: "right" },
    { key: "late", label: "Late", align: "right" },
    { key: "total", label: "Total", align: "right" },
    { key: "rate", label: "Attendance %", align: "right" },
  ],
  rows: [{ date: "2026-10-20", present: 4, late: 1, absent: 1, total: 6, rate: 83.3 }],
  total: 60,
  page: 1,
  page_size: 25,
  date_from: null,
  date_to: null,
  summary: { present: 4, late: 1, absent: 1, total: 6, records: 6, rate: 83.3 },
};

const courses = {
  items: [{ id: 1, code: "CS301", name: "Database Systems" }],
  total: 1,
  page: 1,
  page_size: 100,
};

let calls: string[] = [];

function stubFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/api/courses")) return Promise.resolve(json(courses));
      if (url.includes("/api/reports/export")) {
        return Promise.resolve(
          new Response("Date,Present\r\n2026-10-20,4\r\n", {
            status: 200,
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": 'attachment; filename="smartattend-daily-2026-10-25.csv"',
            },
          }),
        );
      }
      if (url.includes("/api/reports/attendance")) return Promise.resolve(json(report));
      return Promise.resolve(json({ error: { code: "not_found", message: "Not found" } }, 404));
    }),
  );
}

beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:report"), writable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), writable: true });
  HTMLAnchorElement.prototype.click = vi.fn();
});

afterEach(() => vi.restoreAllMocks());

describe("reports page", () => {
  it("renders the report table with formatted metrics", async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("2026-10-20")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Attendance %" })).toBeInTheDocument();
    expect(screen.getByText("83.3%")).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
    expect(calls.some((url) => url.includes("type=daily") && url.includes("page_size=25"))).toBe(true);
  });

  it("refetches when the report type changes and downloads an export", async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>,
    );
    const user = userEvent.setup();

    await screen.findByText("2026-10-20");
    await user.selectOptions(screen.getByLabelText("Report type"), "absence");
    await waitFor(() => expect(calls.some((url) => url.includes("type=absence"))).toBe(true));

    await user.click(screen.getByRole("button", { name: /CSV/ }));
    expect(
      await screen.findByText("Downloaded smartattend-daily-2026-10-25.csv."),
    ).toBeInTheDocument();
    expect(calls.some((url) => url.includes("/api/reports/export") && url.includes("fmt=csv"))).toBe(true);
  });

  it("blocks an inverted date range before calling the API", async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>,
    );

    await screen.findByText("2026-10-20");
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-10-30" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-10-01" } });

    expect(await screen.findByText(/start date must be on or before the end date/i)).toBeInTheDocument();
    expect(
      calls.some((url) => url.includes("date_from=2026-10-30") && url.includes("date_to=2026-10-01")),
    ).toBe(false);
  });
});
