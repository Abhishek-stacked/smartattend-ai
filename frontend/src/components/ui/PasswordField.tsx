import { useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cx } from "../../lib/format";
import { Field } from "./Field";

export interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  error?: string | null;
  hint?: ReactNode;
}

export function PasswordField({ label, error, hint, className, id, required, ...rest }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={cx("relative", className)}>
      <Field
        label={label}
        id={id}
        required={required}
        error={error}
        hint={hint}
        type={visible ? "text" : "password"}
        className="[&_input]:pr-11"
        {...rest}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-1 top-7 flex h-9 w-9 items-center justify-center rounded-md text-slate-400 transition hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        title={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
      </button>
    </div>
  );
}
