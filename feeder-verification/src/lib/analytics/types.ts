export type AnalyticsRole = "operator" | "qa" | "engineer" | "admin";

export type AnalyticsTab =
  | "overview"
  | "operators"
  | "feeders"
  | "shifts"
  | "lines"
  | "alternates"
  | "splicing"
  | "audit"
  | "realtime"
  | "health"
  | "export"
  | "cost"
  | "dataQuality";

export interface AnalyticsRange {
  from: Date;
  to: Date;
}

export interface OverviewKPIs {
  totalChangeovers: number;
  avgDurationMinutes: number;
  firstPassRate: number;
  alternateUsageRate: number;
  totalScansToday: number;
  scanFailRate: number;
  totalSplicesToday: number;
  activeOperators: number;
  trends: {
    changeovers: number;
    duration: number;
    firstPassRate: number;
    scanFailRate: number;
  };
}

export interface DurationDataPoint {
  date: string;
  avgDurationMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  count: number;
}

export interface OperatorStats {
  operatorId: string;
  operatorName: string;
  employeeId: string;
  changeoversTotal: number;
  avgDurationMinutes: number;
  totalScans: number;
  alternateScans: number;
  scanFailures: number;
  accuracyPct: number;
  firstPassRate: number;
}

export interface FeederErrorSummary {
  feederNumber: string;
  description: string | null;
  packageDesc: string | null;
  bomNumber: string;
  totalErrors: number;
  totalScans: number;
  errorRate: number;
  trend: "up" | "down" | "stable";
}

export interface FeederErrorCell {
  feederNumber: string;
  date: string;
  errorCount: number;
  successCount: number;
  errorRate: number;
}

export interface ShiftStats {
  shift: "MORNING" | "EVENING" | "NIGHT" | "UNSPECIFIED";
  changeovers: number;
  avgDurationMinutes: number;
  accuracyPct: number;
  alternateUsageRate: number;
  spliceCount: number;
}

export interface LineUtilization {
  lineNumber: string;
  workDate: string;
  changeovers: number;
  avgDurationMinutes: number;
}

export interface AlternateAdoption {
  bomNumber: string;
  feederNumber: string;
  mpn: string;
  make: string;
  rank: number;
  mpnType: "PRIMARY" | "ALTERNATE_1" | "ALTERNATE_2";
  timesUsed: number;
  usagePct: number;
}

export interface MPNUsage {
  mpn: string;
  make: string;
  rank: number;
  mpnType: "PRIMARY" | "ALTERNATE_1" | "ALTERNATE_2";
  feederNumber: string;
  bomNumber: string;
  timesUsed: number;
  usagePct: number;
}

export interface SpliceStats {
  feederNumber: string;
  spliceCount: number;
  lastSpliced: string | null;
  avgPerDay: number;
}

export interface ScanVolumePoint {
  timestamp: string;
  scanOk: number;
  scanFail: number;
  total: number;
}

export interface AuditEvent {
  id: string;
  occurredAt: string;
  eventType: string;
  operatorName: string;
  employeeId: string;
  changeoverId: string | null;
  feederNumber: string | null;
  summary: string;
  payload: Record<string, unknown>;
}

export interface HealthSummary {
  totalChangeovers: number;
  activeChangeovers: number;
  totalOperators: number;
  totalScansToday: number;
  totalSplicesToday: number;
  latestRefreshAt: string | null;
}

export interface CostMetrics {
  bomNumber: string;
  totalComponentCost: number;
  totalLaborCost: number;
  wasteCost: number;
  costPerUnit: number;
  componentBreakdown: Array<{
    feederNumber: string;
    description: string;
    mpn: string;
    unitCost: number;
    quantity: number;
    totalCost: number;
  }>;
}

export interface DataQualityMetrics {
  totalRecords: number;
  missingDataRecords: number;
  completenessPercentage: number;
  outlierCount: number;
  validationErrors: number;
  lastValidatedAt: string;
}

export interface PerformanceMetrics {
  slowestQueries: Array<{
    queryName: string;
    executionTimeMs: number;
    rowsReturned: number;
  }>;
  averageResponseTimeMs: number;
  cacheHitRate: number;
  databaseConnectionPoolUsage: number;
}

export interface AnalyticsExportBundle {
  overview: OverviewKPIs;
  durationTrend: DurationDataPoint[];
  operatorStats: OperatorStats[];
  feederErrors: FeederErrorSummary[];
  shiftStats: ShiftStats[];
  lineUtilization: LineUtilization[];
  alternateAdoption: AlternateAdoption[];
  spliceStats: SpliceStats[];
  realtime: ScanVolumePoint[];
  auditEvents: AuditEvent[];
  health: HealthSummary;
  cost?: CostMetrics;
  dataQuality?: DataQualityMetrics;
}
