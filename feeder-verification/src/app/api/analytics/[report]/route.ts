import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/route-auth";
import { resolveOperatorScope } from "@/lib/analytics/access";
import {
  getAnalyticsExportBundle,
  getAuditTrail,
  getDurationTrend,
  getFeederErrorSummary,
  getHealthSummary,
  getLineUtilization,
  getMPNUsage,
  getOperatorStats,
  getOverviewKPIs,
  getRealtimeScanVolume,
  getShiftStats,
  getSpliceStats,
  getCostMetrics,
  getDataQualityMetrics,
} from "@/lib/analytics/queries";

const daysSchema = z.coerce.number().int().min(1).max(365).default(7);
const reportSchema = z.enum([
  "overview",
  "duration",
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
  "refresh",
  "cost",
  "dataQuality",
]);

function buildRange(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

async function requireAnalyticsSession() {
  const { session, error } = await requireSession();
  if (error || !session) {
    return { session: null, error };
  }

  return { session, error: null };
}

export async function GET(req: NextRequest, context: { params: Promise<{ report: string }> }) {
  const { session, error } = await requireAnalyticsSession();
  if (error || !session) return error;

  const { report } = await context.params;
  const parsedReport = reportSchema.safeParse(report);
  if (!parsedReport.success) {
    return NextResponse.json({ error: "Unknown analytics report" }, { status: 404 });
  }

  const role = session.user.role as "operator" | "qa" | "engineer" | "admin";
  const operatorId = resolveOperatorScope(role, session.user.id);
  const days = daysSchema.parse(req.nextUrl.searchParams.get("days") ?? "7");
  const range = buildRange(days);
  const bomHeaderId = req.nextUrl.searchParams.get("bomHeaderId") || undefined;

  switch (parsedReport.data) {
    case "overview":
      return NextResponse.json({ kpis: await getOverviewKPIs(operatorId, range) }, { headers: { "Cache-Control": "public, max-age=60" } });
    case "duration":
      return NextResponse.json({ data: await getDurationTrend(operatorId, days) }, { headers: { "Cache-Control": "public, max-age=60" } });
    case "operators":
      if (role === "operator") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json({ data: await getOperatorStats(range) }, { headers: { "Cache-Control": "public, max-age=60" } });
    case "feeders":
      if (role === "operator") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json({ data: await getFeederErrorSummary(operatorId, days, bomHeaderId) }, { headers: { "Cache-Control": "public, max-age=60" } });
    case "shifts":
      if (role === "operator") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json({ data: await getShiftStats(operatorId, range) }, { headers: { "Cache-Control": "public, max-age=60" } });
    case "lines":
      if (role === "operator") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json({ data: await getLineUtilization(operatorId, range) }, { headers: { "Cache-Control": "public, max-age=60" } });
    case "alternates":
      return NextResponse.json({ data: await getMPNUsage(operatorId, range, bomHeaderId) }, { headers: { "Cache-Control": "public, max-age=60" } });
    case "splicing":
      if (role === "operator") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json({ data: await getSpliceStats(operatorId, range) }, { headers: { "Cache-Control": "public, max-age=60" } });
    case "audit":
      if (role === "operator") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json({ data: await getAuditTrail(operatorId, 100) }, { headers: { "Cache-Control": "public, max-age=60" } });
    case "realtime":
      return NextResponse.json({ data: await getRealtimeScanVolume(operatorId) }, { headers: { "Cache-Control": "no-store" } });
    case "health":
      if (role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json({ health: await getHealthSummary(operatorId) }, { headers: { "Cache-Control": "public, max-age=60" } });
    case "export":
      if (role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json({ bundle: await getAnalyticsExportBundle(operatorId, range) }, { headers: { "Cache-Control": "no-store" } });
    case "cost":
      if (role === "operator") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const costMetrics = await getCostMetrics(bomHeaderId ?? null, range);
      return NextResponse.json(
        costMetrics ? { metrics: costMetrics } : { error: "No cost data available" },
        { headers: { "Cache-Control": "public, max-age=300" } }
      );
    case "dataQuality":
      if (role !== "admin" && role !== "engineer") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const dqMetrics = await getDataQualityMetrics();
      return NextResponse.json({ metrics: dqMetrics }, { headers: { "Cache-Control": "public, max-age=600" } });
    case "refresh":
      return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
    default:
      return NextResponse.json({ error: "Unsupported analytics report" }, { status: 404 });
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ report: string }> }) {
  const { report } = await context.params;
  const parsedReport = reportSchema.safeParse(report);
  if (!parsedReport.success || parsedReport.data !== "refresh") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("REFRESH MATERIALIZED VIEW mv_changeover_summary");
    await transaction.$executeRawUnsafe("REFRESH MATERIALIZED VIEW mv_feeder_errors");
    await transaction.$executeRawUnsafe("REFRESH MATERIALIZED VIEW mv_operator_daily");
    await transaction.$executeRawUnsafe("REFRESH MATERIALIZED VIEW mv_mpn_usage");
    await transaction.$executeRawUnsafe("REFRESH MATERIALIZED VIEW mv_splice_frequency");
  });

  const refreshUserId = process.env.ANALYTICS_REFRESH_USER_ID ?? (await prisma.user.findFirst({ where: { role: "admin" }, select: { id: true } }))?.id;
  if (refreshUserId) {
    await prisma.auditLog.create({
      data: {
        userId: refreshUserId,
        eventType: "analytics_refresh",
        payload: {
          refreshedBy: "cron",
          refreshedInMs: Date.now() - startedAt,
        },
      },
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true, refreshedInMs: Date.now() - startedAt }, { headers: { "Cache-Control": "no-store" } });
}
