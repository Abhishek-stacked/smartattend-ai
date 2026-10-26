import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { STATUS_COLORS } from "../../lib/reportColors";
import type { AttendanceStatus, TrendPoint } from "../../lib/types";

const GRADIENTS: Record<string, [string, string]> = {
  present: ["#34d399", "#059669"],
  late: ["#fbbf24", "#d97706"],
  absent: ["#fb7185", "#e11d48"],
  excused: ["#7dd3fc", "#0284c7"],
  pending_review: ["#a78bfa", "#7c3aed"],
};

/* Recharts does not render <defs> children, so the gradients live in a sibling
   SVG in the same document; url(#id) references resolve across SVG roots. */
function GradientDefs({ ids }: { ids: string[] }) {
  return (
    <svg aria-hidden focusable="false" width="0" height="0" className="absolute">
      <defs>
        {ids.map((id) => {
          const [from, to] = GRADIENTS[id.replace(/^grad-/, "").replace(/^pie-/, "")] ?? ["#94a3b8", "#475569"];
          return (
            <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={from} stopOpacity={id.startsWith("grad-") ? 0.5 : 1} />
              <stop offset="100%" stopColor={to} stopOpacity={id.startsWith("grad-") ? 0.04 : 1} />
            </linearGradient>
          );
        })}
      </defs>
    </svg>
  );
}

export function TrendChart({ series }: { series: TrendPoint[] }) {
  const seriesDefs: { status: AttendanceStatus; key: string; label: string }[] = [
    { status: "present", key: "present", label: "Present" },
    { status: "late", key: "late", label: "Late" },
    { status: "absent", key: "absent", label: "Absent" },
  ];

  return (
    <div className="relative h-full w-full">
      <GradientDefs ids={seriesDefs.map(({ status }) => `grad-${status}`)} />
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="#dbe2f3" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ stroke: "#a5acff", strokeWidth: 1, strokeDasharray: "4 4" }}
            contentStyle={{
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.7)",
              background: "rgba(255,255,255,0.92)",
              backdropFilter: "blur(10px)",
              boxShadow: "0 18px 40px -18px rgba(30,27,75,0.5)",
              fontSize: 12,
            }}
            labelStyle={{ color: "#0f172a", fontWeight: 600 }}
          />
          {seriesDefs.map(({ status, key, label }) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={label}
              stackId="1"
              stroke={STATUS_COLORS[status]}
              strokeWidth={2}
              fill={`url(#grad-${status})`}
              fillOpacity={1}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface StatusSlice {
  status: AttendanceStatus;
  label: string;
  value: number;
}

export function StatusPie({ slices }: { slices: StatusSlice[] }) {
  return (
    <div className="relative h-full w-full">
      <GradientDefs ids={slices.map((slice) => `pie-${slice.status}`)} />
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            innerRadius={42}
            outerRadius={68}
            paddingAngle={3}
            strokeWidth={0}
            startAngle={90}
            endAngle={-270}
          >
            {slices.map((slice) => (
              <Cell key={slice.status} fill={`url(#pie-${slice.status})`} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.7)",
              background: "rgba(255,255,255,0.92)",
              backdropFilter: "blur(10px)",
              boxShadow: "0 18px 40px -18px rgba(30,27,75,0.5)",
              fontSize: 12,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
