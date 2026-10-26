import { useId } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cx } from "../../lib/format";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string | null;
  hint?: string;
}

export function Textarea({ label, error, hint, className, id, required, ...rest }: TextareaProps) {
  const autoId = useId();
  const areaId = id ?? autoId;
  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={areaId} className="block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-rose-600">*</span>}
      </label>
      <textarea
        id={areaId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint ? `${areaId}-hint` : undefined}
        className={cx(
          "block min-h-20 w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition",
          error
            ? "border-rose-400 focus:border-rose-500 focus:shadow-glow"
            : "border-slate-300 hover:border-slate-400 focus:border-brand-500 focus:shadow-glow",
        )}
        {...rest}
      />
      {error ? (
        <p className="text-xs font-medium text-rose-600">{error}</p>
      ) : hint ? (
        <p id={`${areaId}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
