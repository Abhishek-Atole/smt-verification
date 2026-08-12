import React, { useState, useCallback } from "react";
import { ReportApi, type ReportFilters } from "../services/reportApi";
import { ReportFiltersComponent } from "../components/ReportFilters";
import { ExportControls } from "../components/ExportControls";
import { ReportDisplay } from "../components/ReportDisplay";

type ReportType =
  | "fpy"
  | "oee"
  | "operator"
  | "operator-comparison"
  | "feeder"
  | "feeder-reliability"
  | "alarm"
  | "error-analysis"
  | "component"
  | "lot-traceability"
  | "trend";

const REPORT_TYPES: { id: ReportType; name: string; description: string }[] = [
  {
    id: "fpy",
    name: "First Pass Yield (FPY)",
    description: "Pass rate percentage for each day",
  },
  {
    id: "oee",
    name: "OEE Report",
    description: "Overall Equipment Effectiveness analysis",
  },
  {
    id: "operator",
    name: "Operator Performance",
    description: "Individual operator accuracy and speed metrics",
  },
  {
    id: "operator-comparison",
    name: "Operator Comparison",
    description: "Compare multiple operators side-by-side",
  },
  {
    id: "feeder",
    name: "Feeder Performance",
    description: "Feeder usage and error rate analysis",
  },
  {
    id: "feeder-reliability",
    name: "Feeder Reliability",
    description: "Feeders with repeat failures",
  },
  {
    id: "alarm",
    name: "Alarm Report",
    description: "System alarms and mismatches by severity",
  },
  {
    id: "error-analysis",
    name: "Error Analysis",
    description: "Top failing feeders and components",
  },
  {
    id: "component",
    name: "Component Usage",
    description: "Component frequency and failure rates",
  },
  {
    id: "lot-traceability",
    name: "Lot Traceability",
    description: "Lot-level usage and failure tracking",
  },
  {
    id: "trend",
    name: "Trend Report",
    description: "Daily trends and historical analysis",
  },
];

