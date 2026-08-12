import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { authOptions } from "@/lib/auth";
import type { AnalyticsRole } from "@/lib/analytics/types";

export default async function AnalyticsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login");
  }

  return <AnalyticsDashboard role={(session.user.role as AnalyticsRole) ?? "operator"} />;
}
