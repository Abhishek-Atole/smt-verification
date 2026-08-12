import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type {
  AnalyticsRange,
  AlternateAdoption,
  AuditEvent,
  DurationDataPoint,
  FeederErrorSummary,
  HealthSummary,
  LineUtilization,
  MPNUsage,
  OperatorStats,
  OverviewKPIs,
  ScanVolumePoint,
  ShiftStats,
  SpliceStats,
} from "./types";

const COMPLETED_STATUSES = ["verified", "splicing", "complete"] as const;

function toNumber(value: bigint | number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return Number(value);
}

function safeRate(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 10000) / 100;
}

function rangeClause(range: AnalyticsRange, column = "started_at") {
  return Prisma.sql`${Prisma.raw(column)} >= ${range.from} AND ${Prisma.raw(column)} <= ${range.to}`;
}

function operatorClause(operatorId: string | null) {
  return operatorId ? Prisma.sql`AND c.operator_id = ${operatorId}::uuid` : Prisma.empty;
}

function operatorClauseForAlias(operatorId: string | null, alias = "c") {
  return operatorId ? Prisma.sql`AND ${Prisma.raw(`${alias}.operator_id`)} = ${operatorId}::uuid` : Prisma.empty;
}

export async function getOverviewKPIs(operatorId: string | null, range: AnalyticsRange): Promise<OverviewKPIs> {
  const completionFilter = Prisma.sql`AND c.status IN ('verified', 'splicing', 'complete')`;
  const scope = operatorClause(operatorId);
  const currentRange = Prisma.sql`c.started_at >= ${range.from} AND c.started_at <= ${range.to}`;
  const previousSpanMs = Math.max(range.to.getTime() - range.from.getTime(), 1);
  const previousRange = {
    from: new Date(range.from.getTime() - previousSpanMs),
    to: range.from,
  };

  const [currentChangeovers, previousChangeovers, scanCounts, firstPassCounts, alternateCounts, currentSplices, activeOperators, durationRow] = await Promise.all([
    prisma.$queryRaw<Array<{ total_changeovers: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT c.id) AS total_changeovers
      FROM changeovers c
      WHERE ${currentRange}
      ${scope}
      ${completionFilter}
    `),
    prisma.$queryRaw<Array<{ total_changeovers: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT c.id) AS total_changeovers
      FROM changeovers c
      WHERE c.started_at >= ${previousRange.from} AND c.started_at <= ${previousRange.to}
      ${scope}
      ${completionFilter}
    `),
    prisma.$queryRaw<Array<{ ok_count: bigint; fail_count: bigint }>>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE al.event_type = 'scan_ok') AS ok_count,
        COUNT(*) FILTER (WHERE al.event_type = 'scan_fail') AS fail_count
      FROM audit_log al
      JOIN changeovers c ON c.id = al.changeover_id
      WHERE al.occurred_at >= ${range.from}
        AND al.occurred_at <= ${range.to}
        ${operatorClauseForAlias(operatorId)}
        AND al.event_type IN ('scan_ok', 'scan_fail')
    `),
    prisma.$queryRaw<Array<{ total_changeovers: bigint; first_pass_changeovers: bigint }>>(Prisma.sql`
      SELECT
        COUNT(DISTINCT c.id) AS total_changeovers,
        COUNT(DISTINCT c.id) FILTER (
          WHERE NOT EXISTS (
            SELECT 1
            FROM audit_log al_fail
            WHERE al_fail.changeover_id = c.id
              AND al_fail.event_type = 'scan_fail'
          )
        ) AS first_pass_changeovers
      FROM changeovers c
      WHERE ${currentRange}
      ${scope}
      ${completionFilter}
    `),
    prisma.$queryRaw<Array<{ total_scans: bigint; alternate_scans: bigint }>>(Prisma.sql`
      SELECT
        COUNT(*) AS total_scans,
        COUNT(*) FILTER (WHERE vs.is_alternate = true) AS alternate_scans
      FROM verification_scans vs
      JOIN changeovers c ON c.id = vs.changeover_id
      WHERE vs.scanned_at >= ${range.from}
        AND vs.scanned_at <= ${range.to}
        ${operatorClauseForAlias(operatorId)}
    `),
    prisma.$queryRaw<Array<{ total_splices: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS total_splices
      FROM splice_records sr
      JOIN changeovers c ON c.id = sr.changeover_id
      WHERE sr.spliced_at >= CURRENT_DATE
        AND sr.spliced_at < CURRENT_DATE + INTERVAL '1 day'
        ${operatorClauseForAlias(operatorId)}
    `),
    prisma.$queryRaw<Array<{ active_operators: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT c.operator_id) AS active_operators
      FROM changeovers c
      WHERE c.started_at >= ${range.from}
        AND c.started_at <= ${range.to}
        AND c.status = 'in_progress'
        ${operatorClause(operatorId)}
    `),
    prisma.$queryRaw<Array<{ avg_duration_minutes: number | null }>>(Prisma.sql`
      SELECT AVG(EXTRACT(EPOCH FROM (c.completed_at - c.started_at)) / 60.0) AS avg_duration_minutes
      FROM changeovers c
      WHERE ${currentRange}
        ${scope}
        ${completionFilter}
        AND c.completed_at IS NOT NULL
    `),
  ]);

  const currentTotal = toNumber(currentChangeovers[0]?.total_changeovers);
  const previousTotal = toNumber(previousChangeovers[0]?.total_changeovers);
  const okScans = toNumber(scanCounts[0]?.ok_count);
  const failScans = toNumber(scanCounts[0]?.fail_count);
  const totalScans = okScans + failScans;
  const firstPassTotal = toNumber(firstPassCounts[0]?.total_changeovers);
  const firstPassCount = toNumber(firstPassCounts[0]?.first_pass_changeovers);
  const totalAltScans = toNumber(alternateCounts[0]?.alternate_scans);
  const totalRecordedScans = toNumber(alternateCounts[0]?.total_scans);
  const scanFailRate = safeRate(failScans, totalScans);
  const firstPassRate = safeRate(firstPassCount, Math.max(firstPassTotal, 1));

  return {
    totalChangeovers: currentTotal,
    avgDurationMinutes: Math.round(Number(durationRow[0]?.avg_duration_minutes ?? 0)),
    firstPassRate,
    alternateUsageRate: safeRate(totalAltScans, Math.max(totalRecordedScans, 1)),
    totalScansToday: totalScans,
    scanFailRate,
    totalSplicesToday: toNumber(currentSplices[0]?.total_splices),
    activeOperators: toNumber(activeOperators[0]?.active_operators),
    trends: {
      changeovers: previousTotal === 0 ? 0 : Math.round(((currentTotal - previousTotal) / previousTotal) * 100),
      duration: 0,
      firstPassRate: 0,
      scanFailRate: 0,
    },
  };
}

export async function getDurationTrend(operatorId: string | null, days = 30): Promise<DurationDataPoint[]> {
  const start = new Date();
  start.setDate(start.getDate() - days);

  const rows = await prisma.$queryRaw<Array<{
    day: Date;
    avg_duration_minutes: number | null;
    min_duration_minutes: number | null;
    max_duration_minutes: number | null;
    job_count: bigint;
  }>>(Prisma.sql`
    SELECT
      DATE_TRUNC('day', c.started_at) AS day,
      AVG(EXTRACT(EPOCH FROM (c.completed_at - c.started_at)) / 60.0) AS avg_duration_minutes,
      MIN(EXTRACT(EPOCH FROM (c.completed_at - c.started_at)) / 60.0) AS min_duration_minutes,
      MAX(EXTRACT(EPOCH FROM (c.completed_at - c.started_at)) / 60.0) AS max_duration_minutes,
      COUNT(*) AS job_count
    FROM changeovers c
    WHERE c.started_at >= ${start}
      AND c.completed_at IS NOT NULL
      AND c.status IN ('verified', 'splicing', 'complete')
      ${operatorClause(operatorId)}
    GROUP BY DATE_TRUNC('day', c.started_at)
    ORDER BY day ASC
  `);

  return rows.map((row) => ({
    date: row.day.toISOString(),
    avgDurationMinutes: Math.round(Number(row.avg_duration_minutes ?? 0)),
    minDurationMinutes: Math.round(Number(row.min_duration_minutes ?? 0)),
    maxDurationMinutes: Math.round(Number(row.max_duration_minutes ?? 0)),
    count: toNumber(row.job_count),
  }));
}

export async function getOperatorStats(range: AnalyticsRange): Promise<OperatorStats[]> {
  const rows = await prisma.$queryRaw<Array<{
    operator_id: string;
    operator_name: string;
    employee_id: string;
    changeovers_total: bigint;
    avg_duration_minutes: number | null;
    total_scans: bigint;
    alternate_scans: bigint;
    scan_failures: bigint;
    accuracy_pct: number | null;
  }>>(Prisma.sql`
    SELECT
      u.id AS operator_id,
      u.name AS operator_name,
      u.employee_id,
      COUNT(DISTINCT c.id) AS changeovers_total,
      AVG(EXTRACT(EPOCH FROM (c.completed_at - c.started_at)) / 60.0) AS avg_duration_minutes,
      COUNT(DISTINCT vs.id) AS total_scans,
      COUNT(DISTINCT vs.id) FILTER (WHERE vs.is_alternate = true) AS alternate_scans,
      COUNT(DISTINCT al_fail.id) AS scan_failures,
      CASE
        WHEN COUNT(DISTINCT vs.id) + COUNT(DISTINCT al_fail.id) = 0 THEN 100
        ELSE ROUND(
          COUNT(DISTINCT vs.id)::numeric / NULLIF(COUNT(DISTINCT vs.id) + COUNT(DISTINCT al_fail.id), 0) * 100,
          2
        )
      END AS accuracy_pct
    FROM users u
    JOIN changeovers c ON c.operator_id = u.id
    LEFT JOIN verification_scans vs ON vs.changeover_id = c.id
    LEFT JOIN audit_log al_fail ON al_fail.changeover_id = c.id AND al_fail.event_type = 'scan_fail'
    WHERE u.role = 'operator'
      AND c.started_at >= ${range.from}
      AND c.started_at <= ${range.to}
      AND c.status IN ('verified', 'splicing', 'complete')
    GROUP BY u.id, u.name, u.employee_id
    ORDER BY changeovers_total DESC, avg_duration_minutes ASC
  `);

  return rows.map((row) => ({
    operatorId: row.operator_id,
    operatorName: row.operator_name,
    employeeId: row.employee_id,
    changeoversTotal: toNumber(row.changeovers_total),
    avgDurationMinutes: Math.round(Number(row.avg_duration_minutes ?? 0)),
    totalScans: toNumber(row.total_scans),
    alternateScans: toNumber(row.alternate_scans),
    scanFailures: toNumber(row.scan_failures),
    accuracyPct: Math.round(Number(row.accuracy_pct ?? 100)),
    firstPassRate: safeRate(Math.max(toNumber(row.changeovers_total) - toNumber(row.scan_failures), 0), Math.max(toNumber(row.changeovers_total), 1)),
  }));
}

export async function getFeederErrorSummary(operatorId: string | null, days = 30, bomHeaderId?: string | null): Promise<FeederErrorSummary[]> {
  const start = new Date();
  start.setDate(start.getDate() - days);

  const bomFilter = bomHeaderId ? Prisma.sql`AND bh.id = ${bomHeaderId}::uuid` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{
    feeder_number: string | null;
    description: string | null;
    package_desc: string | null;
    bom_number: string;
    total_errors: bigint;
    total_scans: bigint;
  }>>(Prisma.sql`
    SELECT
      COALESCE(bli.feeder_number, al.payload->>'feeder') AS feeder_number,
      MAX(bli.description) AS description,
      MAX(bli.package_desc) AS package_desc,
      bh.bom_number,
      COUNT(*) FILTER (WHERE al.event_type = 'scan_fail') AS total_errors,
      COUNT(*) FILTER (WHERE al.event_type = 'scan_ok') AS total_scans
    FROM audit_log al
    JOIN changeovers c ON c.id = al.changeover_id
    JOIN bom_headers bh ON bh.id = c.bom_header_id
    LEFT JOIN bom_line_items bli ON bli.bom_header_id = bh.id AND bli.feeder_number = al.payload->>'feeder'
    WHERE al.occurred_at >= ${start}
      AND al.event_type IN ('scan_fail', 'scan_ok')
      ${operatorClauseForAlias(operatorId)}
      ${bomFilter}
    GROUP BY COALESCE(bli.feeder_number, al.payload->>'feeder'), bh.bom_number
    ORDER BY total_errors DESC, total_scans DESC
    LIMIT 50
  `);

  return rows.map((row, index) => {
    const errors = toNumber(row.total_errors);
    const scans = toNumber(row.total_scans) + errors;
    return {
      feederNumber: row.feeder_number ?? "UNKNOWN",
      description: row.description,
      packageDesc: row.package_desc,
      bomNumber: row.bom_number,
      totalErrors: errors,
      totalScans: scans,
      errorRate: safeRate(errors, Math.max(scans, 1)),
      trend: index === 0 ? "up" : errors === 0 ? "stable" : "down",
    };
  });
}

export async function getShiftStats(operatorId: string | null, range: AnalyticsRange): Promise<ShiftStats[]> {
  const rows = await prisma.$queryRaw<Array<{
    shift: string | null;
    changeovers: bigint;
    avg_duration_minutes: number | null;
    alternate_usage_rate: number | null;
    splice_count: bigint;
    total_scans: bigint;
    scan_failures: bigint;
  }>>(Prisma.sql`
    SELECT
      COALESCE(c.shift, 'UNSPECIFIED') AS shift,
      COUNT(DISTINCT c.id) AS changeovers,
      AVG(EXTRACT(EPOCH FROM (c.completed_at - c.started_at)) / 60.0) AS avg_duration_minutes,
      CASE
        WHEN COUNT(DISTINCT vs.id) = 0 THEN 0
        ELSE ROUND(COUNT(DISTINCT vs.id) FILTER (WHERE vs.is_alternate = true)::numeric / COUNT(DISTINCT vs.id) * 100, 2)
      END AS alternate_usage_rate,
      COUNT(DISTINCT sr.id) AS splice_count,
      COUNT(DISTINCT vs.id) AS total_scans,
      COUNT(DISTINCT al_fail.id) AS scan_failures
    FROM changeovers c
    LEFT JOIN verification_scans vs ON vs.changeover_id = c.id
    LEFT JOIN splice_records sr ON sr.changeover_id = c.id
    LEFT JOIN audit_log al_fail ON al_fail.changeover_id = c.id AND al_fail.event_type = 'scan_fail'
    WHERE c.started_at >= ${range.from}
      AND c.started_at <= ${range.to}
      AND c.status IN ('verified', 'splicing', 'complete')
      ${operatorClause(operatorId)}
    GROUP BY COALESCE(c.shift, 'UNSPECIFIED')
    ORDER BY changeovers DESC
  `);

  return rows.map((row) => ({
    shift: (row.shift ?? "UNSPECIFIED") as ShiftStats["shift"],
    changeovers: toNumber(row.changeovers),
    avgDurationMinutes: Math.round(Number(row.avg_duration_minutes ?? 0)),
    accuracyPct: safeRate(toNumber(row.total_scans), Math.max(toNumber(row.total_scans) + toNumber(row.scan_failures), 1)),
    alternateUsageRate: Math.round(Number(row.alternate_usage_rate ?? 0)),
    spliceCount: toNumber(row.splice_count),
  }));
}

export async function getLineUtilization(operatorId: string | null, range: AnalyticsRange): Promise<LineUtilization[]> {
  const rows = await prisma.$queryRaw<Array<{
    line_number: string | null;
    work_date: Date;
    changeovers: bigint;
    avg_duration_minutes: number | null;
  }>>(Prisma.sql`
    SELECT
      COALESCE(c.line_number, 'UNSPECIFIED') AS line_number,
      DATE_TRUNC('day', c.started_at) AS work_date,
      COUNT(*) AS changeovers,
      AVG(EXTRACT(EPOCH FROM (c.completed_at - c.started_at)) / 60.0) AS avg_duration_minutes
    FROM changeovers c
    WHERE c.started_at >= ${range.from}
      AND c.started_at <= ${range.to}
      AND c.status IN ('verified', 'splicing', 'complete')
      ${operatorClause(operatorId)}
    GROUP BY COALESCE(c.line_number, 'UNSPECIFIED'), DATE_TRUNC('day', c.started_at)
    ORDER BY work_date ASC, line_number ASC
  `);

  return rows.map((row) => ({
    lineNumber: row.line_number ?? "UNSPECIFIED",
    workDate: row.work_date.toISOString(),
    changeovers: toNumber(row.changeovers),
    avgDurationMinutes: Math.round(Number(row.avg_duration_minutes ?? 0)),
  }));
}

export async function getMPNUsage(operatorId: string | null, range: AnalyticsRange, bomHeaderId?: string | null): Promise<MPNUsage[]> {
  const bomFilter = bomHeaderId ? Prisma.sql`AND bh.id = ${bomHeaderId}::uuid` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{
    mpn: string;
    make: string;
    rank: number;
    mpn_type: string;
    feeder_number: string;
    bom_number: string;
    times_used: bigint;
  }>>(Prisma.sql`
    SELECT
      ba.mpn,
      ba.make,
      ba.rank,
      CASE ba.rank
        WHEN 1 THEN 'PRIMARY'
        WHEN 2 THEN 'ALTERNATE_1'
        ELSE 'ALTERNATE_2'
      END AS mpn_type,
      bli.feeder_number,
      bh.bom_number,
      COUNT(vs.id) AS times_used
    FROM bom_alternatives ba
    JOIN bom_line_items bli ON bli.id = ba.line_item_id
    JOIN bom_headers bh ON bh.id = bli.bom_header_id
    LEFT JOIN verification_scans vs ON vs.alternative_id = ba.id
    LEFT JOIN changeovers c ON c.id = vs.changeover_id
    WHERE 1 = 1
      ${bomFilter}
      ${operatorClauseForAlias(operatorId)}
      AND (vs.scanned_at IS NULL OR (vs.scanned_at >= ${range.from} AND vs.scanned_at <= ${range.to}))
    GROUP BY ba.mpn, ba.make, ba.rank, bli.feeder_number, bh.bom_number
    ORDER BY bli.feeder_number ASC, ba.rank ASC
  `);

  const totalsByFeeder = new Map<string, number>();
  rows.forEach((row) => {
    totalsByFeeder.set(row.feeder_number, (totalsByFeeder.get(row.feeder_number) ?? 0) + toNumber(row.times_used));
  });

  return rows.map((row) => ({
    mpn: row.mpn,
    make: row.make,
    rank: row.rank,
    mpnType: row.mpn_type as AlternateAdoption["mpnType"],
    feederNumber: row.feeder_number,
    bomNumber: row.bom_number,
    timesUsed: toNumber(row.times_used),
    usagePct: safeRate(toNumber(row.times_used), Math.max(totalsByFeeder.get(row.feeder_number) ?? 1, 1)),
  }));
}

export async function getSpliceStats(operatorId: string | null, range: AnalyticsRange): Promise<SpliceStats[]> {
  const rows = await prisma.$queryRaw<Array<{
    feeder_number: string;
    splice_count: bigint;
    last_spliced: Date | null;
    days_span: number | null;
  }>>(Prisma.sql`
    SELECT
      bli.feeder_number,
      COUNT(*) AS splice_count,
      MAX(sr.spliced_at) AS last_spliced,
      NULLIF(EXTRACT(EPOCH FROM (MAX(sr.spliced_at) - MIN(sr.spliced_at))) / 86400.0, 0) AS days_span
    FROM splice_records sr
    JOIN changeovers c ON c.id = sr.changeover_id
    JOIN bom_line_items bli ON bli.id = sr.line_item_id
    WHERE sr.spliced_at >= ${range.from}
      AND sr.spliced_at <= ${range.to}
      ${operatorClauseForAlias(operatorId)}
    GROUP BY bli.feeder_number
    ORDER BY splice_count DESC, last_spliced DESC NULLS LAST
  `);

  return rows.map((row) => ({
    feederNumber: row.feeder_number,
    spliceCount: toNumber(row.splice_count),
    lastSpliced: row.last_spliced ? row.last_spliced.toISOString() : null,
    avgPerDay: row.days_span ? Math.round(toNumber(row.splice_count) / row.days_span) : toNumber(row.splice_count),
  }));
}

export async function getRealtimeScanVolume(operatorId: string | null): Promise<ScanVolumePoint[]> {
  const start = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await prisma.$queryRaw<Array<{
    bucket: Date;
    scan_ok: bigint;
    scan_fail: bigint;
  }>>(Prisma.sql`
    SELECT
      DATE_TRUNC('minute', al.occurred_at) -
        (EXTRACT(MINUTE FROM al.occurred_at)::int % 15) * INTERVAL '1 minute' AS bucket,
      COUNT(*) FILTER (WHERE al.event_type = 'scan_ok') AS scan_ok,
      COUNT(*) FILTER (WHERE al.event_type = 'scan_fail') AS scan_fail
    FROM audit_log al
    JOIN changeovers c ON c.id = al.changeover_id
    WHERE al.occurred_at >= ${start}
      AND al.event_type IN ('scan_ok', 'scan_fail')
      ${operatorClauseForAlias(operatorId)}
    GROUP BY bucket
    ORDER BY bucket ASC
  `);

  return rows.map((row) => ({
    timestamp: row.bucket.toISOString(),
    scanOk: toNumber(row.scan_ok),
    scanFail: toNumber(row.scan_fail),
    total: toNumber(row.scan_ok) + toNumber(row.scan_fail),
  }));
}

export async function getAuditTrail(operatorId: string | null, limit = 100): Promise<AuditEvent[]> {
  const auditScope = operatorId ? Prisma.sql`AND al.user_id = ${operatorId}::uuid` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    occurred_at: Date;
    event_type: string;
    operator_name: string;
    employee_id: string;
    changeover_id: string | null;
    payload: Prisma.JsonValue;
  }>>(Prisma.sql`
    SELECT
      al.id,
      al.occurred_at,
      al.event_type,
      u.name AS operator_name,
      u.employee_id,
      al.changeover_id,
      al.payload
    FROM audit_log al
    JOIN users u ON u.id = al.user_id
    WHERE 1 = 1
      ${auditScope}
    ORDER BY al.occurred_at DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => {
    const payload = (row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {}) as Record<string, unknown>;
    const feederNumber = typeof payload.feeder === "string" ? payload.feeder : null;
    return {
      id: row.id,
      occurredAt: row.occurred_at.toISOString(),
      eventType: row.event_type,
      operatorName: row.operator_name,
      employeeId: row.employee_id,
      changeoverId: row.changeover_id,
      feederNumber,
      summary: feederNumber ? `${row.event_type} on ${feederNumber}` : row.event_type,
      payload,
    };
  });
}

