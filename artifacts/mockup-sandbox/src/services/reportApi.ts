/**
 * Report API Service - Handles all calls to the reporting API
 */

export interface ReportFilters {
  startDate?: Date;
  endDate?: Date;
  dateFilter?: "today" | "yesterday" | "last7" | "last30" | "custom";
  line?: string;
  pcb?: string;
  operator?: string;
  shift?: string;
}

export interface ReportMetadata {
  generatedAt: string;
  queryTimeMs: number;
  recordCount: number;
}

export interface ReportResponse<T> {
  report: T;
  metadata: ReportMetadata;
}

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export class ReportApi {
  /**
   * Build query string from filters
   */
  static buildQueryString(filters: ReportFilters): string {
    const params = new URLSearchParams();

    if (filters.dateFilter) {
      params.append("dateFilter", filters.dateFilter);
    }
    if (filters.startDate) {
      params.append("startDate", filters.startDate.toISOString());
    }
    if (filters.endDate) {
      params.append("endDate", filters.endDate.toISOString());
    }
    if (filters.line) {
      params.append("line", filters.line);
    }
    if (filters.pcb) {
      params.append("pcb", filters.pcb);
    }
    if (filters.operator) {
      params.append("operator", filters.operator);
    }
    if (filters.shift) {
      params.append("shift", filters.shift);
    }

    return params.toString();
  }

  /**
   * Fetch FPY Report
   */
  static async fetchFPYReport(filters: ReportFilters): Promise<ReportResponse<any>> {
    const queryString = this.buildQueryString(filters);
    const response = await fetch(`${API_BASE}/api/reports/fpy?${queryString}`);
    if (!response.ok) {
      throw new Error("Failed to fetch FPY report");
    }
    return response.json();
  }

  /**
   * Fetch OEE Report
   */
  static async fetchOEEReport(filters: ReportFilters): Promise<ReportResponse<any>> {
    const queryString = this.buildQueryString(filters);
    const response = await fetch(`${API_BASE}/api/reports/oee?${queryString}`);
    if (!response.ok) {
      throw new Error("Failed to fetch OEE report");
    }
    return response.json();
  }

  /**
   * Fetch Operator Performance Report
   */
  static async fetchOperatorReport(filters: ReportFilters): Promise<ReportResponse<any>> {
    const queryString = this.buildQueryString(filters);
    const response = await fetch(`${API_BASE}/api/reports/operator?${queryString}`);
    if (!response.ok) {
      throw new Error("Failed to fetch operator report");
    }
    return response.json();
  }

  /**
   * Fetch Operator Comparison Report
   */
  static async fetchOperatorComparisonReport(filters: ReportFilters): Promise<ReportResponse<any>> {
    const queryString = this.buildQueryString(filters);
    const response = await fetch(`${API_BASE}/api/reports/operator-comparison?${queryString}`);
    if (!response.ok) {
      throw new Error("Failed to fetch operator comparison report");
    }
    return response.json();
  }

  /**
   * Fetch Feeder Performance Report
   */
  static async fetchFeederReport(filters: ReportFilters): Promise<ReportResponse<any>> {
    const queryString = this.buildQueryString(filters);
    const response = await fetch(`${API_BASE}/api/reports/feeder?${queryString}`);
    if (!response.ok) {
      throw new Error("Failed to fetch feeder report");
    }
    return response.json();
  }

  /**
   * Fetch Feeder Reliability Report
   */
  static async fetchFeederReliabilityReport(filters: ReportFilters): Promise<ReportResponse<any>> {
    const queryString = this.buildQueryString(filters);
    const response = await fetch(`${API_BASE}/reports/feeder-reliability?${queryString}`);
    if (!response.ok) {
      throw new Error("Failed to fetch feeder reliability report");
    }
    return response.json();
  }

  /**
   * Fetch Alarm Report
   */
  static async fetchAlarmReport(filters: ReportFilters): Promise<ReportResponse<any>> {
    const queryString = this.buildQueryString(filters);
    const response = await fetch(`${API_BASE}/reports/alarm?${queryString}`);
    if (!response.ok) {
      throw new Error("Failed to fetch alarm report");
    }
    return response.json();
  }

  /**
   * Fetch Error Analysis Report
   */
  static async fetchErrorAnalysisReport(filters: ReportFilters): Promise<ReportResponse<any>> {
    const queryString = this.buildQueryString(filters);
    const response = await fetch(`${API_BASE}/reports/error-analysis?${queryString}`);
    if (!response.ok) {
      throw new Error("Failed to fetch error analysis report");
    }
    return response.json();
  }

  /**
   * Fetch Component Usage Report
   */
  static async fetchComponentReport(filters: ReportFilters): Promise<ReportResponse<any>> {
    const queryString = this.buildQueryString(filters);
    const response = await fetch(`${API_BASE}/reports/component?${queryString}`);
    if (!response.ok) {
      throw new Error("Failed to fetch component report");
    }
    return response.json();
  }

  /**
   * Fetch Lot Traceability Report
   */
  static async fetchLotTraceabilityReport(filters: ReportFilters): Promise<ReportResponse<any>> {
    const queryString = this.buildQueryString(filters);
    const response = await fetch(`${API_BASE}/reports/lot-traceability?${queryString}`);
    if (!response.ok) {
      throw new Error("Failed to fetch lot traceability report");
    }
    return response.json();
  }

  /**
   * Fetch Trend Report
   */
  static async fetchTrendReport(filters: ReportFilters): Promise<ReportResponse<any>> {
    const queryString = this.buildQueryString(filters);
    const response = await fetch(`${API_BASE}/reports/trend?${queryString}`);
    if (!response.ok) {
      throw new Error("Failed to fetch trend report");
    }
    return response.json();
  }

  /**
   * Export report to PDF/Excel/CSV
   */
  static async exportReport(
    reportType: string,
    format: "pdf" | "xlsx" | "csv",
    filters: ReportFilters
  ): Promise<{ filePath: string; format: string; recordCount: number; queryTimeMs: number }> {
    const response = await fetch(`${API_BASE}/reports/export/${reportType}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ format, filters }),
    });

    if (!response.ok) {
      throw new Error("Failed to export report");
    }

    return response.json();
  }

  /**
   * Get export history
   */
  static async getExportHistory(): Promise<{ exports: any[]; count: number }> {
    const response = await fetch(`${API_BASE}/reports/exports/history`);
    if (!response.ok) {
      throw new Error("Failed to fetch export history");
    }
    return response.json();
  }
}

export const fetchFPYReport = (filters: ReportFilters) => ReportApi.fetchFPYReport(filters);
export const fetchOEEReport = (filters: ReportFilters) => ReportApi.fetchOEEReport(filters);
export const fetchOperatorReport = (filters: ReportFilters) => ReportApi.fetchOperatorReport(filters);
export const fetchFeederReport = (filters: ReportFilters) => ReportApi.fetchFeederReport(filters);
export const fetchFeederReliabilityReport = (filters: ReportFilters) => ReportApi.fetchFeederReliabilityReport(filters);
export const fetchAlarmReport = (filters: ReportFilters) => ReportApi.fetchAlarmReport(filters);
export const fetchErrorAnalysisReport = (filters: ReportFilters) => ReportApi.fetchErrorAnalysisReport(filters);
export const fetchComponentReport = (filters: ReportFilters) => ReportApi.fetchComponentReport(filters);
export const fetchLotTraceabilityReport = (filters: ReportFilters) => ReportApi.fetchLotTraceabilityReport(filters);
export const fetchTrendReport = (filters: ReportFilters) => ReportApi.fetchTrendReport(filters);
export const exportReport = (reportType: string, format: "pdf" | "xlsx" | "csv", filters: ReportFilters) =>
  ReportApi.exportReport(reportType, format, filters);
export const downloadFile = async (filePath: string): Promise<Blob> => {
  const response = await fetch(filePath.startsWith("http") ? filePath : `${API_BASE}${filePath}`);
  if (!response.ok) {
    throw new Error("Failed to download file");
  }
  return response.blob();
};
