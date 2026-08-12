"use client";

import { AlertCircle, Loader2, TrendingDown } from "lucide-react";

export function LoadingCard({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        {subtitle ? <p className="text-xs text-neutral-500">{subtitle}</p> : null}
      </div>
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
          <span className="text-xs text-neutral-500">Loading data...</span>
        </div>
      </div>
    </div>
  );
}

export function ErrorCard({
  title,
  subtitle,
  error,
  onRetry,
}: {
  title: string;
  subtitle?: string;
  error?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-3xl border border-red-200 bg-red-50 p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-red-900">{title}</h3>
        {subtitle ? <p className="text-xs text-red-600">{subtitle}</p> : null}
      </div>
      <div className="flex flex-col items-start gap-3">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-500" />
          <p className="text-sm text-red-700">{error || "An error occurred while loading data"}</p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyStateCard({
  title,
  subtitle,
  icon: Icon = TrendingDown,
  message,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className: string }>;
  message: string;
}) {
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        {subtitle ? <p className="text-xs text-neutral-500">{subtitle}</p> : null}
      </div>
      <div className="flex flex-col items-center justify-center py-12">
        <Icon className="mb-3 h-12 w-12 text-neutral-300" />
        <p className="text-center text-sm text-neutral-500">{message}</p>
      </div>
    </div>
  );
}

export function LoadingMetricTable() {
  return (
    <div className="animate-pulse">
      <div className="rounded-2xl border border-neutral-200 bg-white">
        <div className="divide-y divide-neutral-200">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-3 px-4 py-3">
              <div className="h-4 w-1/4 rounded bg-neutral-200" />
              <div className="h-4 w-1/3 rounded bg-neutral-200" />
              <div className="h-4 w-1/4 rounded bg-neutral-200" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LoadingKPICards() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="mb-2 h-3 w-20 rounded bg-neutral-200" />
          <div className="h-6 w-24 rounded bg-neutral-200" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart() {
  return (
    <div className="animate-pulse rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="mb-4 h-4 w-40 rounded bg-neutral-200" />
      <div className="flex items-end justify-between gap-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="h-24 w-3 rounded bg-neutral-200" />
            <div className="h-3 w-6 rounded bg-neutral-200" />
          </div>
        ))}
      </div>
    </div>
  );
}
