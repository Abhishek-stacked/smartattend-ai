import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cx } from "../../lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "border-2 border-brand-500 bg-brand-500 text-[#08080a] shadow-[5px_5px_0_0_#000] hover:-translate-y-0.5 hover:shadow-[7px_7px_0_0_#000] active:translate-x-1 active:translate-y-1 active:shadow-none disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none disabled:hover:translate-y-0",
  secondary:
    "border-2 border-slate-300 bg-slate-100 text-slate-900 shadow-[5px_5px_0_0_#000] hover:-translate-y-0.5 hover:border-brand-500 hover:text-brand-700 hover:shadow-[7px_7px_0_0_#000] active:translate-x-1 active:translate-y-1 active:shadow-none disabled:text-slate-500 disabled:shadow-none disabled:hover:translate-y-0",
  ghost: "border-2 border-transparent text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900",
  danger:
    "border-2 border-rose-500 bg-rose-500 text-[#08080a] shadow-[5px_5px_0_0_#000] hover:-translate-y-0.5 hover:bg-rose-400 hover:shadow-[7px_7px_0_0_#000] active:translate-x-1 active:translate-y-1 active:shadow-none disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none disabled:hover:translate-y-0",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-3 text-[11px]",
  md: "h-10 gap-2 px-4 text-xs",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "press-3d inline-flex select-none items-center justify-center whitespace-nowrap rounded-sm font-mono font-semibold uppercase tracking-[0.12em] transition-all duration-150 disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
}