export const Reports: React.FC = () => {
  const [selectedReport, setSelectedReport] = useState<ReportType>("fpy");
  const [filters, setFilters] = useState<ReportFilters>({
    dateFilter: "last7",
  });
  const [reportData, setReportData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [queryTime, setQueryTime] = useState<number>(0);

  const currentReport = REPORT_TYPES.find((r) => r.id === selectedReport);

  // Define column configurations for each report type
  const getColumns = (reportType: ReportType) => {
    switch (reportType) {
      case "fpy":
        return [
          { key: "date", label: "Date" },
          { key: "totalFeeders", label: "Total Feeders" },
          { key: "passFeeders", label: "Pass" },
          { key: "failFeeders", label: "Fail" },
          {
            key: "fpy",
            label: "FPY %",
            format: (v: number) => `${v.toFixed(2)}%`,
          },
        ];
      case "oee":
        return [
          { key: "sessionId", label: "Session ID" },
          { key: "operatorName", label: "Operator" },
          { key: "durationHours", label: "Duration (hrs)" },
          {
            key: "quality",
            label: "Quality %",
            format: (v: number) => `${v.toFixed(2)}%`,
          },
          {
            key: "efficiency",
            label: "Efficiency",
            format: (v: number) => `${v.toFixed(2)}`,
          },
          {
            key: "oee",
            label: "OEE %",
            format: (v: number) => `${v.toFixed(2)}%`,
          },
        ];
      case "operator":
        return [
          { key: "operatorName", label: "Operator" },
          { key: "sessionsCount", label: "Sessions" },
          { key: "totalScans", label: "Total Scans" },
          {
            key: "passRate",
            label: "Pass Rate %",
            format: (v: number) => `${v.toFixed(2)}%`,
          },
          {
            key: "feedersPerMinute",
            label: "Speed (f/min)",
            format: (v: number) => `${v.toFixed(2)}`,
          },
        ];
      case "operator-comparison":
        return [
          { key: "operatorName", label: "Operator" },
          {
            key: "accuracy",
            label: "Accuracy %",
            format: (v: number) => `${v.toFixed(2)}%`,
          },
          {
            key: "speed",
            label: "Speed (f/min)",
            format: (v: number) => `${v.toFixed(2)}`,
          },
          {
            key: "errors",
            label: "Errors %",
            format: (v: number) => `${v.toFixed(2)}%`,
          },
        ];
      case "feeder":
        return [
          { key: "feederNumber", label: "Feeder #" },
          { key: "usageCount", label: "Usage Count" },
          { key: "failCount", label: "Fail Count" },
          {
            key: "errorRate",
            label: "Error Rate %",
            format: (v: number) => `${v.toFixed(2)}%`,
          },
          {
            key: "lastUsedAt",
            label: "Last Used",
            format: (v: string) => new Date(v).toLocaleDateString(),
          },
        ];
      case "feeder-reliability":
        return [
          { key: "feederNumber", label: "Feeder #" },
          { key: "repeatFailures", label: "Repeat Failures" },
          { key: "warningFrequency", label: "Warnings" },
          {
            key: "lastFailedAt",
            label: "Last Failed",
            format: (v: string) => new Date(v).toLocaleDateString(),
          },
        ];
      case "alarm":
        return [
          { key: "alarmType", label: "Severity" },
          { key: "feederNumber", label: "Feeder #" },
          { key: "mismatchCount", label: "Mismatch Count" },
          { key: "severity", label: "Severity (1-10)" },
          {
            key: "lastOccurredAt",
            label: "Last Occurred",
            format: (v: string) => new Date(v).toLocaleDateString(),
          },
        ];
      case "error-analysis":
        return [
          { key: "identifier", label: "Identifier" },
          { key: "failCount", label: "Fail Count" },
          {
            key: "errorRate",
            label: "Error Rate %",
            format: (v: number) => `${v.toFixed(2)}%`,
          },
        ];
      case "component":
        return [
          { key: "mpn", label: "MPN" },
          { key: "usageCount", label: "Usage" },
          { key: "failCount", label: "Failures" },
        ];
      case "lot-traceability":
        return [
          { key: "lotNumber", label: "Lot #" },
          { key: "dateCode", label: "Date Code" },
          { key: "usageCount", label: "Usage" },
          { key: "failCount", label: "Failures" },
          {
            key: "failRate",
            label: "Fail Rate %",
            format: (v: number) => `${v.toFixed(2)}%`,
          },
        ];
      case "trend":
        return [
          { key: "date", label: "Date" },
          { key: "sessionsCount", label: "Sessions" },
          { key: "totalScans", label: "Total Scans" },
          { key: "passCount", label: "Pass" },
          { key: "failCount", label: "Fail" },
          {
            key: "passRate",
            label: "Pass Rate %",
            format: (v: number) => `${v.toFixed(2)}%`,
          },
        ];
      default:
        return [];
    }
  };

  const handleLoadReport = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      let reportFn: any;
      switch (selectedReport) {
        case "fpy":
          reportFn = ReportApi.fetchFPYReport;
          break;
        case "oee":
          reportFn = ReportApi.fetchOEEReport;
          break;
        case "operator":
          reportFn = ReportApi.fetchOperatorReport;
          break;
        case "operator-comparison":
          reportFn = ReportApi.fetchOperatorComparisonReport;
          break;
        case "feeder":
          reportFn = ReportApi.fetchFeederReport;
          break;
        case "feeder-reliability":
          reportFn = ReportApi.fetchFeederReliabilityReport;
          break;
        case "alarm":
          reportFn = ReportApi.fetchAlarmReport;
          break;
        case "error-analysis":
          reportFn = ReportApi.fetchErrorAnalysisReport;
          break;
        case "component":
          reportFn = ReportApi.fetchComponentReport;
          break;
        case "lot-traceability":
          reportFn = ReportApi.fetchLotTraceabilityReport;
          break;
        case "trend":
          reportFn = ReportApi.fetchTrendReport;
          break;
      }

      if (!reportFn) throw new Error("Invalid report type");

      const response = await reportFn(filters);
      let data = response.report;

      // Handle operator-comparison which returns an object with operators array
      if (selectedReport === "operator-comparison" && response.report.operators) {
        data = response.report.operators;
      }

      setReportData(Array.isArray(data) ? data : []);
      setQueryTime(response.metadata.queryTimeMs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report");
      setReportData([]);
    } finally {
      setLoading(false);
    }
  }, [selectedReport, filters]);

  const handleExport = async (format: "pdf" | "xlsx" | "csv") => {
    try {
      const result = await ReportApi.exportReport(selectedReport, format, filters);
      alert(`Report exported successfully!\nFile: ${result.filePath}\nRecords: ${result.recordCount}`);
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  React.useEffect(() => {
    handleLoadReport();
  }, [handleLoadReport]);

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h1 className="text-3xl font-bold text-gray-900">📊 Analytics & Reporting</h1>
          <p className="text-gray-600 mt-2">Generate and export detailed reports</p>
        </div>

        {/* Report Selector */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">Select Report Type</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {REPORT_TYPES.map((report) => (
              <button
                key={report.id}
                onClick={() => setSelectedReport(report.id)}
                className={`p-4 rounded-lg border-2 transition text-left font-medium ${
                  selectedReport === report.id
                    ? "bg-white text-navy border-navy"
                    : "bg-white text-navy border-navy hover:bg-gray-50"
                }`}
              >
                <h3 className="font-semibold">{report.name}</h3>
                <p className="text-sm text-gray-600">{report.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Report Info */}
        {currentReport && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900">{currentReport.name}</h3>
            <p className="text-blue-700 text-sm">{currentReport.description}</p>
            {queryTime > 0 && <p className="text-blue-600 text-xs mt-2">Query time: {queryTime}ms</p>}
          </div>
        )}

        {/* Filters */}
        <ReportFiltersComponent onFiltersChange={setFilters} loading={loading} />

        {/* Export Controls */}
        <ExportControls
          reportType={selectedReport}
          filters={filters}
          onExport={handleExport}
          loading={loading}
          recordCount={reportData.length}
        />

        {/* Report Display */}
        <ReportDisplay
          data={reportData}
          columns={getColumns(selectedReport)}
          title={currentReport?.name || "Report"}
          loading={loading}
          error={error}
        />
      </div>
    </div>
  );
};
