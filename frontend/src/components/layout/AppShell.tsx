import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut, Menu, ScanFace, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { cx, initials, roleLabel } from "../../lib/format";
import { navFor, titleForPath } from "../../lib/navigation";
import { Badge } from "../ui";

export function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  if (!user) return null;
  const items = navFor(user.role);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  const sidebar = (
    <div className="flex h-full flex-col border-r border-line bg-panel">
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
        <NavLink to="/dashboard" className="flex items-center gap-2.5" onClick={() => setDrawerOpen(false)}>
          <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-white">
            <ScanFace aria-hidden className="size-[18px]" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-fg">SmartAttend</span>
        </NavLink>
        <button
          type="button"
          className="icon-button size-8 lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close navigation"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>

      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto p-3">
        <p className="px-2.5 pb-2 text-xs font-medium text-fg-faint">Workspace</p>
        <ul className="space-y-0.5">
          {items.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === "/dashboard"}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) =>
                  cx(
                    "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors duration-150",
                    isActive
                      ? "bg-brand-500/12 font-semibold text-brand-100"
                      : "font-medium text-fg-muted hover:bg-raised hover:text-fg",
                  )
                }
              >
                <Icon aria-hidden className="size-4 shrink-0 opacity-90" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-line p-2.5">
        <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-500/15 text-xs font-semibold text-brand-200">
            {initials(user.full_name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-fg">{user.full_name}</span>
            <span className="block truncate text-xs text-fg-faint">{roleLabel(user.role)}</span>
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="icon-button size-8 hover:text-rose-300"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut aria-hidden className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh lg:block">{sidebar}</aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="anim-fade absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-float">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-ink/85 px-4 backdrop-blur-md sm:px-6">
          <button
            type="button"
            className="icon-button size-8 lg:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
          >
            <Menu aria-hidden className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">{titleForPath(location.pathname)}</p>
          </div>
          <Badge tone="brand">{roleLabel(user.role)}</Badge>
          <NavLink
            to="/profile"
            className="grid size-8 place-items-center rounded-full bg-brand-500/15 text-xs font-semibold text-brand-200 ring-1 ring-line transition-colors hover:bg-brand-500/25 hover:text-brand-100"
            aria-label="My account"
            title={user.full_name}
          >
            {initials(user.full_name)}
          </NavLink>
        </header>

        <main key={location.pathname} className="anim-rise mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
