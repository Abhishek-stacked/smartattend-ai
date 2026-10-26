import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { GuestOnly, RequireAuth, RoleGuard } from "./components/RequireAuth";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { ProfilePage } from "./pages/ProfilePage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AttendancePage } from "./pages/AttendancePage";
import { CoursesPage } from "./pages/CoursesPage";
import { FacultyPage } from "./pages/FacultyPage";
import { SessionDetailPage } from "./pages/SessionDetailPage";
import { SessionsPage } from "./pages/SessionsPage";
import { StudentsPage } from "./pages/StudentsPage";
import { LivePage } from "./pages/LivePage";
import { MarkAttendancePage } from "./pages/MarkAttendancePage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ReviewPage } from "./pages/ReviewPage";
import { CorrectionsPage } from "./pages/CorrectionsPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { NotFoundPage, UnauthorizedPage } from "./pages/StatusPages";

export default function App() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/profile" element={<ProfilePage />} />

          <Route element={<RoleGuard roles={["admin", "faculty"]} />}>
            <Route path="/live" element={<LivePage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/reports" element={<ReportsPage />} />
          </Route>

          <Route path="/attendance" element={<AttendancePage />} />
          <Route path="/corrections" element={<CorrectionsPage />} />

          <Route element={<RoleGuard roles={["admin"]} />}>
            <Route path="/students" element={<StudentsPage />} />
            <Route path="/faculty" element={<FacultyPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route
              path="/settings"
              element={
                <PlaceholderPage
                  title="Settings"
                  description="Recognition thresholds, liveness policy and privacy retention."
                  items={[
                    "Validated, audited configuration changes",
                    "Liveness policy: off, flag-for-review or enforce",
                    "Biometric retention and deletion controls",
                  ]}
                />
              }
            />
          </Route>

          <Route element={<RoleGuard roles={["admin", "faculty"]} />}>
            <Route path="/courses" element={<CoursesPage />} />
          </Route>

          <Route element={<RoleGuard roles={["student"]} />}>
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/mark-attendance" element={<MarkAttendancePage />} />
          </Route>

          <Route path="/unauthorized" element={<UnauthorizedPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
