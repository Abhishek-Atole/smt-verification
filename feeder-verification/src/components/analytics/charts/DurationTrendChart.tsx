import type { DurationDataPoint } from "@/lib/analytics/types";

function linePath(data: DurationDataPoint[], selector: (item: DurationDataPoint) => number, width = 1000, height = 260) {
  if (data.length === 0) return "";
  const values = data.map(selector);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);

  return data
    .map((point, index) => {
      const x = data.length === 1 ? width / 2 : (index / (data.length - 1)) * width;
      const y = height - ((selector(point) - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
}

export function DurationTrendChart({ data }: { data: DurationDataPoint[] }) {
  const avgLine = linePath(data, (point) => point.avgDurationMinutes);
  const minLine = linePath(data, (point) => point.minDurationMinutes);
  const maxLine = linePath(data, (point) => point.maxDurationMinutes);

  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">Changeover duration trend</h3>
          <p className="text-xs text-neutral-500">Average, min, and max duration over time</p>
        </div>
        <div className="text-xs text-neutral-500">{data.length} points</div>
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50">
        {data.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-neutral-500">No duration data for this window.</div>
        ) : (
          <svg viewBox="0 0 1000 260" className="h-64 w-full">
            <defs>
              <linearGradient id="durationFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.24" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="1000" height="260" fill="white" />
            <path d={`${avgLine} L 1000 260 L 0 260 Z`} fill="url(#durationFill)" />
            <path d={avgLine} fill="none" stroke="#2563eb" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            <path d={minLine} fill="none" stroke="#16a34a" strokeWidth="2.5" strokeDasharray="6 6" strokeLinecap="round" strokeLinejoin="round" />
            <path d={maxLine} fill="none" stroke="#d97706" strokeWidth="2.5" strokeDasharray="6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-neutral-500">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-600" />Avg</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-green-600" />Min</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-600" />Max</span>
      </div>
    </section>
  );
}
