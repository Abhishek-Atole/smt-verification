"use client";

import { useQuery } from "@tanstack/react-query";
import type { ScanVolumePoint } from "@/lib/analytics/types";

function areaPath(data: ScanVolumePoint[], selector: (item: ScanVolumePoint) => number, width = 1000, height = 220) {
  if (data.length === 0) return "";
  const values = data.map(selector);
  const max = Math.max(...values, 1);

  return data
    .map((point, index) => {
      const x = data.length === 1 ? width / 2 : (index / (data.length - 1)) * width;
      const y = height - (selector(point) / max) * height;
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
}

export function ScanVolumeChart() {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics", "realtime"],
    queryFn: async (): Promise<{ data: ScanVolumePoint[] }> => {
      const response = await fetch("/api/analytics/realtime");
      if (!response.ok) {
        throw new Error("Failed to load realtime analytics");
      }

      return response.json();
    },
    staleTime: 0,
    refetchInterval: 10_000,
  });

  const chartData = data?.data ?? [];
  const okPath = areaPath(chartData, (point) => point.scanOk);
  const failPath = areaPath(chartData, (point) => point.scanFail);

  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">Realtime scan volume</h3>
          <p className="text-xs text-neutral-500">15-minute buckets over the last 24 hours</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Live
        </span>
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50">
        {isLoading ? (
          <div className="flex h-56 items-center justify-center text-sm text-neutral-500">Loading realtime data...</div>
        ) : chartData.length === 0 ? (
          <div className="flex h-56 items-center justify-center text-sm text-neutral-500">No realtime activity yet.</div>
        ) : (
          <svg viewBox="0 0 1000 220" className="h-56 w-full">
            <defs>
              <linearGradient id="okVolumeFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#16a34a" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#16a34a" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="failVolumeFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#dc2626" stopOpacity="0.24" />
                <stop offset="100%" stopColor="#dc2626" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${okPath} L 1000 220 L 0 220 Z`} fill="url(#okVolumeFill)" />
            <path d={okPath} fill="none" stroke="#16a34a" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d={`${failPath} L 1000 220 L 0 220 Z`} fill="url(#failVolumeFill)" />
            <path d={failPath} fill="none" stroke="#dc2626" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-neutral-500">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-600" />Scan OK</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-600" />Scan Fail</span>
      </div>
    </section>
  );
}
