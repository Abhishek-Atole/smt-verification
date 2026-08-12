import type { OverviewKPIs } from "@/lib/analytics/types";
import { Activity, AlertTriangle, CheckCircle2, Clock3, Scissors, ScanLine, Shuffle, Users2 } from "lucide-react";

type CardTone = "blue" | "green" | "amber" | "red" | "slate";

interface KPIProps {
  label: string;
  value: string | number;
  unit?: string;
  tone: CardTone;
  icon: React.ReactNode;
  sublabel?: string;
  trend?: number;
}

const toneMap: Record<CardTone, { bg: string; border: string; text: string }> = {
  blue: { bg: "rgba(59, 130, 246, 0.12)", border: "rgba(59, 130, 246, 0.24)", text: "#2563eb" },
  green: { bg: "rgba(34, 197, 94, 0.12)", border: "rgba(34, 197, 94, 0.24)", text: "#16a34a" },
  amber: { bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.24)", text: "#d97706" },
  red: { bg: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.24)", text: "#dc2626" },
  slate: { bg: "rgba(100, 116, 139, 0.12)", border: "rgba(100, 116, 139, 0.24)", text: "#334155" },
};

function KPICard({ label, value, unit, tone, icon, sublabel, trend }: KPIProps) {
  const color = toneMap[tone];
  const trendText = trend == null ? null : `${trend > 0 ? "+" : ""}${trend}% vs prev`;

  return (
    <article className="rounded-2xl border bg-white p-4 shadow-sm" style={{ borderColor: color.border }}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-500">{label}</p>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: color.bg, color: color.text }}>
          {icon}
        </div>
      </div>
      <div className="mt-4 flex items-end gap-2">
        <div className="text-3xl font-semibold leading-none" style={{ color: color.text }}>
          {value}
        </div>
        {unit ? <div className="pb-1 text-sm text-neutral-500">{unit}</div> : null}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-neutral-500">
        <span>{sublabel ?? ""}</span>
        {trendText ? <span>{trendText}</span> : null}
      </div>
    </article>
  );
}

export function KPICards({ kpis }: { kpis: OverviewKPIs }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <KPICard label="Total Changeovers" value={kpis.totalChangeovers.toLocaleString()} tone="blue" icon={<Activity className="h-4 w-4" />} sublabel="Selected period" trend={kpis.trends.changeovers} />
      <KPICard label="Avg Duration" value={kpis.avgDurationMinutes} unit="min" tone="amber" icon={<Clock3 className="h-4 w-4" />} sublabel="Per changeover" trend={kpis.trends.duration} />
      <KPICard label="First-Pass Rate" value={kpis.firstPassRate} unit="%" tone="green" icon={<CheckCircle2 className="h-4 w-4" />} sublabel="No scan failures" trend={kpis.trends.firstPassRate} />
      <KPICard label="Alternate Usage" value={kpis.alternateUsageRate} unit="%" tone="slate" icon={<Shuffle className="h-4 w-4" />} sublabel="Primary vs alternate" />
      <KPICard label="Scans Today" value={kpis.totalScansToday.toLocaleString()} tone="blue" icon={<ScanLine className="h-4 w-4" />} sublabel="Total scan events" />
      <KPICard label="Scan Fail Rate" value={kpis.scanFailRate} unit="%" tone={kpis.scanFailRate > 5 ? "red" : "green"} icon={<AlertTriangle className="h-4 w-4" />} sublabel="Audit-log failures" trend={kpis.trends.scanFailRate} />
      <KPICard label="Splices Today" value={kpis.totalSplicesToday.toLocaleString()} tone="amber" icon={<Scissors className="h-4 w-4" />} sublabel="Recorded spool changes" />
      <KPICard label="Active Operators" value={kpis.activeOperators.toLocaleString()} tone="slate" icon={<Users2 className="h-4 w-4" />} sublabel="Current window" />
    </div>
  );
}
