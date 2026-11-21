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
      <label htmlFor={areaId} className="field-label">
        {label}
        {required && <span className="ml-1 text-rose-400">*</span>}
      </label>
      <textarea
        id={areaId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint ? `${areaId}-hint` : undefined}
        className={cx("control min-h-20 px-3 py-2 text-sm leading-relaxed", error && "control-invalid")}
        {...rest}
      />
      {error ? (
        <p className="text-[13px] leading-snug text-rose-400">{error}</p>
      ) : hint ? (
        <p id={`${areaId}-hint`} className="text-[13px] leading-snug text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
