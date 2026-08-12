import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getChangeoverProgress } from "@/lib/progress";
import { requireSession } from "@/lib/route-auth";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession();
  if (error) return error;

  const { id } = await params;

  const changeover = await prisma.changeover.findUnique({
    where: { id },
    select: {
      id: true,
      operatorId: true,
      status: true,
      lineNumber: true,
      shift: true,
      startedAt: true,
      completedAt: true,
      operator: { select: { name: true, employeeId: true, role: true } },
      bomHeader: { select: { bomNumber: true, revision: true, customerName: true } },
      verificationScans: {
        select: {
          id: true,
          scannedMpn: true,
          scannedLotCode: true,
          matchType: true,
          isAlternate: true,
          scannedAt: true,
          lineItem: { select: { feederNumber: true, description: true } },
          alternative: { select: { make: true, mpn: true, rank: true } },
        },
      },
      spliceRecords: {
        select: {
          id: true,
          oldSpoolMpn: true,
          oldSpoolLot: true,
          newSpoolMpn: true,
          newSpoolLot: true,
          splicedAt: true,
          lineItem: { select: { feederNumber: true } },
        },
      },
    },
  });

  if (!changeover) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const canView =
    changeover.operatorId === session.user.id || ["qa", "engineer", "admin"].includes(session.user.role);

  if (!canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const progress = await getChangeoverProgress(id);

  return NextResponse.json({
    report: {
      ...changeover,
      progress,
    },
  });
}
