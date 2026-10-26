import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, CalendarPlus, Pencil, Plus, Search, UserMinus, Users } from "lucide-react";
import { api, ApiError, query } from "../lib/api";
import { cx } from "../lib/format";
import type { AttendanceSession, Course, Faculty, Page, RosterStudent, Student } from "../lib/types";
import { useAuth } from "../context/AuthContext";
import { useDebounced } from "../hooks/useDebounced";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "../components/ui";

const PAGE_SIZE = 10;

function todayLocal(): string {
  return new Date().toLocaleDateString("en-CA");
}

function localToIso(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

interface CourseForm {
  code: string;
  name: string;
  department: string;
  term: string;
  faculty_id: string;
  status: Course["status"];
}

const EMPTY_FORM: CourseForm = {
  code: "",
  name: "",
  department: "",
  term: "2026-27 Odd",
  faculty_id: "",
  status: "active",
};

function CourseFormModal({
  open,
  course,
  onClose,
  onSaved,
}: {
  open: boolean;
  course: Course | null;
  onClose: () => void;
  onSaved: (course: Course, created: boolean) => void;
}) {
  const [form, setForm] = useState<CourseForm>(EMPTY_FORM);
  const [facultyOptions, setFacultyOptions] = useState<Faculty[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      course
        ? {
            code: course.code,
            name: course.name,
            department: course.department,
            term: course.term,
            faculty_id: course.faculty_id ? String(course.faculty_id) : "",
            status: course.status,
          }
        : EMPTY_FORM,
    );
    setError(null);
    api<Page<Faculty>>(`/faculty${query({ status: "active", page_size: 100 })}`)
      .then((result) => setFacultyOptions(result.items))
      .catch(() => setFacultyOptions([]));
  }, [open, course]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const department = form.department.trim();
    const term = form.term.trim();
    if (department.length < 2) {
      setError("Enter the department this course belongs to, for example Computer Science.");
      return;
    }
    if (term.length < 2) {
      setError("Enter the term this course runs in, for example 2026-27 Odd.");
      return;
    }
    setBusy(true);
    const payload = {
      name: form.name.trim(),
      department,
      term,
      faculty_id: form.faculty_id ? Number(form.faculty_id) : null,
    };
    try {
      let saved: Course;
      if (course) {
        saved = await api<Course>(`/courses/${course.id}`, {
          method: "PATCH",
          body: { ...payload, status: form.status },
        });
      } else {
        saved = await api<Course>("/courses", { method: "POST", body: { ...payload, code: form.code.trim() } });
      }
      onSaved(saved, course === null);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to save the course.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={course ? "Edit course" : "Create course"}
      description="Create the course, add students on its roster, then schedule the first class."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="course-form" loading={busy}>
            {course ? "Save changes" : "Create course"}
          </Button>
        </>
      }
    >
      <form id="course-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Course code"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            disabled={course !== null}
            required
          />
          <Field label="Term" value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} required />
        </div>
        <Field label="Course name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Field
          label="Department"
          placeholder="e.g. Computer Science"
          value={form.department}
          onChange={(e) => setForm({ ...form, department: e.target.value })}
          required
        />
        <Select
          label="Faculty"
          value={form.faculty_id}
          onChange={(e) => setForm({ ...form, faculty_id: e.target.value })}
          required
          hint="Faculty can only see and manage their own courses."
        >
          <option value="">Select a faculty member</option>
          {facultyOptions.map((f) => (
            <option key={f.id} value={f.id}>
              {f.full_name} ({f.department})
            </option>
          ))}
        </Select>
        {course && (
          <Select
            label="Status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as Course["status"] })}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </Select>
        )}
      </form>
    </Modal>
  );
}

