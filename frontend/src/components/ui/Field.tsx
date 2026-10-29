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
      <label
        htmlFor={inputId}
        className="block font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500"
      >
        {label}
        {required && <span className="ml-1 text-brand-500">*</span>}
      </label>
      <input
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          "block h-11 w-full rounded-sm border-2 bg-slate-50 px-3 text-sm text-slate-900 transition-all duration-150",
          "placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500",
          error
            ? "border-rose-500 focus:border-rose-400 focus:shadow-[4px_4px_0_0_#f43f5e]"
            : "border-slate-300 hover:border-slate-400 focus:border-brand-500 focus:shadow-[4px_4px_0_0_#c6f24d] focus:outline-none",
        )}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-error`} className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-rose-400">
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
