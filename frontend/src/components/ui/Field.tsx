import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "../../lib/format";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  hint?: ReactNode;
  /** Rendered inside the field on the trailing edge, e.g. a reveal toggle. */
  trailing?: ReactNode;
}

export function Field({ label, error, hint, trailing, className, id, required, ...rest }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={inputId} className="field-label">
        {label}
        {required && <span className="ml-1 text-rose-400">*</span>}
      </label>
      <div className="relative">
        <input
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cx(
            "control h-9 px-3 text-sm",
            trailing ? "pr-10" : undefined,
            error && "control-invalid",
          )}
          {...rest}
        />
        {trailing && (
          <div className="absolute inset-y-0 right-1.5 flex items-center">{trailing}</div>
        )}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="text-[13px] leading-snug text-rose-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-[13px] leading-snug text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
