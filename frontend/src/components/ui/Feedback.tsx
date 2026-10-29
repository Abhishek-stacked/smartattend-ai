import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cx } from "../../lib/format";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cx("inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-slate-500", className)}>
      <Loader2 aria-hidden className="size-4 animate-spin text-brand-500" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function FullPageSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink">
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
        <div className="border-2 border-slate-300 bg-slate-100 p-3 text-brand-500 shadow-[5px_5px_0_0_#000]">
          {icon}
        </div>
      )}
      <h3 className="mt-2 font-mono text-xs font-bold uppercase tracking-[0.16em] text-slate-900">{title}</h3>
      {description && <p className="max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
