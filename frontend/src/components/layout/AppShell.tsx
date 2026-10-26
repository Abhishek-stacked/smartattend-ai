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
    <div className="relative flex h-full flex-col overflow-hidden bg-slate-950 text-slate-300">
      <div
        aria-hidden
        className="orb -left-24 -top-28 size-[22rem] bg-brand-500/45"
      />
      <div
        aria-hidden
        className="orb -bottom-36 -right-24 size-[20rem] bg-accent-400/30"
      />
      <div
        aria-hidden
        className="orb left-1/3 top-1/2 size-[16rem] bg-fuchsia-500/20"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.9) 1px, transparent 1px)",
          backgroundSize: "46px 46px",
          maskImage: "radial-gradient(70% 55% at 30% 0%, #000 0%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(70% 55% at 30% 0%, #000 0%, transparent 78%)",
        }}
      />

      <div className="relative flex h-16 items-center justify-between gap-2 px-5">
        <NavLink to="/dashboard" className="flex items-center gap-2.5" onClick={() => setDrawerOpen(false)}>
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-300 via-brand-500 to-accent-500 text-white shadow-[0_10px_24px_-8px_rgba(108,99,244,1)] ring-1 ring-white/25">
            <ScanFace aria-hidden className="size-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-white">SmartAttend AI</span>
            <span className="block text-[11px] text-slate-400">Attendance intelligence</span>
          </span>
        </NavLink>
        <button
          type="button"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close navigation"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>

      <nav aria-label="Main navigation" className="relative flex-1 space-y-1 overflow-y-auto px-3 py-3">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/dashboard"}
            onClick={() => setDrawerOpen(false)}
            className={({ isActive }) =>
              cx(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-gradient-to-r from-brand-500 via-brand-500/90 to-accent-500/60 text-white shadow-[0_12px_28px_-12px_rgba(108,99,244,1)] ring-1 ring-white/20"
                  : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100",
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  aria-hidden
                  className={cx(
                    "grid size-7 shrink-0 place-items-center rounded-lg transition-colors",
                    isActive ? "bg-white/20 text-white" : "text-slate-500 group-hover:text-brand-200",
                  )}
                >
                  <Icon aria-hidden className="size-4" />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="relative border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-2 py-2 ring-1 ring-white/10 backdrop-blur-sm">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-300 via-brand-500 to-accent-500 text-xs font-semibold text-white shadow-[0_8px_18px_-8px_rgba(108,99,244,1)] ring-1 ring-white/25">
            {initials(user.full_name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-white">{user.full_name}</span>
            <span className="block truncate text-xs text-slate-400">{roleLabel(user.role)}</span>
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-50"
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
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh lg:block">{sidebar}</aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} aria-hidden />
          <div className="relative h-full w-72 max-w-[85vw] shadow-float">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-white/60 bg-white/60 px-4 shadow-[0_10px_30px_-24px_rgba(30,27,75,.6)] backdrop-blur-xl sm:px-6">
          <button
            type="button"
            className="rounded-lg p-2 text-slate-600 hover:bg-white/70 lg:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
          >
            <Menu aria-hidden className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{titleForPath(location.pathname)}</p>
            <p className="truncate text-xs text-slate-500">SmartAttend AI</p>
          </div>
          <Badge tone="brand">{roleLabel(user.role)}</Badge>
          <NavLink
            to="/profile"
            className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-brand-400 via-brand-500 to-accent-500 text-xs font-semibold text-white shadow-[0_10px_22px_-8px_rgba(108,99,244,1)] ring-1 ring-white/40 transition hover:shadow-glow"
            aria-label="My account"
          >
            {initials(user.full_name)}
          </NavLink>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