function RosterModal({
  course,
  canManage,
  onClose,
  onChanged,
  onSchedule,
}: {
  course: Course | null;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
  onSchedule: (course: Course) => void;
}) {
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [studentQuery, setStudentQuery] = useState("");
  const q = useDebounced(studentQuery, 300);
  const [candidates, setCandidates] = useState<Student[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  const loadRoster = useCallback(async (courseId: number) => {
    setLoading(true);
    try {
      const result = await api<Page<RosterStudent>>(`/courses/${courseId}/enrollments${query({ page_size: 100 })}`);
      setRoster(result.items);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load the roster.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!course) return;
    setStudentQuery("");
    setCandidates([]);
    void loadRoster(course.id);
  }, [course, loadRoster]);

  useEffect(() => {
    if (!course || !q) {
      setCandidates([]);
      return;
    }
    const controller = new AbortController();
    api<Page<Student>>(`/students${query({ q, status: "active", page_size: 8 })}`, { signal: controller.signal })
      .then((result) => setCandidates(result.items))
      .catch(() => setCandidates([]));
    return () => controller.abort();
  }, [course, q]);

  if (!course) return null;

  const enrolledIds = new Set(roster.map((r) => r.student_id));

  const enroll = async (student: Student) => {
    setBusy(student.id);
    setError(null);
    try {
      await api(`/courses/${course.id}/enrollments`, { method: "POST", body: { student_ids: [student.id] } });
      setStudentQuery("");
      setCandidates([]);
      await loadRoster(course.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to enroll the student.");
    } finally {
      setBusy(null);
    }
  };

  const drop = async (studentId: number) => {
    setBusy(studentId);
    setError(null);
    try {
      await api(`/courses/${course.id}/enrollments/${studentId}`, { method: "DELETE" });
      await loadRoster(course.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to remove the student.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${course.code} roster`}
      description={`${course.name} · ${roster.length} enrolled`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => onSchedule(course)}>
            <CalendarPlus aria-hidden className="size-4" /> Schedule class
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {canManage && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
                placeholder="Search active students to enroll"
                aria-label="Search students to enroll"
                className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500"
              />
            </div>
            {candidates.length > 0 && (
              <ul className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                {candidates.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium text-slate-800">{s.full_name}</span>{" "}
                      <span className="text-xs text-slate-500">{s.registration_number}</span>
                    </span>
                    {enrolledIds.has(s.id) ? (
                      <Badge tone="neutral">Enrolled</Badge>
                    ) : (
                      <Button size="sm" variant="secondary" loading={busy === s.id} onClick={() => enroll(s)}>
                        <Plus aria-hidden className="size-3.5" /> Add
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {loading ? (
          <div className="py-6 text-center">
            <Spinner label="Loading roster" />
          </div>
        ) : roster.length === 0 ? (
          <EmptyState
            icon={<Users aria-hidden className="size-5" />}
            title="No students enrolled"
            description={canManage ? "Search above to add students." : "The administrator has not enrolled anyone yet."}
          />
        ) : (
          <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Course roster</caption>
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Student</th>
                  <th scope="col" className="px-3 py-2 font-medium">Biometrics</th>
                  {canManage && <th scope="col" className="px-3 py-2 text-right font-medium">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {roster.map((r) => (
                  <tr key={r.student_id}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{r.full_name}</p>
                      <p className="text-xs text-slate-500">{r.registration_number}</p>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={r.biometric_enrolled ? "success" : "neutral"}>
                        {r.biometric_enrolled ? "Enrolled" : "Not enrolled"}
                      </Badge>
                    </td>
                    {canManage && (
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={busy === r.student_id}
                          onClick={() => drop(r.student_id)}
                        >
                          <UserMinus aria-hidden className="size-3.5" /> Remove
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ScheduleClassModal({
  course,
  onClose,
  onScheduled,
}: {
  course: Course | null;
  onClose: () => void;
  onScheduled: (session: AttendanceSession) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!course) return;
    setTitle(`${course.code} lecture`);
    setDate(todayLocal());
    setStart("09:00");
    setEnd("10:00");
    setError(null);
  }, [course]);

  if (!course) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (title.trim().length < 2) {
      setError("Give the class a short title.");
      return;
    }
    if (new Date(localToIso(date, end)) <= new Date(localToIso(date, start))) {
      setError("The class must end after it starts.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api<AttendanceSession>("/sessions", {
        method: "POST",
        body: {
          course_id: course.id,
          title: title.trim(),
          scheduled_start: localToIso(date, start),
          scheduled_end: localToIso(date, end),
        },
      });
      onScheduled(created);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to schedule the class.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Schedule class"
      description={`${course.code} · ${course.name}${course.faculty_name ? ` · ${course.faculty_name}` : ""}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="schedule-class-form" loading={busy}>
            <CalendarPlus aria-hidden className="size-4" /> Schedule
          </Button>
        </>
      }
    >
      <form id="schedule-class-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Field
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Lecture 1 - Introduction"
          required
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          <Field label="Starts" type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
          <Field label="Ends" type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </div>
        <p className="text-sm text-slate-500">
          Every student currently on this roster is included. Students added later join this class automatically.
        </p>
      </form>
    </Modal>
  );
}

export function CoursesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const [status, setStatus] = useState<"" | Course["status"]>("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Course> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);
  const [rosterCourse, setRosterCourse] = useState<Course | null>(null);
  const [scheduleCourse, setScheduleCourse] = useState<Course | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api<Page<Course>>(`/courses${query({ q, status, page, page_size: PAGE_SIZE })}`, { signal: controller.signal })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Unable to load courses.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [q, status, page, refreshKey]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  const handleCourseSaved = (saved: Course, created: boolean) => {
    reload();
    if (created) setRosterCourse(saved);
  };

  const scheduleFromRoster = (course: Course) => {
    setRosterCourse(null);
    setScheduleCourse(course);
  };

  const handleScheduled = (session: AttendanceSession) => {
    reload();
    navigate(`/sessions/${session.id}`);
  };

  const total = data?.total ?? 0;
  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Courses"
        description={
          isAdmin
            ? "Course register, faculty assignment and enrolled rosters."
            : "Your assigned courses and their rosters."
        }
        actions={
          isAdmin ? (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus aria-hidden className="size-4" /> Create course
            </Button>
          ) : undefined
        }
      />

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
          <div className="relative min-w-56 flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search code or name"
              aria-label="Search courses"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500"
            />
          </div>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as "" | Course["status"]);
              setPage(1);
            }}
            aria-label="Filter by status"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {loading && !data ? (
          <div className="p-10 text-center">
            <Spinner label="Loading courses" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={<BookOpen aria-hidden className="size-5" />}
            title="No courses found"
            description={isAdmin ? "Create a course and assign a faculty member." : "No courses are assigned to you."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <caption className="sr-only">Courses</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Course</th>
                  <th scope="col" className="px-4 py-3 font-medium">Faculty</th>
                  <th scope="col" className="px-4 py-3 font-medium">Students</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((c) => (
                  <tr key={c.id} className={cx("hover:bg-slate-50/60", c.status !== "active" && "opacity-70")}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">
                        {c.code} · {c.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {c.department} · {c.term}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.faculty_name ?? "Unassigned"}</td>
                    <td className="px-4 py-3 text-slate-600">{c.student_count}</td>
                    <td className="px-4 py-3">
                      <Badge tone={c.status === "active" ? "success" : "neutral"}>{c.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setScheduleCourse(c)}>
                          <CalendarPlus aria-hidden className="size-3.5" /> Schedule
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setRosterCourse(c)}>
                          <Users aria-hidden className="size-3.5" /> Roster
                        </Button>
                        {isAdmin && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setEditing(c);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil aria-hidden className="size-3.5" /> Edit
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
          <span>
            Showing {start}–{end} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="text-xs">
              Page {page} of {lastPage}
            </span>
            <Button size="sm" variant="secondary" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      </Card>

      {isAdmin && (
        <CourseFormModal open={formOpen} course={editing} onClose={() => setFormOpen(false)} onSaved={handleCourseSaved} />
      )}

      <RosterModal
        course={rosterCourse}
        canManage={isAdmin}
        onClose={() => setRosterCourse(null)}
        onChanged={reload}
        onSchedule={scheduleFromRoster}
      />

      <ScheduleClassModal
        course={scheduleCourse}
        onClose={() => setScheduleCourse(null)}
        onScheduled={handleScheduled}
      />
    </div>
  );
}
