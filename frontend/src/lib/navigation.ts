import {
  BarChart3,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  FilePenLine,
  Flag,
  Fingerprint,
  GraduationCap,
  LayoutDashboard,
  LockKeyhole,
  ScanFace,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "../lib/types";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
}

const ALL: Role[] = ["admin", "faculty", "student"];
const STAFF: Role[] = ["admin", "faculty"];

export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ALL },
  { to: "/live", label: "Live attendance", icon: ScanFace, roles: STAFF },
  { to: "/mark-attendance", label: "Mark attendance", icon: Fingerprint, roles: ["student"] },
  { to: "/sessions", label: "Sessions", icon: CalendarClock, roles: STAFF },
  { to: "/attendance", label: "Records", icon: ClipboardCheck, roles: ALL },
  { to: "/review", label: "Review", icon: Flag, roles: STAFF },
  { to: "/corrections", label: "Corrections", icon: FilePenLine, roles: ALL },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: STAFF },
  { to: "/students", label: "Students", icon: Users, roles: ["admin"] },
  { to: "/faculty", label: "Faculty", icon: GraduationCap, roles: ["admin"] },
  { to: "/courses", label: "Courses", icon: BookOpen, roles: ["admin", "faculty"] },
  { to: "/admin/users", label: "User accounts", icon: UserCog, roles: ["admin"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["admin"] },
  { to: "/privacy", label: "Privacy & biometrics", icon: ShieldCheck, roles: ["student"] },
  { to: "/profile", label: "My account", icon: LockKeyhole, roles: ALL },
];

export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function titleForPath(pathname: string): string {
  const match = NAV_ITEMS.filter((i) => pathname === i.to || pathname.startsWith(`${i.to}/`)).sort(
    (a, b) => b.to.length - a.to.length,
  )[0];
  return match?.label ?? "SmartAttend AI";
}
