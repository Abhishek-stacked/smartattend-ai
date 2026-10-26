import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cx } from "../../lib/format";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cx("inline-flex items-center gap-2 text-sm text-slate-500", className)}>
      <Loader2 aria-hidden className="size-4 animate-spin" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function FullPageSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50">
      <Spinner label={label} />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && (
        <div className="rounded-2xl bg-gradient-to-br from-brand-100 via-brand-50 to-accent-100 p-3 text-brand-600 shadow-[0_10px_24px_-14px_rgba(108,99,244,0.9)] ring-1 ring-brand-200/70">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
