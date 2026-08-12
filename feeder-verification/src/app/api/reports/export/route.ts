import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/route-auth";

export async function GET(req: NextRequest) {
  const { session, error } = await requireSession();
  if (error) return error;

  if (!["qa", "engineer", "admin"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const search = req.nextUrl.searchParams;
  const dateFrom = search.get("dateFrom");
  const dateTo = search.get("dateTo");

  const where: { startedAt?: { gte?: Date; lte?: Date } } = {};

  if (dateFrom || dateTo) {
    where.startedAt = {};
    if (dateFrom) where.startedAt.gte = new Date(dateFrom);
    if (dateTo) where.startedAt.lte = new Date(dateTo);
  }

  const changeovers = await prisma.changeover.findMany({
    where,
    select: {
      id: true,
      status: true,
      startedAt: true,
      completedAt: true,
      lineNumber: true,
      shift: true,
      operator: { select: { name: true, employeeId: true } },
      bomHeader: { select: { bomNumber: true, revision: true } },
      _count: { select: { verificationScans: true, spliceRecords: true } },
    },
    orderBy: { startedAt: "desc" },
  });

  return NextResponse.json({ changeovers });
}
