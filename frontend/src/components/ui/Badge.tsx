import type { ReactNode } from "react";
import { cx } from "../../lib/format";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "border-line bg-raised text-fg-muted",
  brand: "border-brand-500/30 bg-brand-500/12 text-brand-300",
  success: "border-emerald-500/25 bg-emerald-500/12 text-emerald-300",
  warning: "border-amber-500/25 bg-amber-500/12 text-amber-300",
  danger: "border-rose-500/25 bg-rose-500/12 text-rose-300",
  info: "border-sky-500/25 bg-sky-500/12 text-sky-300",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-4",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
