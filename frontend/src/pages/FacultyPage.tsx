import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { GraduationCap, Pencil, Search, UserCheck, UserPlus, UserX } from "lucide-react";
import { api, ApiError, query } from "../lib/api";
import { cx } from "../lib/format";
import type { Faculty, FacultyDetail, Page, ResetLink } from "../lib/types";
import { useDebounced } from "../hooks/useDebounced";
import { ResetLinkDialog } from "../components/ResetLinkDialog";
import { Alert, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Select, Spinner } from "../components/ui";

const PAGE_SIZE = 10;

interface FacultyForm {
  employee_id: string;
  full_name: string;
  email: string;
  department: string;
  designation: string;
  status: Faculty["status"];
}

const EMPTY_FORM: FacultyForm = {
  employee_id: "",
  full_name: "",
  email: "",
  department: "",
  designation: "Lecturer",
  status: "active",
};

function fromFaculty(faculty: Faculty): FacultyForm {
  return {
    employee_id: faculty.employee_id,
    full_name: faculty.full_name,
    email: faculty.email,
    department: faculty.department,
    designation: faculty.designation,
    status: faculty.status,
  };
}

function FacultyFormModal({
  open,
  faculty,
  onClose,
  onSaved,
}: {
  open: boolean;
  faculty: Faculty | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FacultyForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(faculty ? fromFaculty(faculty) : EMPTY_FORM);
    setError(null);
  }, [open, faculty]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const department = form.department.trim();
    if (department.length < 2) {
      setError("Enter the department this faculty member belongs to, for example Computer Science.");
      return;
    }
    setBusy(true);
    const payload = {
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      department,
      designation: form.designation.trim(),
    };
    try {
      if (faculty) {
        await api<Faculty>(`/faculty/${faculty.id}`, {
          method: "PATCH",
          body: { ...payload, status: form.status },
        });
      } else {
        await api<Faculty>("/faculty", {
          method: "POST",
          body: { ...payload, employee_id: form.employee_id.trim() },
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to save the faculty member.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={faculty ? "Edit faculty member" : "Add faculty member"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="faculty-form" loading={busy}>
            {faculty ? "Save changes" : "Add faculty"}
          </Button>
        </>
      }
    >
      <form id="faculty-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Field
          label="Employee ID"
          value={form.employee_id}
          onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
          disabled={faculty !== null}
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
            label="Designation"
            value={form.designation}
            onChange={(e) => setForm({ ...form, designation: e.target.value })}
            required
          />
        </div>
        <Select
          label="Status"
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value as Faculty["status"] })}
          disabled={!faculty}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
      </form>
    </Modal>
  );
}

