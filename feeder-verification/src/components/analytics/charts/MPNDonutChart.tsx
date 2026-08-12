import type { MPNUsage } from "@/lib/analytics/types";

const colors: Record<string, string> = {
  PRIMARY: "#2563eb",
  ALTERNATE_1: "#d97706",
  ALTERNATE_2: "#7c3aed",
};

export function MPNDonutChart({ data }: { data: MPNUsage[] }) {
  const totals = data.reduce<Record<string, number>>((accumulator, item) => {
    accumulator[item.mpnType] = (accumulator[item.mpnType] ?? 0) + item.timesUsed;
    return accumulator;
  }, {});
  const chartData = Object.entries(totals);
  const total = chartData.reduce((sum, [, value]) => sum + value, 0);

  let offset = 0;

  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900">Primary vs alternate MPN usage</h3>
        <p className="text-xs text-neutral-500">Breakdown by scan match type</p>
      </div>
      <div className="mt-4 flex items-center gap-6">
        <div className="relative h-56 w-56 shrink-0">
          <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
            <circle cx="100" cy="100" r="72" fill="none" stroke="#e5e7eb" strokeWidth="22" />
            {chartData.map(([label, value]) => {
              const fraction = total === 0 ? 0 : value / total;
              const circumference = 2 * Math.PI * 72;
              const dash = Math.max(fraction * circumference, 0);
              const gap = Math.max(circumference - dash, 0);
              const circle = (
                <circle
                  key={label}
                  cx="100"
                  cy="100"
                  r="72"
                  fill="none"
                  stroke={colors[label] ?? "#64748b"}
                  strokeWidth="22"
                  strokeDasharray={`${dash} ${gap}`}
                  strokeDashoffset={-offset}
                  strokeLinecap="round"
                />
              );
              offset += dash + 8;
              return circle;
            })}
            <circle cx="100" cy="100" r="50" fill="white" />
            <text x="100" y="96" textAnchor="middle" className="fill-neutral-900 text-[20px] font-semibold">
              {total.toLocaleString()}
            </text>
            <text x="100" y="116" textAnchor="middle" className="fill-neutral-500 text-[11px]">
              total scans
            </text>
          </svg>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          {chartData.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">No MPN usage data for this period.</div>
          ) : (
            chartData.map(([label, value]) => {
              const percentage = total === 0 ? 0 : Math.round((value / total) * 100);
              return (
                <div key={label} className="flex items-center gap-3 rounded-2xl border border-neutral-200 px-3 py-2.5">
                  <span className="h-3 w-3 rounded-full" style={{ background: colors[label] ?? "#64748b" }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-neutral-900">{label.replace("_", " ")}</div>
                    <div className="text-xs text-neutral-500">{value.toLocaleString()} scans</div>
                  </div>
                  <div className="text-sm font-semibold text-neutral-700">{percentage}%</div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
