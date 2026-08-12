import { NextRequest } from "next/server";
import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  resolveOperatorScope: vi.fn(),
  getOverviewKPIs: vi.fn(),
  getDurationTrend: vi.fn(),
  getFeederErrorSummary: vi.fn(),
  getHealthSummary: vi.fn(),
  getLineUtilization: vi.fn(),
  getMPNUsage: vi.fn(),
  getOperatorStats: vi.fn(),
  getRealtimeScanVolume: vi.fn(),
  getShiftStats: vi.fn(),
  getSpliceStats: vi.fn(),
  getCostMetrics: vi.fn(),
  getDataQualityMetrics: vi.fn(),
  getAuditTrail: vi.fn(),
  getAnalyticsExportBundle: vi.fn(),
}));

vi.mock("@/lib/route-auth", () => ({
  requireSession: mocks.requireSession,
}));

vi.mock("@/lib/analytics/access", () => ({
  resolveOperatorScope: mocks.resolveOperatorScope,
}));

vi.mock("@/lib/analytics/queries", () => ({
  getAnalyticsExportBundle: mocks.getAnalyticsExportBundle,
  getAuditTrail: mocks.getAuditTrail,
  getDurationTrend: mocks.getDurationTrend,
  getFeederErrorSummary: mocks.getFeederErrorSummary,
  getHealthSummary: mocks.getHealthSummary,
  getLineUtilization: mocks.getLineUtilization,
  getMPNUsage: mocks.getMPNUsage,
  getOperatorStats: mocks.getOperatorStats,
  getOverviewKPIs: mocks.getOverviewKPIs,
  getRealtimeScanVolume: mocks.getRealtimeScanVolume,
  getShiftStats: mocks.getShiftStats,
  getSpliceStats: mocks.getSpliceStats,
  getCostMetrics: mocks.getCostMetrics,
  getDataQualityMetrics: mocks.getDataQualityMetrics,
}));

import { GET } from "../app/api/analytics/[report]/route";

describe("analytics cache policy", () => {
  test("authenticated analytics responses are private and no-store", async () => {
    mocks.requireSession.mockResolvedValue({
      session: {
        user: {
          id: "user-1",
          role: "qa",
        },
      },
      error: null,
    });
    mocks.resolveOperatorScope.mockReturnValue("user-1");
    mocks.getOverviewKPIs.mockResolvedValue({ total: 1 });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/analytics/overview?days=7"),
      { params: Promise.resolve({ report: "overview" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Cache-Control")).not.toContain("public");
  });
});
