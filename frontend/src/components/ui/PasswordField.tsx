import { useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Field } from "./Field";

export interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  error?: string | null;
  hint?: ReactNode;
}

export function PasswordField({ label, error, hint, className, id, required, ...rest }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`;

  return (
    <Field
      label={label}
      id={id}
      required={required}
      error={error}
      hint={hint}
      className={className}
      type={visible ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="icon-button size-7"
          aria-label={toggleLabel}
          title={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
        </button>
      }
      {...rest}
    />
  );
}
