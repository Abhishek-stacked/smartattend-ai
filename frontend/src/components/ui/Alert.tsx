import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { cx } from "../../lib/format";

type Tone = "error" | "success" | "info" | "warning";

const TONES: Record<Tone, { wrap: string; icon: typeof Info }> = {
  error: { wrap: "border-rose-500/25 bg-rose-500/10 text-rose-200", icon: AlertCircle },
  success: { wrap: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200", icon: CheckCircle2 },
  info: { wrap: "border-sky-500/25 bg-sky-500/10 text-sky-200", icon: Info },
  warning: { wrap: "border-amber-500/25 bg-amber-500/10 text-amber-200", icon: TriangleAlert },
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
      className={cx("anim-fade flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm", wrap, className)}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 opacity-90" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-1" : undefined}>{children}</div>}
      </div>
    </div>
  );
}
