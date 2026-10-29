import { cx } from "../../lib/format";

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-6 w-12 shrink-0 items-center rounded-xs border-2 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-brand-500 bg-brand-500" : "border-slate-300 bg-slate-200",
        className,
      )}
    >
      <span
        aria-hidden
        className={cx(
          "inline-block size-4 border-2 transition-transform duration-150",
          checked
            ? "translate-x-6 border-[#08080a] bg-[#08080a]"
            : "translate-x-0.5 border-slate-400 bg-slate-600",
        )}
      />
    </button>
  );
}
