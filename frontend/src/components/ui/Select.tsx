import { useId } from "react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
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
      <label htmlFor={selectId} className="field-label">
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          aria-describedby={hint ? `${selectId}-hint` : undefined}
          className="control h-9 cursor-pointer appearance-none pl-3 pr-9 text-sm"
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-faint"
        />
      </div>
      {hint && (
        <p id={`${selectId}-hint`} className="text-[13px] leading-snug text-fg-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
