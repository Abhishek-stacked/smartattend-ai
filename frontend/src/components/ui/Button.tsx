import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cx } from "../../lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "border border-brand-600 bg-brand-600 text-white shadow-control hover:border-brand-500 hover:bg-brand-500 active:bg-brand-700 disabled:border-brand-600/30 disabled:bg-brand-600/25 disabled:text-white/60",
  secondary:
    "border border-line-strong bg-raised text-fg shadow-control hover:border-line-hover hover:bg-surface-hover active:bg-surface-pressed disabled:border-line disabled:bg-panel disabled:text-fg-faint",
  ghost:
    "border border-transparent bg-transparent text-fg-muted hover:bg-raised hover:text-fg disabled:text-fg-faint disabled:hover:bg-transparent",
  danger:
    "border border-rose-600 bg-rose-600 text-white shadow-control hover:border-rose-500 hover:bg-rose-500 active:bg-rose-700 disabled:border-rose-600/30 disabled:bg-rose-600/25 disabled:text-white/60",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-[13px]",
  md: "h-9 gap-2 px-3.5 text-sm",
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
        "inline-flex select-none items-center justify-center whitespace-nowrap rounded-lg font-medium",
        "transition-[background-color,border-color,color] duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
        "disabled:cursor-not-allowed",
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
