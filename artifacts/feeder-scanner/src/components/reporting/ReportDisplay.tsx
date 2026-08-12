// @ts-nocheck
import React from "react";

interface Column {
  key: string;
  label: string;
  format?: (value: any) => string | React.ReactNode;
}

interface ReportDisplayProps {
  data: any[];
  columns: Column[];
  title: string;
  loading?: boolean;
  error?: string;
}

export const ReportDisplay: React.FC<ReportDisplayProps> = ({
  data,
  columns,
  title,
  loading = false,
  error = "",
}) => {
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <div className="inline-block">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
        <p className="mt-4 text-gray-600">Loading report...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg shadow-md p-6">
        <p className="text-red-700 font-semibold">Error Loading Report</p>
        <p className="text-red-600 text-sm mt-2">{error}</p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <p className="text-gray-600">No data available for this report</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-6 py-3 text-left text-sm font-medium text-gray-700"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr
                key={idx}
                className={`border-b border-gray-200 ${
                  idx % 2 === 0 ? "bg-white" : "bg-gray-50"
                } hover:bg-blue-50 transition`}
              >
                {columns.map((col) => {
                  const value = row[col.key];
                  const displayValue = col.format ? col.format(value) : value;
                  return (
                    <td key={col.key} className="px-6 py-4 text-sm text-gray-900">
                      {displayValue}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-600">
        Showing {data.length} record{data.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
};
