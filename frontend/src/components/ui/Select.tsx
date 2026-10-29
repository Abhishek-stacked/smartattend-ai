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
      <label
        htmlFor={selectId}
        className="block font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500"
      >
        {label}
      </label>
      <select
        id={selectId}
        aria-describedby={hint ? `${selectId}-hint` : undefined}
        className="block h-11 w-full rounded-sm border-2 border-slate-300 bg-slate-50 px-2 text-sm text-slate-900 transition-all duration-150 hover:border-slate-400 focus:border-brand-500 focus:shadow-[4px_4px_0_0_#c6f24d] focus:outline-none"
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
