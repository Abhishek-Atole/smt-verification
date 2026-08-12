import React, { useState } from "react";
import { type ReportFilters } from "@/services/reportApi";

interface ExportControlsProps {
  reportType: string;
  filters: ReportFilters;
  onExport: (format: "pdf" | "xlsx" | "csv") => Promise<void>;
  loading?: boolean;
  recordCount?: number;
}

export const ExportControls: React.FC<ExportControlsProps> = ({
  reportType,
  filters,
  onExport,
  loading = false,
  recordCount = 0,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<"pdf" | "xlsx" | "csv">("csv");
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await onExport(selectedFormat);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-semibold mb-4">Export Report</h2>
      <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
        {/* Format Selection */}
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-gray-700">Format:</label>
          <div className="flex gap-4">
            {(["pdf", "xlsx", "csv"] as const).map((format) => (
              <label key={format} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="export-format"
                  value={format}
                  checked={selectedFormat === format}
                  onChange={(e) => setSelectedFormat(e.target.value as "pdf" | "xlsx" | "csv")}
                  disabled={exporting || loading}
                  className="w-4 h-4"
                />
                <span className="text-sm">{format.toUpperCase()}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Export Button */}
        <button
          onClick={handleExport}
          disabled={exporting || loading}
          className="flex items-center gap-2 px-4 py-2 bg-white text-navy border-navy border-2 rounded-md hover:bg-gray-50 disabled:bg-gray-100 transition"
        >
          {exporting ? "Exporting..." : "📥 Export"}
        </button>

        {/* Record Count */}
        {recordCount > 0 && (
          <span className="text-sm text-gray-600">
            {recordCount} record{recordCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
};
