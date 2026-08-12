import React, { useState } from "react";
import { type ReportFilters } from "@/services/reportApi";

interface ReportFiltersComponentProps {
  onFiltersChange: (filters: ReportFilters) => void;
  loading?: boolean;
}

export const ReportFiltersComponent: React.FC<ReportFiltersComponentProps> = ({
  onFiltersChange,
  loading = false,
}) => {
  const [dateFilter, setDateFilter] = useState<NonNullable<ReportFilters["dateFilter"]>>("last7");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [line, setLine] = useState<string>("");
  const [pcb, setPcb] = useState<string>("");
  const [operator, setOperator] = useState<string>("");
  const [shift, setShift] = useState<string>("");

  const handleDateFilterChange = (value: NonNullable<ReportFilters["dateFilter"]>) => {
    setDateFilter(value);
    if (value !== "custom") {
      handleApplyFilters(value, undefined, undefined);
    }
  };

  const handleApplyFilters = (
    selectedDateFilter?: NonNullable<ReportFilters["dateFilter"]>,
    selectedStartDate?: string,
    selectedEndDate?: string,
  ) => {
    const filters: ReportFilters = {
      dateFilter: selectedDateFilter || dateFilter,
    };

    if (selectedDateFilter === "custom" && selectedStartDate && selectedEndDate) {
      filters.startDate = selectedStartDate;
      filters.endDate = selectedEndDate;
    } else if (dateFilter === "custom" && startDate && endDate) {
      filters.startDate = startDate;
      filters.endDate = endDate;
    }

    if (line) filters.line = line;
    if (pcb) filters.pcb = pcb;
    if (operator) filters.operator = operator;
    if (shift) filters.shift = shift;

    onFiltersChange(filters);
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-semibold mb-4">Filters</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Date Filter */}
        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700">Date Range</label>
          <select
            value={dateFilter}
            onChange={(e) => handleDateFilterChange(e.target.value as NonNullable<ReportFilters["dateFilter"]>)}
            disabled={loading}
            className="mt-1 p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last7">Last 7 Days</option>
            <option value="last30">Last 30 Days</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>

        {/* Custom Date Inputs */}
        {dateFilter === "custom" && (
          <>
            <div className="flex flex-col">
              <label className="text-sm font-medium text-gray-700">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={loading}
                className="mt-1 p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-sm font-medium text-gray-700">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={loading}
                className="mt-1 p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </>
        )}

        {/* Line Filter */}
        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700">Line</label>
          <input
            type="text"
            value={line}
            onChange={(e) => setLine(e.target.value)}
            disabled={loading}
            placeholder="Enter line name"
            className="mt-1 p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* PCB Filter */}
        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700">PCB</label>
          <input
            type="text"
            value={pcb}
            onChange={(e) => setPcb(e.target.value)}
            disabled={loading}
            placeholder="Enter PCB name"
            className="mt-1 p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Operator Filter */}
        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700">Operator</label>
          <input
            type="text"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            disabled={loading}
            placeholder="Enter operator name"
            className="mt-1 p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Shift Filter */}
        <div className="flex flex-col">
          <label className="text-sm font-medium text-gray-700">Shift</label>
          <input
            type="text"
            value={shift}
            onChange={(e) => setShift(e.target.value)}
            disabled={loading}
            placeholder="Enter shift"
            className="mt-1 p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Apply Filters Button */}
      <div className="mt-4">
        <button
          onClick={() => handleApplyFilters()}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 transition"
        >
          {loading ? "Loading..." : "Apply Filters"}
        </button>
      </div>
    </div>
  );
};
