import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Check, Copy, KeyRound, LockKeyhole, Search, UserPlus, Users } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, ApiError, query } from "../lib/api";
import { formatDateTime, roleLabel, cx } from "../lib/format";
import type { AdminUser, Page, ResetLink, Role } from "../lib/types";
import { useDebounced } from "../hooks/useDebounced";
import { Alert, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, PasswordField, Spinner } from "../components/ui";

const PAGE_SIZE = 10;

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Button size="sm" variant="secondary" onClick={copy} className="shrink-0">
      {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function AdminUsersPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const [role, setRole] = useState<"" | Role>("");
  const [status, setStatus] = useState<"" | "true" | "false">("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<AdminUser> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [issued, setIssued] = useState<{ label: string; reset: ResetLink } | null>(null);

  const [confirmDeactivate, setConfirmDeactivate] = useState<AdminUser | null>(null);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [passwordFor, setPasswordFor] = useState<AdminUser | null>(null);
  const [passwordForm, setPasswordForm] = useState({ password: "", confirm: "" });
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api<Page<AdminUser>>(`/users${query({ q, role, is_active: status, page, page_size: PAGE_SIZE })}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof ApiError ? err.message : "Unable to load accounts.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [q, role, status, page, refreshKey]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  const createAccount = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await api<{ user: AdminUser; reset: ResetLink }>("/users", {
        method: "POST",
        body: { email: form.email.trim(), full_name: form.full_name.trim(), role: "admin" },
      });
      setIssued({ label: res.user.email, reset: res.reset });
      setForm({ full_name: "", email: "" });
      setCreateOpen(false);
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Unable to create the account.");
    } finally {
      setSubmitting(false);
    }
  };

  const issueReset = async (user: AdminUser) => {
    setRowBusy(user.id);
    setError(null);
    try {
      const reset = await api<ResetLink>(`/users/${user.id}/reset-link`, { method: "POST" });
      setIssued({ label: user.email, reset });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to issue a reset link.");
    } finally {
      setRowBusy(null);
    }
  };

  const setActive = async (user: AdminUser, isActive: boolean) => {
    setRowBusy(user.id);
    setError(null);
    try {
      await api<AdminUser>(`/users/${user.id}`, { method: "PATCH", body: { is_active: isActive } });
      setConfirmDeactivate(null);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to update the account.");
    } finally {
      setRowBusy(null);
    }
  };

  const unlock = async (user: AdminUser) => {
    setRowBusy(user.id);
    setError(null);
    try {
      await api<AdminUser>(`/users/${user.id}`, { method: "PATCH", body: { unlock: true } });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to unlock the account.");
    } finally {
      setRowBusy(null);
    }
  };

  const openPassword = (user: AdminUser) => {
    setPasswordFor(user);
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
      await api(`/users/${passwordFor.id}/password`, { method: "POST", body: { password } });
      setNotice(`Password updated for ${passwordFor.full_name} (${passwordFor.email}). Existing sessions were signed out.`);
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
        title="User accounts"
        description="All sign-in accounts. Set a password directly or issue a one-time reset link."
        actions={
          user?.can_create_admins ? (
            <Button onClick={() => setCreateOpen(true)}>
              <UserPlus aria-hidden className="size-4" /> Add administrator
            </Button>
          ) : undefined
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
              placeholder="Search name or email"
              aria-label="Search accounts"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500"
            />
          </div>
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value as "" | Role);
              setPage(1);
            }}
            aria-label="Filter by role"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
          >
            <option value="">All roles</option>
            <option value="admin">Admin</option>
            <option value="faculty">Faculty</option>
            <option value="student">Student</option>
          </select>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as "" | "true" | "false");
              setPage(1);
            }}
            aria-label="Filter by status"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm"
          >
            <option value="">Any status</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>

        {loading && !data ? (
          <div className="p-10 text-center">
            <Spinner label="Loading accounts" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={<Users aria-hidden className="size-5" />}
            title="No accounts match these filters"
            description="Try clearing the search or choosing a different role."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <caption className="sr-only">User accounts</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Account</th>
                  <th scope="col" className="px-4 py-3 font-medium">Role</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Last sign-in</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((u) => (
                  <tr key={u.id} className={cx("hover:bg-slate-50/60", !u.is_active && "opacity-70")}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{u.full_name}</p>
                      <p className="text-xs text-slate-500">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={u.role === "admin" ? "brand" : u.role === "faculty" ? "info" : "neutral"}>
                        {roleLabel(u.role)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {u.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Inactive</Badge>}
                        {u.locked && (
                          <Badge tone="warning">
                            <LockKeyhole aria-hidden className="size-3" /> Locked
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(u.last_login_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {u.locked && (
                          <Button size="sm" variant="secondary" onClick={() => unlock(u)} loading={rowBusy === u.id}>
                            Unlock
                          </Button>
                        )}
                        <Button size="sm" variant="secondary" onClick={() => openPassword(u)}>
                          <LockKeyhole aria-hidden className="size-3.5" /> Password
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => issueReset(u)} loading={rowBusy === u.id}>
                          <KeyRound aria-hidden className="size-3.5" /> Reset link
                        </Button>
                        <Button
                          size="sm"
                          variant={u.is_active ? "ghost" : "secondary"}
                          onClick={() => (u.is_active ? setConfirmDeactivate(u) : setActive(u, true))}
                          loading={rowBusy === u.id}
                        >
                          {u.is_active ? "Deactivate" : "Reactivate"}
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

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add administrator"
        description="The account is created without a password. Share the one-time link so they can set one."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="create-admin-form" loading={submitting}>
              Create account
            </Button>
          </>
        }
      >
        <form id="create-admin-form" onSubmit={createAccount} className="space-y-4" noValidate>
          {formError && <Alert tone="error">{formError}</Alert>}
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
        </form>
      </Modal>

      <Modal
        open={issued !== null}
        onClose={() => setIssued(null)}
        title="Password reset link"
        footer={
          <Button variant="secondary" onClick={() => setIssued(null)}>
            Done
          </Button>
        }
      >
        {issued && (
          <div className="space-y-3">
            <Alert tone="warning" title="Shown only once">
              Share this link privately with {issued.label}. It works a single time and expires{" "}
              {formatDateTime(issued.reset.expires_at)}. Issuing another link cancels this one.
            </Alert>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
              <code className="min-w-0 flex-1 break-all text-xs text-slate-700">{issued.reset.reset_url}</code>
              <CopyButton value={issued.reset.reset_url} />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={passwordFor !== null}
        onClose={() => setPasswordFor(null)}
        title="Set password"
        description={passwordFor ? `${passwordFor.full_name} · ${passwordFor.email}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPasswordFor(null)}>
              Cancel
            </Button>
            <Button type="submit" form="admin-password-form" loading={passwordBusy}>
              Save password
            </Button>
          </>
        }
      >
        <form id="admin-password-form" onSubmit={savePassword} className="space-y-3" noValidate>
          {passwordError && <Alert tone="error">{passwordError}</Alert>}
          <p className="text-sm text-slate-600">
            Existing sessions are signed out and unused reset links are cancelled. If you change your own password,
            you will need to sign in again.
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

      <Modal
        open={confirmDeactivate !== null}
        onClose={() => setConfirmDeactivate(null)}
        title="Deactivate account"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDeactivate(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={rowBusy === confirmDeactivate?.id}
              onClick={() => confirmDeactivate && setActive(confirmDeactivate, false)}
            >
              Deactivate
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          {confirmDeactivate?.full_name} will be signed out immediately and blocked from signing in. Their records are
          kept. You can reactivate the account at any time.
        </p>
      </Modal>
    </div>
  );
}
