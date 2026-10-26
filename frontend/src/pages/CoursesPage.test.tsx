import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { CoursesPage } from "./CoursesPage";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, page_size: 100 });

const admin = {
  id: 1,
  email: "abhishek.mishra@admin.edu",
  full_name: "Abhishek Mishra",
  role: "admin",
  student_id: null,
  faculty_id: null,
  last_login_at: null,
};

const faculty = {
  id: 3,
  employee_id: "FAC-CS-001",
  full_name: "Meera Iyer",
  email: "meera.iyer@niet.edu",
  department: "Computer Science",
  designation: "Associate Professor",
  status: "active",
  course_count: 0,
  created_at: "2026-10-01T08:00:00Z",
};

const course = {
  id: 9,
  code: "CS401",
  name: "Machine Learning",
  department: "Computer Science",
  term: "2026-27 Odd",
  faculty_id: faculty.id,
  faculty_name: faculty.full_name,
  status: "active",
  student_count: 0,
  created_at: "2026-10-26T08:00:00Z",
};

const student = {
  id: 5,
  registration_number: "AIML-0005",
  full_name: "Abhishek Mishra",
  email: "abhishek.mishra@niet.edu",
  department: "Artificial Intelligence",
  program: "B.Tech AIML",
  enrollment_year: 2022,
  status: "active",
  has_account: true,
  biometric_consented: true,
  biometric_enrolled: true,
  created_at: "2026-10-01T08:00:00Z",
};

const rosterStudent = {
  student_id: student.id,
  registration_number: student.registration_number,
  full_name: student.full_name,
  email: student.email,
  department: student.department,
  status: "active",
  enrolled_at: "2026-10-26T08:10:00Z",
  biometric_enrolled: true,
};

let enrolled = false;
let sessionBody: Record<string, unknown> | null = null;

function stubFetch() {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/auth/me")) return Promise.resolve(json(admin));
    if (url.includes("/api/faculty")) return Promise.resolve(json(page([faculty])));
    if (url.includes("/api/students?")) return Promise.resolve(json(page([student])));
    if (url.includes("/api/courses/9/enrollments")) {
      if (method === "POST") {
        enrolled = true;
        return Promise.resolve(json({ items: [rosterStudent], added: 1, already_enrolled: 0, skipped_inactive: 0 }));
      }
      return Promise.resolve(json(page(enrolled ? [rosterStudent] : [])));
    }
    if (method === "POST" && url.endsWith("/api/sessions")) {
      sessionBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(json({ id: 5 }, 201));
    }
    if (method === "POST" && url.endsWith("/api/courses")) return Promise.resolve(json(course, 201));
    if (url.includes("/api/courses")) return Promise.resolve(json(page([])));
    return Promise.resolve(json({ error: { code: "not_found", message: "Not found" } }, 404));
  });
  vi.stubGlobal("fetch", mock);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/courses"]}>
      <AuthProvider>
        <Routes>
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/sessions/:id" element={<p>Scheduled session page</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  enrolled = false;
  sessionBody = null;
});

describe("courses page", () => {
  it("creates a course, adds a student, and schedules a class", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /create course/i }));
    const form = screen.getByRole("dialog");
    await user.type(within(form).getByLabelText(/course code/i), "CS401");
    await user.type(within(form).getByLabelText(/course name/i), "Machine Learning");
    await user.type(within(form).getByLabelText(/department/i), "Computer Science");
    const facultySelect = within(form).getByLabelText(/^faculty/i);
    await within(form).findByRole("option", { name: /meera iyer/i });
    await user.selectOptions(facultySelect, String(faculty.id));
    await user.click(within(form).getByRole("button", { name: /create course/i }));

    expect(await screen.findByText("CS401 roster")).toBeInTheDocument();
    expect(await screen.findByText(/no students enrolled/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/search students to enroll/i), "abhishek");
    const add = await screen.findByRole("button", { name: /add/i });
    await user.click(add);

    const roster = await screen.findByRole("dialog");
    expect(await within(roster).findByText("AIML-0005")).toBeInTheDocument();

    await user.click(within(roster).getByRole("button", { name: /schedule class/i }));
    const schedule = await screen.findByRole("dialog");
    expect(within(schedule).getByDisplayValue("CS401 lecture")).toBeInTheDocument();
    await user.click(within(schedule).getByRole("button", { name: /^schedule$/i }));

    expect(await screen.findByText("Scheduled session page")).toBeInTheDocument();
    expect(sessionBody).toMatchObject({ course_id: 9, title: "CS401 lecture" });
  });

  it("asks the admin to type the department instead of assuming one", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /create course/i }));
    const form = screen.getByRole("dialog");
    await user.type(within(form).getByLabelText(/course code/i), "CS401");
    await user.type(within(form).getByLabelText(/course name/i), "Machine Learning");
    await user.click(within(form).getByRole("button", { name: /create course/i }));

    expect(await within(form).findByText(/enter the department/i)).toBeInTheDocument();
    expect(within(form).getByLabelText(/department/i)).toHaveValue("");
  });
});
