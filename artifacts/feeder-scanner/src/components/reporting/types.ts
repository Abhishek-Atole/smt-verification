/**
 * Type definitions for reporting components and API responses
 */

export interface ReportMetadata {
  generatedAt: string;
  queryTimeMs: number;
  recordCount: number;
}

export interface BaseReportResponse {
  report: unknown;
  metadata: ReportMetadata;
}

export interface FPYReportRow {
  date: string;
  totalFeeders: number;
  passFeeders: number;
  failFeeders: number;
  fpy: number;
}

export interface OEEReportRow {
  sessionId: string;
  operatorName: string;
  durationHours: number;
  quality: number;
  efficiency: number;
  oee: number;
}

export interface OperatorReportRow {
  operatorName: string;
  sessionsCount: number;
  totalScans: number;
  passRate: number;
  feedersPerMinute: number;
}

export interface OperatorComparisonReportRow {
  operatorName: string;
  accuracy: number;
  errors: number;
  speed?: number;
}

export interface FeederReportRow {
  feederNumber: string;
  usageCount: number;
  failCount: number;
  errorRate: number;
  lastUsedAt: string;
}

export interface FeederReliabilityReportRow {
  feederNumber: string;
  repeatFailures: number;
  warningFrequency: number;
  lastFailedAt: string;
}

export interface AlarmReportRow {
  alarmType: string;
  feederNumber: string;
  mismatchCount: number;
  severity: number;
  lastOccurredAt: string;
}

export interface ErrorAnalysisReportRow {
  identifier: string;
  failCount: number;
  errorRate: number;
}

export interface ComponentReportRow {
  mpn: string;
  usageCount: number;
  failCount: number;
}

export interface LotTraceabilityReportRow {
  lotNumber: string;
  dateCode: string;
  usageCount: number;
  failCount: number;
  failRate: number;
}

export interface TrendReportRow {
  date: string;
  sessionsCount: number;
  totalScans: number;
  passCount: number;
  failCount: number;
  passRate: number;
}

export type AnyReportRow =
  | FPYReportRow
  | OEEReportRow
  | OperatorReportRow
  | OperatorComparisonReportRow
  | FeederReportRow
  | FeederReliabilityReportRow
  | AlarmReportRow
  | ErrorAnalysisReportRow
  | ComponentReportRow
  | LotTraceabilityReportRow
  | TrendReportRow;

export interface TableColumn {
  key: string;
  label: string;
  format?: (value: unknown) => string | React.ReactNode;
}

export interface ExportResult {
  success: boolean;
  filePath: string;
  format: "pdf" | "xlsx" | "csv";
  recordCount: number;
  queryTimeMs: number;
  generatedAt: string;
}
