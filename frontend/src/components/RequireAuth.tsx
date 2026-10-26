import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { FullPageSpinner } from "../components/ui";
import type { Role } from "../lib/types";

export function RequireAuth({ roles }: { roles?: Role[] }) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <FullPageSpinner label="Checking your session" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
  return <Outlet />;
}

export function GuestOnly() {
  const { user, status } = useAuth();
  if (status === "loading") return <FullPageSpinner label="Loading" />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export function RoleGuard({ roles }: { roles: Role[] }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
  return <Outlet />;
}
