import { useId } from "react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { cx } from "../../lib/format";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: ReactNode;
}

export function Select({ label, hint, className, id, children, ...rest }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={selectId} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        id={selectId}
        aria-describedby={hint ? `${selectId}-hint` : undefined}
        className="block h-10 w-full rounded-xl border border-slate-300 bg-white px-2 text-sm text-slate-900 shadow-sm transition hover:border-slate-400 focus:border-brand-500 focus:shadow-glow"
        {...rest}
      >
        {children}
      </select>
      {hint && (
        <p id={`${selectId}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
    </div>
  );
}
