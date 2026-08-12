import React, { useState } from "react";
import type { ReportFilters } from "../services/reportApi";

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
  const [selectedFormat, setSelectedFormat] = useState<"pdf" | "xlsx" | "csv">("pdf");
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    try {
      setExporting(true);
      await onExport(selectedFormat);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg bg-blue-50 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold mb-2">Export Report</h3>
          <p className="text-sm text-gray-600">Records: {recordCount}</p>
        </div>

        <div className="flex gap-4 items-end">
          {/* Format Selection */}
          <div>
            <label className="block text-sm font-medium mb-1">Format</label>
            <div className="flex gap-2">
              {(["pdf", "xlsx", "csv"] as const).map((format) => (
                <label key={format} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value={format}
                    checked={selectedFormat === format}
                    onChange={(e) => setSelectedFormat(e.target.value as any)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm uppercase">{format}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Export Button */}
          <button
            onClick={handleExport}
            disabled={loading || exporting}
            className="px-6 py-2 bg-white text-navy border-navy border-2 rounded-md hover:bg-gray-50 disabled:opacity-50 transition flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
            {exporting ? "Exporting..." : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
};
