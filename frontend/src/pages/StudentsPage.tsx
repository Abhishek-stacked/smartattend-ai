import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { KeyRound, Pencil, ScanFace, Search, UserCheck, UserPlus, UserX, Users } from "lucide-react";
import { api, ApiError, query } from "../lib/api";
import { cx } from "../lib/format";
import type { Page, ResetLink, Student, StudentDetail } from "../lib/types";
import { useDebounced } from "../hooks/useDebounced";
import { EnrollmentDialog } from "../components/EnrollmentDialog";
import { ResetLinkDialog } from "../components/ResetLinkDialog";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  PasswordField,
  Select,
  Spinner,
  Textarea,
} from "../components/ui";

const PAGE_SIZE = 10;

interface StudentForm {
  registration_number: string;
  full_name: string;
  email: string;
  department: string;
  program: string;
  enrollment_year: string;
  status: Student["status"];
}

const EMPTY_FORM: StudentForm = {
  registration_number: "",
  full_name: "",
  email: "",
  department: "",
  program: "",
  enrollment_year: String(new Date().getFullYear()),
  status: "active",
};

function fromStudent(student: Student): StudentForm {
  return {
    registration_number: student.registration_number,
    full_name: student.full_name,
    email: student.email,
    department: student.department,
    program: student.program,
    enrollment_year: String(student.enrollment_year),
    status: student.status,
  };
}

