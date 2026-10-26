export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// Date-only strings parse as UTC midnight in JS, which shifts the calendar day in
// western timezones. Build those as local dates instead.
function toDate(iso: string): Date {
  const match = DATE_ONLY.exec(iso);
  if (!match) return new Date(iso);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function formatDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(toDate(iso));
}

export function formatDate(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone }).format(toDate(iso));
}

export function percent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
