import type { AnalyticsRole, AnalyticsTab } from "./types";

export function resolveOperatorScope(role: AnalyticsRole, userId: string): string | null {
  return role === "operator" ? userId : null;
}

export function canViewManagementTabs(role: AnalyticsRole): boolean {
  return role !== "operator";
}

export function canViewHealthPanel(role: AnalyticsRole): boolean {
  return role === "admin";
}

export function canViewExport(role: AnalyticsRole): boolean {
  return role === "admin";
}

export function canViewCostMetrics(role: AnalyticsRole): boolean {
  return role === "admin" || role === "engineer";
}

export function canViewDataQuality(role: AnalyticsRole): boolean {
  return role === "admin" || role === "engineer";
}

export function canViewOperatorDetails(role: AnalyticsRole): boolean {
  return role !== "operator";
}

export function canExportAnalytics(role: AnalyticsRole): boolean {
  return role === "admin";
}

export function tabAllowedForRole(tab: AnalyticsTab, role: AnalyticsRole): boolean {
  if (role === "operator") {
    return tab === "overview" || tab === "realtime";
  }

  if (role === "qa") {
    return tab !== "health" && tab !== "export";
  }

  if (role === "engineer") {
    return tab !== "health" && tab !== "export";
  }

  return true;
}

export function getAccessibleTabs(role: AnalyticsRole): AnalyticsTab[] {
  const allTabs: AnalyticsTab[] = [
    "overview",
    "operators",
    "feeders",
    "shifts",
    "lines",
    "alternates",
    "splicing",
    "audit",
    "realtime",
    "health",
    "export",
  ];

  return allTabs.filter((tab) => tabAllowedForRole(tab, role));
}

export function formatRoleLabel(role: AnalyticsRole): string {
  const labels: Record<AnalyticsRole, string> = {
    operator: "Operator",
    qa: "QA",
    engineer: "Engineer",
    admin: "Administrator",
  };
  return labels[role];
}

export function getRoleDescription(role: AnalyticsRole): string {
  const descriptions: Record<AnalyticsRole, string> = {
    operator: "View personal overview and real-time scan data",
    qa: "View all management reports except health and export",
    engineer: "View all management reports except health and export",
    admin: "Full access to all analytics reports including health and export",
  };
  return descriptions[role];
}
