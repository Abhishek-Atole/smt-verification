// @ts-nocheck
import React from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface ReportChartProps {
  data: any[];
  reportType: string;
  title: string;
}

const COLORS = [
  "#0088FE",
  "#00C49F",
  "#FFBB28",
  "#FF8042",
  "#8884D8",
  "#82CA9D",
  "#FFC658",
  "#FF7C7C",
];

export const ReportChart: React.FC<ReportChartProps> = ({ data, reportType, title }) => {
  if (!data || data.length === 0) {
    return null;
  }

  switch (reportType) {
    case "fpy":
      return (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">{title} Chart</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis label={{ value: "FPY %", angle: -90, position: "insideLeft" }} />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="fpy"
                stroke="#0088FE"
                name="FPY %"
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      );

    case "oee":
      return (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">{title} Chart</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="sessionId" />
              <YAxis label={{ value: "Percentage %", angle: -90, position: "insideLeft" }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="quality" fill="#0088FE" name="Quality %" />
              <Bar dataKey="efficiency" fill="#00C49F" name="Efficiency" />
              <Bar dataKey="oee" fill="#FFBB28" name="OEE %" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      );

    case "operator":
      return (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">{title} Chart</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="operatorName" />
              <YAxis yAxisId="left" label={{ value: "Pass Rate %", angle: -90, position: "insideLeft" }} />
              <YAxis yAxisId="right" orientation="right" label={{ value: "Speed (f/min)", angle: 90, position: "insideRight" }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="passRate" fill="#0088FE" name="Pass Rate %" />
              <Bar yAxisId="right" dataKey="feedersPerMinute" fill="#00C49F" name="Speed (f/min)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      );

    case "operator-comparison":
      return (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">{title} Chart</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="operatorName" />
              <YAxis label={{ value: "Percentage %", angle: -90, position: "insideLeft" }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="accuracy" fill="#0088FE" name="Accuracy %" />
              <Bar dataKey="errors" fill="#FF8042" name="Errors %" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      );

    case "feeder":
      return (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Top 10 Feeders by Error Rate</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.slice(0, 10)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="feederNumber" />
              <YAxis label={{ value: "Error Rate %", angle: -90, position: "insideLeft" }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="errorRate" fill="#FF8042" name="Error Rate %" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      );

    case "trend":
      return (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">{title} Chart</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis yAxisId="left" label={{ value: "Count", angle: -90, position: "insideLeft" }} />
              <YAxis yAxisId="right" orientation="right" label={{ value: "Pass Rate %", angle: 90, position: "insideRight" }} />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="totalScans" stroke="#0088FE" name="Total Scans" />
              <Line yAxisId="left" type="monotone" dataKey="passCount" stroke="#00C49F" name="Pass Count" />
              <Line yAxisId="right" type="monotone" dataKey="passRate" stroke="#FFBB28" name="Pass Rate %" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      );

    case "error-analysis":
      const top5Errors = data.slice(0, 5);
      return (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Top 5 Failing Components</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={top5Errors}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="identifier" />
              <YAxis label={{ value: "Fail Count", angle: -90, position: "insideLeft" }} />
              <Tooltip />
              <Bar dataKey="failCount" fill="#FF8042" name="Fail Count" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      );

    case "component":
      const top10Components = data.slice(0, 10);
      return (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Top 10 Components by Usage</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={top10Components}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="mpn" />
              <YAxis yAxisId="left" label={{ value: "Usage Count", angle: -90, position: "insideLeft" }} />
              <YAxis yAxisId="right" orientation="right" label={{ value: "Fail Count", angle: 90, position: "insideRight" }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="usageCount" fill="#0088FE" name="Usage" />
              <Bar yAxisId="right" dataKey="failCount" fill="#FF8042" name="Failures" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      );

    default:
      return null;
  }
};
