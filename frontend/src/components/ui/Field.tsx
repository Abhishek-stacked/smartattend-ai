import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "../../lib/format";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  hint?: ReactNode;
}

export function Field({ label, error, hint, className, id, required, ...rest }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-rose-600">*</span>}
      </label>
      <input
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          "block h-10 w-full rounded-xl border bg-white px-3 text-sm text-slate-900 shadow-sm transition",
          "placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50",
          error
            ? "border-rose-400 focus:border-rose-500 focus:shadow-glow"
            : "border-slate-300 hover:border-slate-400 focus:border-brand-500 focus:shadow-glow",
        )}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-xs font-medium text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
