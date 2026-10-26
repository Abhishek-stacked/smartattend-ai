import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span aria-hidden className="h-6 w-1 rounded-full bg-gradient-to-b from-brand-500 to-accent-400" />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        </div>
        {description && <p className="mt-1.5 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
