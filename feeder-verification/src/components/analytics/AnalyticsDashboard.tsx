"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download, FlaskConical, Layers3, LayoutGrid, LineChart, RefreshCcw, ShieldCheck, Target, TimerReset, DollarSign, TrendingDown } from "lucide-react";
import { KPICards } from "./KPICards";
import { DurationTrendChart } from "./charts/DurationTrendChart";
import { MPNDonutChart } from "./charts/MPNDonutChart";
import { ScanVolumeChart } from "./charts/ScanVolumeChart";
import { useAnalyticsStore } from "@/store/useAnalyticsStore";
import type {
  AnalyticsRole,
  AnalyticsTab,
  AlternateAdoption,
  AuditEvent,
  CostMetrics,
  DataQualityMetrics,
  DurationDataPoint,
  FeederErrorSummary,
  HealthSummary,
  LineUtilization,
  OperatorStats,
  OverviewKPIs,
  ShiftStats,
  SpliceStats,
} from "@/lib/analytics/types";
import { canViewExport, canViewHealthPanel, canViewCostMetrics, canViewDataQuality, formatRoleLabel, tabAllowedForRole } from "@/lib/analytics/access";
import { LoadingCard, ErrorCard, EmptyStateCard, LoadingMetricTable } from "./utils";

type ApiResponse<T> = { data: T } | { kpis: T } | { stats: T } | { summary: T } | { health: T } | T;

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function SummaryBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-neutral-900">{value}</div>
    </div>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-2 text-xs font-medium transition ${active ? "border-blue-600 bg-blue-50 text-blue-700" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"}`}
    >
      {children}
    </button>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        {subtitle ? <p className="text-xs text-neutral-500">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function MetricTable<T extends object>({ rows, columns, emptyMessage }: { rows: T[]; columns: Array<{ key: keyof T; label: string; formatter?: (value: T[keyof T], row: T) => React.ReactNode }>; emptyMessage: string }) {
  if (rows.length === 0) {
    return <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">{emptyMessage}</div>;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-neutral-200">
      <table className="min-w-full divide-y divide-neutral-200 text-sm">
        <thead className="bg-neutral-50 text-left text-xs uppercase tracking-[0.2em] text-neutral-500">
          <tr>
            {columns.map((column) => (
              <th key={String(column.key)} className="px-3 py-3 font-semibold">{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 bg-white text-neutral-700">
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={String(column.key)} className="px-3 py-3 align-top">
                  {column.formatter ? column.formatter((row as any)[column.key], row) : String((row as any)[column.key] ?? "-")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AnalyticsDashboard({ role }: { role: AnalyticsRole }) {
  const { activeTab, days, selectedBomHeaderId, setActiveTab, setDays, setSelectedBomHeaderId } = useAnalyticsStore();

  const visibleTabs = useMemo(() => {
    const base: Array<{ id: AnalyticsTab; label: string; icon: React.ReactNode }> = [
      { id: "overview", label: "Overview", icon: <LayoutGrid className="h-4 w-4" /> },
      { id: "operators", label: "Operators", icon: <BarChart3 className="h-4 w-4" /> },
      { id: "feeders", label: "Feeders", icon: <Target className="h-4 w-4" /> },
      { id: "shifts", label: "Shifts", icon: <TimerReset className="h-4 w-4" /> },
      { id: "lines", label: "Lines", icon: <Layers3 className="h-4 w-4" /> },
      { id: "alternates", label: "Alternates", icon: <FlaskConical className="h-4 w-4" /> },
      { id: "splicing", label: "Splicing", icon: <RefreshCcw className="h-4 w-4" /> },
      { id: "audit", label: "Audit Trail", icon: <ShieldCheck className="h-4 w-4" /> },
      { id: "realtime", label: "Realtime", icon: <LineChart className="h-4 w-4" /> },
      // New enhanced tabs
      canViewCostMetrics(role) ? { id: "cost", label: "Cost Analysis", icon: <DollarSign className="h-4 w-4" /> } : null,
      canViewDataQuality(role) ? { id: "dataQuality", label: "Data Quality", icon: <TrendingDown className="h-4 w-4" /> } : null,
      { id: "health", label: "System Health", icon: <TimerReset className="h-4 w-4" /> },
      { id: "export", label: "Export", icon: <Download className="h-4 w-4" /> },
    ].filter(Boolean) as Array<{ id: AnalyticsTab; label: string; icon: React.ReactNode }>;

    return base.filter((tab) => tabAllowedForRole(tab.id, role));
  }, [role]);

  const selectedTab = visibleTabs.some((tab) => tab.id === activeTab) ? activeTab : visibleTabs[0]?.id ?? "overview";

  const overviewQuery = useQuery<{ kpis: OverviewKPIs }>({
    queryKey: ["analytics", "overview", role, days],
    queryFn: () => fetchJson(`/api/analytics/overview?days=${days}`),
    staleTime: 60_000,
  });

  const durationQuery = useQuery<{ data: DurationDataPoint[] }>({
    queryKey: ["analytics", "duration", role, days],
    queryFn: () => fetchJson(`/api/analytics/duration?days=${days}`),
    staleTime: 300_000,
    enabled: selectedTab === "overview" || selectedTab === "operators" || selectedTab === "health",
  });

  const operatorQuery = useQuery<{ data: OperatorStats[] }>({
    queryKey: ["analytics", "operators", role, days],
    queryFn: () => fetchJson(`/api/analytics/operators?days=${days}`),
    staleTime: 300_000,
    enabled: selectedTab === "operators",
  });

  const feederQuery = useQuery<{ data: FeederErrorSummary[] }>({
    queryKey: ["analytics", "feeders", role, days, selectedBomHeaderId],
    queryFn: () => fetchJson(`/api/analytics/feeders?days=${days}${selectedBomHeaderId ? `&bomHeaderId=${selectedBomHeaderId}` : ""}`),
    staleTime: 300_000,
    enabled: selectedTab === "feeders",
  });

  const shiftQuery = useQuery<{ data: ShiftStats[] }>({
    queryKey: ["analytics", "shifts", role, days],
    queryFn: () => fetchJson(`/api/analytics/shifts?days=${days}`),
    staleTime: 300_000,
    enabled: selectedTab === "shifts",
  });

  const lineQuery = useQuery<{ data: LineUtilization[] }>({
    queryKey: ["analytics", "lines", role, days],
    queryFn: () => fetchJson(`/api/analytics/lines?days=${days}`),
    staleTime: 300_000,
    enabled: selectedTab === "lines",
  });

  const alternateQuery = useQuery<{ data: AlternateAdoption[] }>({
    queryKey: ["analytics", "alternates", role, days, selectedBomHeaderId],
    queryFn: () => fetchJson(`/api/analytics/alternates?days=${days}${selectedBomHeaderId ? `&bomHeaderId=${selectedBomHeaderId}` : ""}`),
    staleTime: 300_000,
    enabled: selectedTab === "alternates" || selectedTab === "overview",
  });

  const spliceQuery = useQuery<{ data: SpliceStats[] }>({
    queryKey: ["analytics", "splicing", role, days],
    queryFn: () => fetchJson(`/api/analytics/splicing?days=${days}`),
    staleTime: 300_000,
    enabled: selectedTab === "splicing",
  });

  const auditQuery = useQuery<{ data: AuditEvent[] }>({
    queryKey: ["analytics", "audit", role, days],
    queryFn: () => fetchJson(`/api/analytics/audit?limit=100`),
    staleTime: 300_000,
    enabled: selectedTab === "audit",
  });

  const healthQuery = useQuery<{ health: HealthSummary }>({
    queryKey: ["analytics", "health", role],
    queryFn: () => fetchJson(`/api/analytics/health`),
    staleTime: 300_000,
    enabled: selectedTab === "health" && canViewHealthPanel(role),
  });

  const exportQuery = useQuery<{ bundle: unknown }>({
    queryKey: ["analytics", "export", role, days],
    queryFn: () => fetchJson(`/api/analytics/export?days=${days}`),
    staleTime: 0,
    enabled: selectedTab === "export" && canViewExport(role),
  });

  const costQuery = useQuery<{ metrics: CostMetrics }>({
    queryKey: ["analytics", "cost", role, days, selectedBomHeaderId],
    queryFn: () => fetchJson(`/api/analytics/cost?days=${days}${selectedBomHeaderId ? `&bomHeaderId=${selectedBomHeaderId}` : ""}`),
    staleTime: 300_000,
    enabled: selectedTab === "cost" && canViewCostMetrics(role),
  });

  const dataQualityQuery = useQuery<{ metrics: DataQualityMetrics }>({
    queryKey: ["analytics", "dataQuality", role],
    queryFn: () => fetchJson(`/api/analytics/dataQuality`),
    staleTime: 600_000,
    enabled: selectedTab === "dataQuality" && canViewDataQuality(role),
  });

  const operatorRows = operatorQuery.data?.data ?? [];
  const feederRows = feederQuery.data?.data ?? [];
  const shiftRows = shiftQuery.data?.data ?? [];
  const lineRows = lineQuery.data?.data ?? [];
  const alternateRows = alternateQuery.data?.data ?? [];
  const spliceRows = spliceQuery.data?.data ?? [];
  const auditRows = auditQuery.data?.data ?? [];
  const health = healthQuery.data?.health;

  return (
    <div className="space-y-6">
      <header className="rounded-3xl border border-neutral-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_100%)] p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-700">
              Analytics · {formatRoleLabel(role)}
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-900">SMT Feeder Verification Analytics</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
              Read-only performance insights for changeovers, scans, splices, feeders, operators, and system health.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[7, 14, 30, 90].map((candidateDays) => (
              <button
                key={candidateDays}
                type="button"
                onClick={() => setDays(candidateDays)}
                className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${days === candidateDays ? "border-blue-600 bg-blue-50 text-blue-700" : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300 hover:text-neutral-900"}`}
              >
                {candidateDays}d
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {visibleTabs.map((tab) => (
            <TabButton key={tab.id} active={selectedTab === tab.id} onClick={() => setActiveTab(tab.id)}>
              <span className="inline-flex items-center gap-2">
                {tab.icon}
                {tab.label}
              </span>
            </TabButton>
          ))}
        </div>

        <div className="mt-5 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <SummaryBadge label="Window" value={`${days} days`} />
          <SummaryBadge label="Scope" value={role === "operator" ? "Own changeovers" : "All operators"} />
          <SummaryBadge label="Feeders" value={selectedBomHeaderId || "Latest BOM"} />
          <SummaryBadge label="Realtime" value="10s refresh" />
          <SummaryBadge label="Cache" value="60s / 5m" />
          <SummaryBadge label="Access" value={formatRoleLabel(role)} />
        </div>
      </header>

      {selectedTab === "overview" ? (
        <div className="space-y-6">
          {overviewQuery.data?.kpis ? <KPICards kpis={overviewQuery.data.kpis} /> : <div className="rounded-3xl border border-dashed border-neutral-300 bg-white p-8 text-sm text-neutral-500">Loading overview metrics...</div>}

          <div className="grid gap-6 xl:grid-cols-2">
            {durationQuery.data?.data ? <DurationTrendChart data={durationQuery.data.data} /> : <div className="rounded-3xl border border-dashed border-neutral-300 bg-white p-8 text-sm text-neutral-500">Loading duration chart...</div>}
            <ScanVolumeChart />
            {alternateRows.length > 0 ? <MPNDonutChart data={alternateRows as unknown as any} /> : <SectionCard title="Primary vs alternate MPN usage" subtitle="This window has no MPN usage data yet."><div className="text-sm text-neutral-500">Run scans to populate adoption data.</div></SectionCard>}
          </div>

          {canViewHealthPanel(role) ? (
            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
              <SectionCard title="System health" subtitle="Admin-only summary">
                {healthQuery.data?.health ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <SummaryBadge label="Changeovers" value={health?.totalChangeovers.toLocaleString() ?? "0"} />
                    <SummaryBadge label="Active" value={health?.activeChangeovers.toLocaleString() ?? "0"} />
                    <SummaryBadge label="Operators" value={health?.totalOperators.toLocaleString() ?? "0"} />
                    <SummaryBadge label="Scans today" value={health?.totalScansToday.toLocaleString() ?? "0"} />
                    <SummaryBadge label="Splices today" value={health?.totalSplicesToday.toLocaleString() ?? "0"} />
                  </div>
                ) : (
                  <div className="text-sm text-neutral-500">Loading health summary...</div>
                )}
              </SectionCard>
            </div>
          ) : null}
        </div>
      ) : null}

      {selectedTab === "operators" ? (
        <SectionCard title="Operator performance" subtitle="Average duration, scan volume, failures, and accuracy by operator">
          <MetricTable
            rows={operatorRows}
            emptyMessage="No operator data for this window."
            columns={[
              { key: "operatorName", label: "Operator" },
              { key: "employeeId", label: "Employee ID" },
              { key: "changeoversTotal", label: "Changeovers" },
              { key: "avgDurationMinutes", label: "Avg Duration", formatter: (value) => `${value as number} min` },
              { key: "totalScans", label: "Scans" },
              { key: "alternateScans", label: "Alternate" },
              { key: "scanFailures", label: "Failures" },
              { key: "accuracyPct", label: "Accuracy", formatter: (value) => `${value as number}%` },
            ]}
          />
        </SectionCard>
      ) : null}

      {selectedTab === "feeders" ? (
        <div className="space-y-4">
          <SectionCard title="Top feeder error hotspots" subtitle="Feeders with the highest failure counts">
            <MetricTable
              rows={feederRows}
              emptyMessage="No feeder hotspot data for this window."
              columns={[
                { key: "feederNumber", label: "Feeder" },
                { key: "bomNumber", label: "BOM" },
                { key: "description", label: "Description" },
                { key: "packageDesc", label: "Package" },
                { key: "totalErrors", label: "Errors" },
                { key: "totalScans", label: "Scans" },
                { key: "errorRate", label: "Error Rate", formatter: (value) => `${value as number}%` },
              ]}
            />
          </SectionCard>
        </div>
      ) : null}

      {selectedTab === "shifts" ? (
        <SectionCard title="Shift comparison" subtitle="MORNING vs EVENING vs NIGHT performance">
          <MetricTable
            rows={shiftRows}
            emptyMessage="No shift comparison data for this window."
            columns={[
              { key: "shift", label: "Shift" },
              { key: "changeovers", label: "Changeovers" },
              { key: "avgDurationMinutes", label: "Avg Duration", formatter: (value) => `${value as number} min` },
              { key: "accuracyPct", label: "Accuracy", formatter: (value) => `${value as number}%` },
              { key: "alternateUsageRate", label: "Alternate Usage", formatter: (value) => `${value as number}%` },
              { key: "spliceCount", label: "Splices" },
            ]}
          />
        </SectionCard>
      ) : null}

      {selectedTab === "lines" ? (
        <SectionCard title="Line utilization" subtitle="Changeovers per line per day">
          <MetricTable
            rows={lineRows}
            emptyMessage="No line utilization data for this window."
            columns={[
              { key: "workDate", label: "Date", formatter: (value) => new Date(String(value)).toLocaleDateString() },
              { key: "lineNumber", label: "Line" },
              { key: "changeovers", label: "Changeovers" },
              { key: "avgDurationMinutes", label: "Avg Duration", formatter: (value) => `${value as number} min` },
            ]}
          />
        </SectionCard>
      ) : null}

      {selectedTab === "alternates" ? (
        <SectionCard title="BOM alternate adoption" subtitle="Primary vs alternate MPN usage by feeder">
          <MetricTable
            rows={alternateRows}
            emptyMessage="No alternate usage records for this window."
            columns={[
              { key: "bomNumber", label: "BOM" },
              { key: "feederNumber", label: "Feeder" },
              { key: "mpnType", label: "Type" },
              { key: "make", label: "Make" },
              { key: "mpn", label: "MPN" },
              { key: "timesUsed", label: "Times Used" },
              { key: "usagePct", label: "Usage", formatter: (value) => `${value as number}%` },
            ]}
          />
        </SectionCard>
      ) : null}

      {selectedTab === "splicing" ? (
        <SectionCard title="Splicing frequency" subtitle="Splice counts per feeder in the selected period">
          <MetricTable
            rows={spliceRows}
            emptyMessage="No splice activity for this window."
            columns={[
              { key: "feederNumber", label: "Feeder" },
              { key: "spliceCount", label: "Splice Count" },
              { key: "avgPerDay", label: "Avg / Day" },
              { key: "lastSpliced", label: "Last Spliced", formatter: (value) => (value ? new Date(String(value)).toLocaleString() : "-") },
            ]}
          />
        </SectionCard>
      ) : null}

      {selectedTab === "audit" ? (
        <SectionCard title="Audit trail" subtitle="Latest read-only event stream">
          <MetricTable
            rows={auditRows}
            emptyMessage="No audit records found."
            columns={[
              { key: "occurredAt", label: "Time", formatter: (value) => new Date(String(value)).toLocaleString() },
              { key: "eventType", label: "Event" },
              { key: "operatorName", label: "Operator" },
              { key: "employeeId", label: "Employee ID" },
              { key: "feederNumber", label: "Feeder" },
              { key: "summary", label: "Summary" },
            ]}
          />
        </SectionCard>
      ) : null}

      {selectedTab === "realtime" ? (
        <section className="space-y-4">
          <ScanVolumeChart />
        </section>
      ) : null}

      {selectedTab === "health" && canViewHealthPanel(role) ? (
        <SectionCard title="System health" subtitle="Admin-only overview of current system state">
          {healthQuery.data?.health ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <SummaryBadge label="Changeovers" value={health?.totalChangeovers.toLocaleString() ?? "0"} />
              <SummaryBadge label="Active changeovers" value={health?.activeChangeovers.toLocaleString() ?? "0"} />
              <SummaryBadge label="Operators" value={health?.totalOperators.toLocaleString() ?? "0"} />
              <SummaryBadge label="Scans today" value={health?.totalScansToday.toLocaleString() ?? "0"} />
              <SummaryBadge label="Splices today" value={health?.totalSplicesToday.toLocaleString() ?? "0"} />
              <SummaryBadge label="Last refresh" value={health?.latestRefreshAt ? new Date(health.latestRefreshAt).toLocaleString() : "Never"} />
            </div>
          ) : (
            <div className="text-sm text-neutral-500">Loading health summary...</div>
          )}
        </SectionCard>
      ) : null}

      {selectedTab === "export" && canViewExport(role) ? (
        <SectionCard title="Analytics export" subtitle="Generated from read-only analytics APIs">
          {exportQuery.data ? (
            <pre className="max-h-[32rem] overflow-auto rounded-2xl bg-neutral-950 p-4 text-xs leading-6 text-neutral-100">{JSON.stringify(exportQuery.data, null, 2)}</pre>
          ) : exportQuery.isLoading ? (
            <LoadingCard title="Analytics Export" subtitle="Generating complete analytics bundle..." />
          ) : exportQuery.error ? (
            <ErrorCard title="Export Failed" error={String(exportQuery.error)} onRetry={() => exportQuery.refetch()} />
          ) : (
            <EmptyStateCard title="Analytics Export" message="No export data available. Try a different date range." />
          )}
        </SectionCard>
      ) : null}

      {selectedTab === "cost" && canViewCostMetrics(role) ? (
        <div className="space-y-4">
          {costQuery.isLoading ? (
            <LoadingCard title="Cost Analysis" subtitle="Calculating BOM component costs..." />
          ) : costQuery.error ? (
            <ErrorCard title="Cost Analysis Failed" error={String(costQuery.error)} onRetry={() => costQuery.refetch()} />
          ) : costQuery.data?.metrics ? (
            <>
              <SectionCard title="Cost Analysis" subtitle={`BOM: ${costQuery.data.metrics.bomNumber}`}>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <SummaryBadge label="Component Cost" value={`$${costQuery.data.metrics.totalComponentCost.toFixed(2)}`} />
                  <SummaryBadge label="Labor Cost" value={`$${costQuery.data.metrics.totalLaborCost.toFixed(2)}`} />
                  <SummaryBadge label="Waste Cost" value={`$${costQuery.data.metrics.wasteCost.toFixed(2)}`} />
                  <SummaryBadge label="Cost / Unit" value={`$${costQuery.data.metrics.costPerUnit.toFixed(2)}`} />
                </div>
              </SectionCard>

              <SectionCard title="Component Breakdown">
                <MetricTable
                  rows={costQuery.data.metrics.componentBreakdown}
                  emptyMessage="No components in this BOM."
                  columns={[
                    { key: "feederNumber", label: "Feeder" },
                    { key: "description", label: "Description" },
                    { key: "mpn", label: "MPN" },
                    { key: "unitCost", label: "Unit Cost", formatter: (value) => `$${(value as number).toFixed(2)}` },
                    { key: "quantity", label: "Qty" },
                    { key: "totalCost", label: "Total", formatter: (value) => `$${(value as number).toFixed(2)}` },
                  ]}
                />
              </SectionCard>
            </>
          ) : (
            <EmptyStateCard title="Cost Analysis" message="No cost data available for the selected BOM. Select a BOM to view cost analysis." />
          )}
        </div>
      ) : null}

      {selectedTab === "dataQuality" && canViewDataQuality(role) ? (
        <div className="space-y-4">
          {dataQualityQuery.isLoading ? (
            <LoadingCard title="Data Quality Metrics" subtitle="Analyzing data completeness and validation..." />
          ) : dataQualityQuery.error ? (
            <ErrorCard title="Data Quality Analysis Failed" error={String(dataQualityQuery.error)} onRetry={() => dataQualityQuery.refetch()} />
          ) : dataQualityQuery.data?.metrics ? (
            <>
              <SectionCard title="Data Quality Dashboard" subtitle="System-wide data integrity metrics">
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                  <SummaryBadge label="Total Records" value={dataQualityQuery.data.metrics.totalRecords.toLocaleString()} />
                  <SummaryBadge label="Completeness" value={`${dataQualityQuery.data.metrics.completenessPercentage.toFixed(1)}%`} />
                  <SummaryBadge label="Missing Data" value={dataQualityQuery.data.metrics.missingDataRecords.toLocaleString()} />
                  <SummaryBadge label="Validation Errors" value={dataQualityQuery.data.metrics.validationErrors.toLocaleString()} />
                  <SummaryBadge label="Last Validated" value={new Date(dataQualityQuery.data.metrics.lastValidatedAt).toLocaleDateString()} />
                </div>
              </SectionCard>

              <SectionCard title="Data Health Status">
                <div className="space-y-3">
                  {dataQualityQuery.data.metrics.completenessPercentage >= 95 ? (
                    <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
                      <p className="text-sm font-medium text-green-900">✓ Excellent data quality - {dataQualityQuery.data.metrics.completenessPercentage.toFixed(1)}% complete</p>
                      <p className="mt-1 text-xs text-green-700">System is operating within normal parameters with minimal data gaps.</p>
                    </div>
                  ) : dataQualityQuery.data.metrics.completenessPercentage >= 85 ? (
                    <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4">
                      <p className="text-sm font-medium text-yellow-900">⚠ Good data quality - {dataQualityQuery.data.metrics.completenessPercentage.toFixed(1)}% complete</p>
                      <p className="mt-1 text-xs text-yellow-700">Some data gaps detected. Monitor for improvements.</p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                      <p className="text-sm font-medium text-red-900">✗ Poor data quality - {dataQualityQuery.data.metrics.completenessPercentage.toFixed(1)}% complete</p>
                      <p className="mt-1 text-xs text-red-700">Significant data gaps detected. Immediate action recommended.</p>
                    </div>
                  )}
                </div>
              </SectionCard>
            </>
          ) : (
            <EmptyStateCard title="Data Quality" message="No data quality metrics available. Check system status." />
          )}
        </div>
      ) : null}
    </div>
  );
}
