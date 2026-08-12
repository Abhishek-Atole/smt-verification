export interface ReportFilters {
  startDate?: string;
  endDate?: string;
  dateFilter?: "today" | "yesterday" | "last7" | "last30" | "custom";
  line?: string;
  pcb?: string;
  operator?: string;
  shift?: string;
}

export interface FPYReportData {
  date: string;
  totalFeeders: number;
  passFeeders: number;
  failFeeders: number;
  fpy: number;
}

export interface OEEReportData {
  sessionId: string;
  operatorName: string;
  durationHours: number;
  quality: number;
  efficiency: number;
  oee: number;
}

export interface OperatorReportData {
  operatorName: string;
  sessionsCount: number;
  totalScans: number;
  passRate: number;
  feedersPerMinute: number;
}

export interface OperatorComparisonData {
  operatorName: string;
  accuracy: number;
  speed: number;
  errors: number;
}

export interface FeederReportData {
  feederNumber: string;
  usageCount: number;
  failCount: number;
  errorRate: number;
  lastUsedAt: string;
}

export interface FeederReliabilityData {
  feederNumber: string;
  repeatFailures: number;
  warningFrequency: number;
  lastFailedAt: string;
}

export interface AlarmReportData {
  alarmType: string;
  feederNumber: string;
  mismatchCount: number;
  severity: number;
  lastOccurredAt: string;
}

export interface ErrorAnalysisData {
  identifier: string;
  failCount: number;
  errorRate: number;
}

export interface ComponentReportData {
  mpn: string;
  usageCount: number;
  failCount: number;
}

export interface LotTraceabilityData {
  lotNumber: string;
  dateCode: string;
  usageCount: number;
  failCount: number;
  failRate: number;
  affectedFeeders?: string[];
}

export interface TrendReportData {
  date: string;
  sessionsCount: number;
  totalScans: number;
  passCount: number;
  failCount: number;
  passRate: number;
}

export interface ReportResponse<T> {
  report: T;
  metadata: {
    generatedAt: string;
    queryTimeMs: number;
    recordCount: number;
  };
}

export interface ExportResult {
  success: boolean;
  filePath: string;
  format: "pdf" | "xlsx" | "csv";
  recordCount: number;
  queryTimeMs: number;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

function buildQueryString(filters: ReportFilters): string {
  const params = new URLSearchParams();

  if (filters.startDate) params.append("startDate", filters.startDate);
  if (filters.endDate) params.append("endDate", filters.endDate);
  if (filters.dateFilter) params.append("dateFilter", filters.dateFilter);
  if (filters.line) params.append("line", filters.line);
  if (filters.pcb) params.append("pcb", filters.pcb);
  if (filters.operator) params.append("operator", filters.operator);
  if (filters.shift) params.append("shift", filters.shift);

  return params.toString();
}

export class ReportApi {
  static async fetchFPYReport(
    filters: ReportFilters,
  ): Promise<ReportResponse<FPYReportData[]>> {
    const query = buildQueryString(filters);
    const response = await fetch(`${API_BASE_URL}/api/reports/fpy?${query}`);
    if (!response.ok) throw new Error("Failed to fetch FPY report");
    return response.json();
  }

  static async fetchOEEReport(
    filters: ReportFilters,
  ): Promise<ReportResponse<OEEReportData[]>> {
    const query = buildQueryString(filters);
    const response = await fetch(`${API_BASE_URL}/api/reports/oee?${query}`);
    if (!response.ok) throw new Error("Failed to fetch OEE report");
    return response.json();
  }

  static async fetchOperatorReport(
    filters: ReportFilters,
  ): Promise<ReportResponse<OperatorReportData[]>> {
    const query = buildQueryString(filters);
    const response = await fetch(`${API_BASE_URL}/api/reports/operator?${query}`);
    if (!response.ok) throw new Error("Failed to fetch Operator report");
    return response.json();
  }

  static async fetchOperatorComparisonReport(
    filters: ReportFilters,
  ): Promise<ReportResponse<{ operators: OperatorComparisonData[] }>> {
    const query = buildQueryString(filters);
    const response = await fetch(`${API_BASE_URL}/api/reports/operator-comparison?${query}`);
    if (!response.ok) throw new Error("Failed to fetch Operator Comparison report");
    return response.json();
  }

  static async fetchFeederReport(
    filters: ReportFilters,
  ): Promise<ReportResponse<FeederReportData[]>> {
    const query = buildQueryString(filters);
    const response = await fetch(`${API_BASE_URL}/api/reports/feeder?${query}`);
    if (!response.ok) throw new Error("Failed to fetch Feeder report");
    return response.json();
  }

  static async fetchFeederReliabilityReport(
    filters: ReportFilters,
  ): Promise<ReportResponse<FeederReliabilityData[]>> {
    const query = buildQueryString(filters);
    const response = await fetch(`${API_BASE_URL}/api/reports/feeder-reliability?${query}`);
    if (!response.ok) throw new Error("Failed to fetch Feeder Reliability report");
    return response.json();
  }

  static async fetchAlarmReport(
    filters: ReportFilters,
  ): Promise<ReportResponse<AlarmReportData[]>> {
    const query = buildQueryString(filters);
    const response = await fetch(`${API_BASE_URL}/api/reports/alarm?${query}`);
    if (!response.ok) throw new Error("Failed to fetch Alarm report");
    return response.json();
  }

  static async fetchErrorAnalysisReport(
    filters: ReportFilters,
  ): Promise<ReportResponse<ErrorAnalysisData[]>> {
    const query = buildQueryString(filters);
    const response = await fetch(`${API_BASE_URL}/api/reports/error-analysis?${query}`);
    if (!response.ok) throw new Error("Failed to fetch Error Analysis report");
    return response.json();
  }

  static async fetchComponentReport(
    filters: ReportFilters,
  ): Promise<ReportResponse<ComponentReportData[]>> {
    const query = buildQueryString(filters);
    const response = await fetch(`${API_BASE_URL}/api/reports/component?${query}`);
    if (!response.ok) throw new Error("Failed to fetch Component report");
    return response.json();
  }

  static async fetchLotTraceabilityReport(
    filters: ReportFilters,
  ): Promise<ReportResponse<LotTraceabilityData[]>> {
    const query = buildQueryString(filters);
    const response = await fetch(`${API_BASE_URL}/api/reports/lot-traceability?${query}`);
    if (!response.ok) throw new Error("Failed to fetch Lot Traceability report");
    return response.json();
  }

  static async fetchTrendReport(
    filters: ReportFilters,
  ): Promise<ReportResponse<TrendReportData[]>> {
    const query = buildQueryString(filters);
    const response = await fetch(`${API_BASE_URL}/api/reports/trend?${query}`);
    if (!response.ok) throw new Error("Failed to fetch Trend report");
    return response.json();
  }

  static async exportReport(
    reportType: string,
    format: "pdf" | "xlsx" | "csv",
    filters: ReportFilters,
  ): Promise<ExportResult> {
    const response = await fetch(`${API_BASE_URL}/api/reports/export/${reportType}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format, filters }),
    });

    if (!response.ok) throw new Error("Failed to export report");
    return response.json();
  }

  static async getExportHistory(): Promise<
    Array<{
      id: string;
      reportId: string;
      format: "pdf" | "xlsx" | "csv";
      downloadedAt: string;
    }>
  > {
    const response = await fetch(`${API_BASE_URL}/api/reports/exports/history`);
    if (!response.ok) throw new Error("Failed to fetch export history");
    return response.json();
  }
}
