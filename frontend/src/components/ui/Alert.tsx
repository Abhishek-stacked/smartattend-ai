import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { cx } from "../../lib/format";

type Tone = "error" | "success" | "info" | "warning";

const TONES: Record<Tone, { wrap: string; icon: typeof Info }> = {
  error: {
    wrap: "border-rose-200/80 bg-gradient-to-br from-rose-50/90 to-white/70 text-rose-800 ring-1 ring-rose-200/60 shadow-[0_10px_26px_-18px_rgba(244,63,94,0.7)]",
    icon: AlertCircle,
  },
  success: {
    wrap: "border-emerald-200/80 bg-gradient-to-br from-emerald-50/90 to-white/70 text-emerald-800 ring-1 ring-emerald-200/60 shadow-[0_10px_26px_-18px_rgba(16,185,129,0.7)]",
    icon: CheckCircle2,
  },
  info: {
    wrap: "border-sky-200/80 bg-gradient-to-br from-sky-50/90 to-white/70 text-sky-800 ring-1 ring-sky-200/60 shadow-[0_10px_26px_-18px_rgba(14,165,233,0.65)]",
    icon: Info,
  },
  warning: {
    wrap: "border-amber-200/80 bg-gradient-to-br from-amber-50/90 to-white/70 text-amber-900 ring-1 ring-amber-200/60 shadow-[0_10px_26px_-18px_rgba(245,158,11,0.7)]",
    icon: TriangleAlert,
  },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const { wrap, icon: Icon } = TONES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx("flex gap-3 rounded-xl border p-3.5 text-sm backdrop-blur-sm", wrap, className)}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5" : undefined}>{children}</div>}
      </div>
    </div>
  );
}
