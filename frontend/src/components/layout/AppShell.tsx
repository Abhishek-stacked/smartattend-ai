import { useState } from "react";
import type { CSSProperties } from "react";
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
    <div className="relative flex h-full flex-col overflow-hidden border-r-2 border-slate-200 bg-[#060607]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.9) 1px, transparent 1px)",
          backgroundSize: "34px 34px",
        }}
      />

      <div className="relative flex h-16 items-center justify-between gap-2 border-b-2 border-slate-200 px-4">
        <NavLink to="/dashboard" className="flex items-center gap-2.5" onClick={() => setDrawerOpen(false)}>
          <span className="grid size-9 place-items-center border-2 border-brand-500 bg-brand-500 text-[#08080a] shadow-[3px_3px_0_0_#000]">
            <ScanFace aria-hidden className="size-5" />
          </span>
          <span>
            <span className="block font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-chalk">
              SmartAttend
            </span>
            <span className="block font-mono text-[9px] uppercase tracking-[0.22em] text-slate-500">
              AI / v1.0
            </span>
          </span>
        </NavLink>
        <button
          type="button"
          className="border-2 border-transparent p-1.5 text-slate-400 hover:border-slate-300 hover:text-chalk lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close navigation"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>

      <nav aria-label="Main navigation" className="relative flex-1 space-y-1 overflow-y-auto px-2.5 py-3">
        <p className="label-mono px-2 pb-2">Modules</p>
        {items.map(({ to, label, icon: Icon }, index) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/dashboard"}
            onClick={() => setDrawerOpen(false)}
            style={{ "--d": `${index * 30}ms` } as CSSProperties}
            className={({ isActive }) =>
              cx(
                "anim-rise group flex items-center gap-3 border-2 px-2.5 py-2 font-mono text-[11px] uppercase tracking-[0.1em] transition-all duration-150",
                isActive
                  ? "border-brand-500 bg-brand-500 text-[#08080a] shadow-[4px_4px_0_0_#000]"
                  : "border-transparent text-slate-400 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900",
              )
            }
          >
            {({ isActive }) => (
              <>
                <span aria-hidden className="grid size-5 shrink-0 place-items-center">
                  <Icon aria-hidden className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <span
                  aria-hidden
                  className={cx(
                    "font-mono text-[9px] tabular-nums tracking-normal",
                    isActive ? "text-[#08080a]/60" : "text-slate-500",
                  )}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="relative border-t-2 border-slate-200 p-2.5">
        <div className="flex items-center gap-2.5 border-2 border-slate-200 px-2 py-2">
          <span className="grid size-8 shrink-0 place-items-center border-2 border-brand-500 bg-brand-500 font-mono text-[10px] font-bold text-[#08080a]">
            {initials(user.full_name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-chalk">{user.full_name}</span>
            <span className="label-mono block truncate">{roleLabel(user.role)}</span>
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="border-2 border-transparent p-1.5 text-slate-400 transition hover:border-rose-500 hover:text-rose-400 disabled:opacity-50"
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
    <div className="relative min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh lg:block">{sidebar}</aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="anim-fade relative h-full w-72 max-w-[85vw] shadow-float">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b-2 border-slate-200 bg-[#0b0b0d]/88 px-4 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            className="border-2 border-transparent p-1.5 text-slate-500 hover:border-slate-300 hover:text-slate-900 lg:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
          >
            <Menu aria-hidden className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-900">
              {titleForPath(location.pathname)}
            </p>
            <p className="label-mono truncate">SmartAttend AI</p>
          </div>
          <Badge tone="brand">{roleLabel(user.role)}</Badge>
          <NavLink
            to="/profile"
            className="grid size-9 place-items-center border-2 border-brand-500 bg-brand-500 font-mono text-[10px] font-bold text-[#08080a] shadow-[3px_3px_0_0_#000] transition-transform duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_#000]"
            aria-label="My account"
          >
            {initials(user.full_name)}
          </NavLink>
        </header>

        <main key={location.pathname} className="anim-rise mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
