import React, { useState } from "react";
import type { ReportFilters } from "../services/reportApi";

interface ReportFiltersProps {
  onFiltersChange: (filters: ReportFilters) => void;
  loading?: boolean;
}

export const ReportFiltersComponent: React.FC<ReportFiltersProps> = ({ onFiltersChange, loading = false }) => {
  const [dateFilter, setDateFilter] = useState<"today" | "yesterday" | "last7" | "last30" | "custom">("last7");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [line, setLine] = useState<string>("");
  const [pcb, setPcb] = useState<string>("");
  const [operator, setOperator] = useState<string>("");
  const [shift, setShift] = useState<string>("");

  const handleDateFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const filter = e.target.value as any;
    setDateFilter(filter);

    if (filter !== "custom") {
      handleApplyFilters();
    }
  };

  const handleApplyFilters = () => {
    const filters: ReportFilters = {
      dateFilter: dateFilter === "custom" ? undefined : dateFilter,
      startDate: dateFilter === "custom" && startDate ? new Date(startDate) : undefined,
      endDate: dateFilter === "custom" && endDate ? new Date(endDate) : undefined,
      line: line || undefined,
      pcb: pcb || undefined,
      operator: operator || undefined,
      shift: shift || undefined,
    };

    onFiltersChange(filters);
  };

  return (
    <div className="p-4 border rounded-lg bg-gray-50 space-y-4">
      <h3 className="text-lg font-semibold mb-4">Report Filters</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Date Filter */}
        <div>
          <label className="block text-sm font-medium mb-1">Date Range</label>
          <select
            value={dateFilter}
            onChange={handleDateFilterChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last7">Last 7 Days</option>
            <option value="last30">Last 30 Days</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>

        {/* Custom Start Date */}
        {dateFilter === "custom" && (
          <div>
            <label className="block text-sm font-medium mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {/* Custom End Date */}
        {dateFilter === "custom" && (
          <div>
            <label className="block text-sm font-medium mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {/* Line */}
        <div>
          <label className="block text-sm font-medium mb-1">Line (Optional)</label>
          <input
            type="text"
            placeholder="e.g., Line 1"
            value={line}
            onChange={(e) => setLine(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* PCB */}
        <div>
          <label className="block text-sm font-medium mb-1">PCB (Optional)</label>
          <input
            type="text"
            placeholder="e.g., Panel-001"
            value={pcb}
            onChange={(e) => setPcb(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Operator */}
        <div>
          <label className="block text-sm font-medium mb-1">Operator (Optional)</label>
          <input
            type="text"
            placeholder="e.g., John Doe"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Shift */}
        <div>
          <label className="block text-sm font-medium mb-1">Shift (Optional)</label>
          <input
            type="text"
            placeholder="e.g., Morning"
            value={shift}
            onChange={(e) => setShift(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Apply Button */}
      {dateFilter === "custom" && (
        <div className="flex justify-end gap-2 pt-4">
          <button
            onClick={() => {
              setStartDate("");
              setEndDate("");
            }}
            className="px-4 py-2 bg-white hover:bg-gray-50 text-navy border-navy border-2 rounded-lg font-medium transition-colors"
          >
            Clear Dates
          </button>
          <button
            onClick={handleApplyFilters}
            disabled={loading}
            className="px-4 py-2 bg-white hover:bg-gray-50 text-navy border-navy border-2 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {loading ? "Loading..." : "Apply Filters"}
          </button>
        </div>
      )}
    </div>
  );
};
