import type { ReactNode } from "react";
import { cx } from "../../lib/format";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  brand: "bg-gradient-to-r from-brand-50 to-accent-50 text-brand-700 ring-brand-200",
  success: "bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-700 ring-emerald-200",
  warning: "bg-gradient-to-r from-amber-50 to-orange-50 text-amber-800 ring-amber-200",
  danger: "bg-gradient-to-r from-rose-50 to-pink-50 text-rose-700 ring-rose-200",
  info: "bg-gradient-to-r from-sky-50 to-cyan-50 text-sky-700 ring-sky-200",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
