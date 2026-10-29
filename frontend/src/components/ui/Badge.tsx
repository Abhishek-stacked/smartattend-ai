import type { ReactNode } from "react";
import { cx } from "../../lib/format";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "border-slate-300 bg-slate-100 text-slate-700",
  brand: "border-brand-500 bg-brand-500 text-[#08080a]",
  success: "border-emerald-500/60 bg-emerald-500/15 text-emerald-300",
  warning: "border-amber-500/60 bg-amber-500/15 text-amber-300",
  danger: "border-rose-500/60 bg-rose-500/15 text-rose-300",
  info: "border-sky-500/60 bg-sky-500/15 text-sky-300",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-xs border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