function StudentFormModal({
  open,
  student,
  onClose,
  onSaved,
}: {
  open: boolean;
  student: Student | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<StudentForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(student ? fromStudent(student) : EMPTY_FORM);
    setError(null);
  }, [open, student]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const department = form.department.trim();
    const program = form.program.trim();
    if (department.length < 2) {
      setError("Enter the department this student belongs to, for example Computer Science.");
      return;
    }
    if (program.length < 2) {
      setError("Enter the programme this student is enrolled in, for example B.Sc. Computer Science.");
      return;
    }
    setBusy(true);
    const payload = {
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      department,
      program,
      enrollment_year: Number(form.enrollment_year),
    };
    try {
      if (student) {
        await api<Student>(`/students/${student.id}`, {
          method: "PATCH",
          body: { ...payload, status: form.status },
        });
      } else {
        await api<Student>("/students", {
          method: "POST",
          body: { ...payload, registration_number: form.registration_number.trim() },
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to save the student.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={student ? "Edit student" : "Register student"}
      description={student ? "Registration number cannot be changed." : "Enroll the student in courses after registering."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="student-form" loading={busy}>
            {student ? "Save changes" : "Register"}
          </Button>
        </>
      }
    >
      <form id="student-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Field
          label="Registration number"
          value={form.registration_number}
          onChange={(e) => setForm({ ...form, registration_number: e.target.value })}
          disabled={student !== null}
          required
        />
        <Field
          label="Full name"
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          required
        />
        <Field
          label="Email address"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Department"
            placeholder="e.g. Computer Science"
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
            required
          />
          <Field
            label="Program"
            placeholder="e.g. B.Sc. Computer Science"
            value={form.program}
            onChange={(e) => setForm({ ...form, program: e.target.value })}
            required
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Enrollment year"
            type="number"
            min={1990}
            max={2100}
            value={form.enrollment_year}
            onChange={(e) => setForm({ ...form, enrollment_year: e.target.value })}
            required
          />
          <Select
            label="Status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as Student["status"] })}
            disabled={!student}
            hint={student ? "Deactivating signs the student out immediately." : undefined}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="graduated">Graduated</option>
            <option value="suspended">Suspended</option>
          </Select>
        </div>
      </form>
    </Modal>
  );
}

export function StudentsPage() {
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const [status, setStatus] = useState<"" | Student["status"]>("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Student> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [enrolling, setEnrolling] = useState<Student | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [deactivating, setDeactivating] = useState<Student | null>(null);
  const [deactivateReason, setDeactivateReason] = useState("");
  const [issued, setIssued] = useState<{ label: string; reset: ResetLink } | null>(null);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [passwordFor, setPasswordFor] = useState<Student | null>(null);
  const [passwordForm, setPasswordForm] = useState({ password: "", confirm: "" });
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api<Page<Student>>(`/students${query({ q, status, page, page_size: PAGE_SIZE })}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Unable to load students.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [q, status, page, refreshKey]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  const openDetail = async (student: { id: number }) => {
    setDetailBusy(true);
    setError(null);
    try {
      setDetail(await api<StudentDetail>(`/students/${student.id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load the student.");
    } finally {
      setDetailBusy(false);
    }
  };

  const refreshAfterEnrolment = (studentId: number) => {
    reload();
    if (detail?.id === studentId) void openDetail({ id: studentId });
  };

  const deactivate = async (event: FormEvent) => {
    event.preventDefault();
    if (!deactivating) return;
    setRowBusy(deactivating.id);
    setError(null);
    try {
      await api<Student>(`/students/${deactivating.id}/deactivate`, {
        method: "POST",
        body: { reason: deactivateReason.trim() },
      });
      setDeactivating(null);
      setDeactivateReason("");
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to deactivate the student.");
    } finally {
      setRowBusy(null);
    }
  };

  const createAccount = async (student: Student) => {
    setRowBusy(student.id);
    setError(null);
    try {
      const res = await api<{ user: { email: string }; reset: ResetLink }>(`/students/${student.id}/account`, {
        method: "POST",
      });
      setIssued({ label: res.user.email, reset: res.reset });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to create the account.");
    } finally {
      setRowBusy(null);
    }
  };

  const openPassword = (student: Student) => {
    setPasswordFor(student);
    setPasswordForm({ password: "", confirm: "" });
    setPasswordError(null);
    setNotice(null);
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!passwordFor) return;
    setPasswordError(null);
    const { password, confirm } = passwordForm;
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setPasswordError("Use at least 10 characters, including a letter and a digit.");
      return;
    }
    if (password !== confirm) {
      setPasswordError("The passwords do not match.");
      return;
    }
    setPasswordBusy(true);
    try {
      const res = await api<{ user: { email: string }; account_created: boolean }>(
        `/students/${passwordFor.id}/password`,
        { method: "POST", body: { password } },
      );
      setNotice(
        res.account_created
          ? `Portal account created for ${passwordFor.full_name} (${res.user.email}) and password set.`
          : `Password updated for ${passwordFor.full_name} (${res.user.email}). Existing sessions were signed out.`,
      );
      setPasswordFor(null);
      setPasswordForm({ password: "", confirm: "" });
      reload();
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : "Unable to set the password.");
    } finally {
      setPasswordBusy(false);
    }
  };

  const total = data?.total ?? 0;
  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Students"
        description="The student register. Attendance history is preserved when a student is deactivated."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <UserPlus aria-hidden className="size-4" /> Register student
          </Button>
        }
      />

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
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
              placeholder="Search name, registration number or email"
              aria-label="Search students"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500"
            />
          </div>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as "" | Student["status"]);
              setPage(1);
            }}
            aria-label="Filter by status"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="graduated">Graduated</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>

        {loading && !data ? (
          <div className="p-10 text-center">
            <Spinner label="Loading students" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={<Users aria-hidden className="size-5" />}
            title="No students match these filters"
            description="Clear the search or register a new student."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <caption className="sr-only">Student register</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Student</th>
                  <th scope="col" className="px-4 py-3 font-medium">Program</th>
                  <th scope="col" className="px-4 py-3 font-medium">Year</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((s) => (
                  <tr key={s.id} className={cx("hover:bg-slate-50/60", s.status !== "active" && "opacity-70")}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{s.full_name}</p>
                      <p className="text-xs text-slate-500">
                        {s.registration_number} · {s.email}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <p>{s.program}</p>
                      <p className="text-xs text-slate-500">{s.department}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{s.enrollment_year}</td>
                    <td className="px-4 py-3">
                      <Badge tone={s.status === "active" ? "success" : s.status === "inactive" ? "danger" : "warning"}>
                        {s.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => openDetail(s)} loading={detailBusy}>
                          View
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditing(s);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil aria-hidden className="size-3.5" /> Edit
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setEnrolling(s)}>
                          <ScanFace aria-hidden className="size-3.5" /> Face
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => openPassword(s)}>
                          <KeyRound aria-hidden className="size-3.5" /> Password
                        </Button>
                        {s.user_id === null ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => createAccount(s)}
                            loading={rowBusy === s.id}
                          >
                            <UserCheck aria-hidden className="size-3.5" /> Account
                          </Button>
                        ) : (
                          <Badge tone="brand">Portal</Badge>
                        )}
                        {s.status === "active" && (
                          <Button size="sm" variant="ghost" onClick={() => setDeactivating(s)}>
                            <UserX aria-hidden className="size-3.5" /> Deactivate
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

      <StudentFormModal open={formOpen} student={editing} onClose={() => setFormOpen(false)} onSaved={reload} />

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? detail.full_name : "Student"}
        description={detail ? `${detail.registration_number} · ${detail.email}` : undefined}
      >
        {detail && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Program</dt>
                <dd className="text-slate-800">{detail.program}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Department</dt>
                <dd className="text-slate-800">{detail.department}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Enrolled</dt>
                <dd className="text-slate-800">{detail.enrollment_year}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Portal account</dt>
                <dd className="text-slate-800">{detail.has_account ? "Active" : "Not created"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Biometric consent</dt>
                <dd className="text-slate-800">{detail.biometric_consented ? "Granted" : "Not granted"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Face templates</dt>
                <dd className="text-slate-800">{detail.template_count}</dd>
              </div>
            </dl>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Active courses</h3>
              {detail.enrollments.length === 0 ? (
                <p className="text-sm text-slate-500">Not enrolled in any course yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {detail.enrollments.map((c) => (
                    <li key={c.course_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span>
                        <span className="font-medium text-slate-800">{c.code}</span> · {c.name}
                      </span>
                      <span className="text-xs text-slate-500">{c.term}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={deactivating !== null}
        onClose={() => setDeactivating(null)}
        title="Deactivate student"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeactivating(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="deactivate-student"
              variant="danger"
              loading={rowBusy === deactivating?.id}
            >
              Deactivate
            </Button>
          </>
        }
      >
        <form id="deactivate-student" onSubmit={deactivate} className="space-y-3">
          <p className="text-sm text-slate-600">
            {deactivating?.full_name} loses portal access immediately. Attendance history and course enrollments are
            preserved.
          </p>
          <Textarea
            label="Reason"
            value={deactivateReason}
            onChange={(e) => setDeactivateReason(e.target.value)}
            required
            minLength={3}
            hint="Stored in the audit log."
          />
        </form>
      </Modal>

      <EnrollmentDialog
        open={enrolling !== null}
        student={enrolling}
        onClose={() => setEnrolling(null)}
        onChanged={() => {
          if (enrolling) refreshAfterEnrolment(enrolling.id);
        }}
      />

      <Modal
        open={passwordFor !== null}
        onClose={() => setPasswordFor(null)}
        title="Set portal password"
        description={passwordFor ? `${passwordFor.full_name} · ${passwordFor.email}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPasswordFor(null)}>
              Cancel
            </Button>
            <Button type="submit" form="student-password-form" loading={passwordBusy}>
              Save password
            </Button>
          </>
        }
      >
        <form id="student-password-form" onSubmit={savePassword} className="space-y-3" noValidate>
          {passwordError && <Alert tone="error">{passwordError}</Alert>}
          <p className="text-sm text-slate-600">
            {passwordFor?.user_id === null
              ? "This creates the student's portal account and sets the password. No reset link is needed."
              : "This replaces the current password and signs out any existing sessions. Outstanding reset links are cancelled."}
          </p>
          <PasswordField
            label="New password"
            autoComplete="new-password"
            value={passwordForm.password}
            onChange={(e) => setPasswordForm({ ...passwordForm, password: e.target.value })}
            required
            hint="At least 10 characters, including a letter and a digit."
          />
          <PasswordField
            label="Confirm password"
            autoComplete="new-password"
            value={passwordForm.confirm}
            onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
            required
          />
        </form>
      </Modal>

      <ResetLinkDialog
        label={issued?.label ?? null}
        reset={issued?.reset ?? null}
        onClose={() => setIssued(null)}
      />
    </div>
  );
}