export function FacultyPage() {
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const [status, setStatus] = useState<"" | Faculty["status"]>("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Faculty> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Faculty | null>(null);
  const [detail, setDetail] = useState<FacultyDetail | null>(null);
  const [deactivating, setDeactivating] = useState<Faculty | null>(null);
  const [issued, setIssued] = useState<{ label: string; reset: ResetLink } | null>(null);
  const [rowBusy, setRowBusy] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api<Page<Faculty>>(`/faculty${query({ q, status, page, page_size: PAGE_SIZE })}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Unable to load faculty.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [q, status, page, refreshKey]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  const openDetail = async (faculty: Faculty) => {
    setError(null);
    try {
      setDetail(await api<FacultyDetail>(`/faculty/${faculty.id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load the faculty member.");
    }
  };

  const setActive = async (faculty: Faculty, active: boolean) => {
    setRowBusy(faculty.id);
    setError(null);
    try {
      if (active) {
        await api<Faculty>(`/faculty/${faculty.id}`, { method: "PATCH", body: { status: "active" } });
      } else {
        await api<Faculty>(`/faculty/${faculty.id}/deactivate`, {
          method: "POST",
          body: { reason: "Deactivated from the faculty register" },
        });
      }
      setDeactivating(null);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to update the faculty member.");
    } finally {
      setRowBusy(null);
    }
  };

  const createAccount = async (faculty: Faculty) => {
    setRowBusy(faculty.id);
    setError(null);
    try {
      const res = await api<{ user: { email: string }; reset: ResetLink }>(`/faculty/${faculty.id}/account`, {
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

  const total = data?.total ?? 0;
  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Faculty"
        description="Teaching staff, their portal accounts and course assignments."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <UserPlus aria-hidden className="size-4" /> Add faculty
          </Button>
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
              placeholder="Search name, employee ID or email"
              aria-label="Search faculty"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500"
            />
          </div>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as "" | Faculty["status"]);
              setPage(1);
            }}
            aria-label="Filter by status"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {loading && !data ? (
          <div className="p-10 text-center">
            <Spinner label="Loading faculty" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={<GraduationCap aria-hidden className="size-5" />}
            title="No faculty match these filters"
            description="Add a faculty member to assign them to courses."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <caption className="sr-only">Faculty register</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Faculty</th>
                  <th scope="col" className="px-4 py-3 font-medium">Department</th>
                  <th scope="col" className="px-4 py-3 font-medium">Designation</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((f) => (
                  <tr key={f.id} className={cx("hover:bg-slate-50/60", f.status !== "active" && "opacity-70")}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{f.full_name}</p>
                      <p className="text-xs text-slate-500">
                        {f.employee_id} · {f.email}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{f.department}</td>
                    <td className="px-4 py-3 text-slate-600">{f.designation}</td>
                    <td className="px-4 py-3">
                      <Badge tone={f.status === "active" ? "success" : "danger"}>{f.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => openDetail(f)}>
                          View
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditing(f);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil aria-hidden className="size-3.5" /> Edit
                        </Button>
                        {f.user_id === null ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => createAccount(f)}
                            loading={rowBusy === f.id}
                          >
                            <UserCheck aria-hidden className="size-3.5" /> Account
                          </Button>
                        ) : (
                          <Badge tone="brand">Portal</Badge>
                        )}
                        <Button
                          size="sm"
                          variant={f.status === "active" ? "ghost" : "secondary"}
                          onClick={() => (f.status === "active" ? setDeactivating(f) : setActive(f, true))}
                          loading={rowBusy === f.id}
                        >
                          {f.status === "active" ? (
                            <>
                              <UserX aria-hidden className="size-3.5" /> Deactivate
                            </>
                          ) : (
                            "Reactivate"
                          )}
                        </Button>
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

      <FacultyFormModal open={formOpen} faculty={editing} onClose={() => setFormOpen(false)} onSaved={reload} />

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? detail.full_name : "Faculty member"}
        description={detail ? `${detail.employee_id} · ${detail.email}` : undefined}
      >
        {detail && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Department</dt>
                <dd className="text-slate-800">{detail.department}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Designation</dt>
                <dd className="text-slate-800">{detail.designation}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Portal account</dt>
                <dd className="text-slate-800">{detail.has_account ? "Active" : "Not created"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Status</dt>
                <dd className="text-slate-800">{detail.status}</dd>
              </div>
            </dl>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Courses</h3>
              {detail.courses.length === 0 ? (
                <p className="text-sm text-slate-500">No courses assigned yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {detail.courses.map((c) => (
                    <li key={c.course_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span>
                        <span className="font-medium text-slate-800">{c.code}</span> · {c.name}
                      </span>
                      <span className="text-xs text-slate-500">
                        {c.student_count} students · {c.term}
                      </span>
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
        title="Deactivate faculty member"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeactivating(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={rowBusy === deactivating?.id}
              onClick={() => deactivating && setActive(deactivating, false)}
            >
              Deactivate
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          {deactivating?.full_name} will be signed out and cannot access the portal. Existing courses keep their
          records; reassign them before the next session.
        </p>
      </Modal>

      <ResetLinkDialog label={issued?.label ?? null} reset={issued?.reset ?? null} onClose={() => setIssued(null)} />
    </div>
  );
}
