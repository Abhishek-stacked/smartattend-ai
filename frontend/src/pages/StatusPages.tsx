import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Button } from "../components/ui";

export function UnauthorizedPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <span className="grid size-12 place-items-center rounded-full bg-amber-50 text-amber-600">
        <ShieldAlert aria-hidden className="size-6" />
      </span>
      <h1 className="mt-4 text-xl font-semibold text-slate-900">You do not have access to this page</h1>
      <p className="mt-1 max-w-md text-sm text-slate-500">
        Your role does not include this area. If you believe this is a mistake, contact your administrator.
      </p>
      <Link to="/dashboard" className="mt-6">
        <Button>Back to dashboard</Button>
      </Link>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-5xl font-semibold tracking-tight text-slate-300">404</p>
      <h1 className="mt-3 text-xl font-semibold text-slate-900">Page not found</h1>
      <p className="mt-1 max-w-md text-sm text-slate-500">
        The page you are looking for does not exist or has moved.
      </p>
      <Link to="/dashboard" className="mt-6">
        <Button>Back to dashboard</Button>
      </Link>
    </div>
  );
}
