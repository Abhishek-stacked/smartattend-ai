import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cx } from "../../lib/format";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cx("inline-flex items-center gap-2 text-sm text-fg-muted", className)}>
      <Loader2 aria-hidden className="size-4 animate-spin" />
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
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center">
      {icon && (
        <div className="mb-1 grid size-11 place-items-center rounded-xl border border-line bg-raised text-fg-muted">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {description && <p className="max-w-sm text-[13px] leading-relaxed text-fg-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
