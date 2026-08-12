import React from "react";

interface ReportDisplayProps {
  data: any[];
  columns: { key: string; label: string; format?: (value: any) => string }[];
  title: string;
  loading?: boolean;
  error?: string;
}

export const ReportDisplay: React.FC<ReportDisplayProps> = ({ data, columns, title, loading = false, error }) => {
  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
        <p className="mt-4 text-gray-600">Loading report...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-800 font-semibold">Error</p>
        <p className="text-red-700 text-sm">{error}</p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="p-8 text-center bg-gray-50 rounded-lg">
        <p className="text-gray-600">No data available for this report</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="px-6 py-4 bg-gray-50 border-b">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-gray-600 mt-1">{data.length} records</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-100 border-b">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50 hover:bg-gray-100"}>
                {columns.map((col) => (
                  <td key={`${idx}-${col.key}`} className="px-6 py-3 text-sm text-gray-900">
                    {col.format ? col.format(row[col.key]) : row[col.key] ?? "-"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
