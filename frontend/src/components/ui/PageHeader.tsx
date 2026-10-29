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
    <div className="anim-rise mb-6 flex flex-wrap items-end justify-between gap-3 border-b-2 border-slate-200 pb-4">
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-1.5 block size-3 shrink-0 bg-brand-500 shadow-[3px_3px_0_0_#000]" />
          <h1 className="text-2xl font-semibold uppercase leading-none tracking-tight text-slate-900 sm:text-[1.75rem]">
            {title}
          </h1>
        </div>
        {description && <p className="mt-2 pl-6 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