export async function getHealthSummary(operatorId: string | null): Promise<HealthSummary> {
  const [totalChangeovers, activeChangeovers, totalOperators, totalScansToday, totalSplicesToday, latestRefresh] = await Promise.all([
    prisma.changeover.count({
      where: operatorId ? { operatorId } : undefined,
    }),
    prisma.changeover.count({
      where: {
        status: "in_progress",
        ...(operatorId ? { operatorId } : {}),
      },
    }),
    prisma.user.count({
      where: { role: "operator", isActive: true },
    }),
    prisma.auditLog.count({
      where: {
        occurredAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        eventType: { in: ["scan_ok", "scan_fail"] },
      },
    }),
    prisma.spliceRecord.count({
      where: {
        splicedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
    prisma.auditLog.findFirst({
      where: { eventType: "analytics_refresh" },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    }),
  ]);

  return {
    totalChangeovers,
    activeChangeovers,
    totalOperators,
    totalScansToday,
    totalSplicesToday,
    latestRefreshAt: latestRefresh?.occurredAt ? latestRefresh.occurredAt.toISOString() : null,
  };
}

export async function getAnalyticsExportBundle(operatorId: string | null, range: AnalyticsRange): Promise<import("./types").AnalyticsExportBundle> {
  const [overview, durationTrend, operatorStats, feederErrors, shiftStats, lineUtilization, alternateAdoption, spliceStats, realtime, auditEvents, health] = await Promise.all([
    getOverviewKPIs(operatorId, range),
    getDurationTrend(operatorId, 30),
    getOperatorStats(range),
    getFeederErrorSummary(operatorId, 30),
    getShiftStats(operatorId, range),
    getLineUtilization(operatorId, range),
    getMPNUsage(operatorId, range),
    getSpliceStats(operatorId, range),
    getRealtimeScanVolume(operatorId),
    getAuditTrail(operatorId, 100),
    getHealthSummary(operatorId),
  ]);

  return {
    overview,
    durationTrend,
    operatorStats,
    feederErrors,
    shiftStats,
    lineUtilization,
    alternateAdoption,
    spliceStats,
    realtime,
    auditEvents,
    health,
  };
}

export async function getCostMetrics(bomHeaderId: string | null, range: AnalyticsRange): Promise<import("./types").CostMetrics | null> {
  if (!bomHeaderId) return null;

  try {
    const rows = await prisma.$queryRaw<Array<{
      bom_number: string;
      feeder_number: string | null;
      description: string | null;
      mpn: string;
      unit_cost: number | null;
      quantity: number | null;
      component_cost: number | null;
      labor_cost: number | null;
      waste_cost: number | null;
    }>>(Prisma.sql`
      SELECT
        bh.bom_number,
        bli.feeder_number,
        bli.description,
        bli.mpn,
        bli.unit_cost,
        bli.quantity,
        (bli.unit_cost * bli.quantity) AS component_cost,
        COALESCE(SUM(CASE WHEN al.event_type = 'scan_fail' THEN 0.5 ELSE 0 END), 0) * bli.unit_cost AS waste_cost,
        COALESCE(SUM(EXTRACT(EPOCH FROM (c.completed_at - c.started_at)) / 3600.0), 0) * 25 AS labor_cost
      FROM bom_headers bh
      LEFT JOIN bom_line_items bli ON bli.bom_header_id = bh.id
      LEFT JOIN changeovers c ON c.bom_header_id = bh.id
        AND c.started_at >= ${range.from}
        AND c.started_at <= ${range.to}
      LEFT JOIN audit_log al ON al.changeover_id = c.id
        AND al.event_type IN ('scan_ok', 'scan_fail')
      WHERE bh.id = ${bomHeaderId}::uuid
      GROUP BY bh.bom_number, bli.feeder_number, bli.description, bli.mpn, bli.unit_cost, bli.quantity
      ORDER BY bli.feeder_number
    `);

    if (!rows || rows.length === 0) return null;

    let totalComponentCost = 0;
    let totalLaborCost = 0;
    let totalWasteCost = 0;

    const componentBreakdown = rows
      .filter((r) => r.mpn)
      .map((row) => {
        const cost = toNumber(row.component_cost) || 0;
        const qty = toNumber(row.quantity) || 0;
        totalComponentCost += cost;
        totalLaborCost += toNumber(row.labor_cost) || 0;
        totalWasteCost += toNumber(row.waste_cost) || 0;
        return {
          feederNumber: row.feeder_number || "UNKNOWN",
          description: row.description || "",
          mpn: row.mpn,
          unitCost: toNumber(row.unit_cost) || 0,
          quantity: qty,
          totalCost: cost,
        };
      });

    const totalCost = totalComponentCost + totalLaborCost + totalWasteCost;
    const costPerUnit = componentBreakdown.length > 0 ? totalCost / Math.max(componentBreakdown.reduce((s, c) => s + c.quantity, 0), 1) : 0;

    return {
      bomNumber: rows[0]?.bom_number || "UNKNOWN",
      totalComponentCost,
      totalLaborCost,
      wasteCost: totalWasteCost,
      costPerUnit,
      componentBreakdown,
    };
  } catch (error) {
    logger.error({ error }, "[Analytics] Cost metrics query failed:");
    return null;
  }
}

export async function getDataQualityMetrics(): Promise<import("./types").DataQualityMetrics> {
  try {
    const [totalRecords, missingData, validationErrors, lastValidation] = await Promise.all([
      prisma.auditLog.count(),
      prisma.auditLog.count({ where: { payload: { equals: {} } } }),
      prisma.auditLog.count({ where: { eventType: "scan_fail" } }),
      prisma.auditLog.findFirst({ orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
    ]);

    const completenessPercentage = totalRecords > 0 ? Math.round(((totalRecords - missingData) / totalRecords) * 10000) / 100 : 100;

    return {
      totalRecords,
      missingDataRecords: missingData,
      completenessPercentage,
      outlierCount: 0,
      validationErrors,
      lastValidatedAt: lastValidation?.occurredAt?.toISOString() ?? new Date().toISOString(),
    };
  } catch (error) {
    logger.error({ error }, "[Analytics] Data quality metrics query failed:");
    return {
      totalRecords: 0,
      missingDataRecords: 0,
      completenessPercentage: 0,
      outlierCount: 0,
      validationErrors: 0,
      lastValidatedAt: new Date().toISOString(),
    };
  }
}
