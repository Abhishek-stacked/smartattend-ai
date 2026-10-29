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
      <label
        htmlFor={areaId}
        className="block font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500"
      >
        {label}
        {required && <span className="ml-1 text-brand-500">*</span>}
      </label>
      <textarea
        id={areaId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint ? `${areaId}-hint` : undefined}
        className={cx(
          "block min-h-20 w-full rounded-sm border-2 bg-slate-50 px-3 py-2 text-sm text-slate-900 transition-all duration-150",
          error
            ? "border-rose-500 focus:border-rose-400 focus:shadow-[4px_4px_0_0_#f43f5e]"
            : "border-slate-300 hover:border-slate-400 focus:border-brand-500 focus:shadow-[4px_4px_0_0_#c6f24d] focus:outline-none",
        )}
        {...rest}
      />
      {error ? (
        <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-rose-400">{error}</p>
      ) : hint ? (
        <p id={`${areaId}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
