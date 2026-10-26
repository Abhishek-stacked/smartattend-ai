import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cx } from "../../lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-gradient-to-b from-brand-400 via-brand-500 to-brand-600 text-white shadow-control hover:from-brand-300 hover:via-brand-400 hover:to-brand-500 hover:shadow-glow active:translate-y-px active:shadow-none disabled:from-brand-200 disabled:via-brand-200 disabled:to-brand-200 disabled:text-white/80 disabled:shadow-none focus-visible:outline-brand-600",
  secondary:
    "border border-slate-200/90 bg-gradient-to-b from-white to-slate-50 text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,.06),0_6px_14px_-10px_rgba(30,27,75,.35)] hover:border-brand-200 hover:from-brand-50 hover:to-brand-50 hover:text-brand-800 hover:shadow-[0_1px_2px_rgba(15,23,42,.06),0_10px_20px_-12px_rgba(79,70,229,.55)] active:translate-y-px disabled:text-slate-400 disabled:shadow-none",
  ghost:
    "text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:translate-y-px",
  danger:
    "bg-gradient-to-b from-rose-400 via-rose-500 to-rose-600 text-white shadow-control hover:from-rose-300 hover:via-rose-400 hover:to-rose-500 hover:shadow-[0_0_0_1px_rgba(244,63,94,.16),0_14px_30px_-14px_rgba(244,63,94,.6)] active:translate-y-px active:shadow-none disabled:from-rose-200 disabled:via-rose-200 disabled:to-rose-200 disabled:text-white/80 disabled:shadow-none",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-10 gap-2 px-4 text-sm",
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
        "press-3d inline-flex items-center justify-center rounded-xl font-medium transition-all duration-200 disabled:cursor-not-allowed",
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
