import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/route-auth";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession();
  if (error) return error;

  const { id } = await params;

  const changeover = await prisma.changeover.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      lineNumber: true,
      shift: true,
      startedAt: true,
      completedAt: true,
      notes: true,
      version: true,
      operatorId: true,
      operator: { select: { name: true, employeeId: true, role: true } },
      bomHeader: {
        select: {
          id: true,
          bomNumber: true,
          revision: true,
          customerName: true,
          lineItems: {
            select: { id: true, feederNumber: true, description: true, packageDesc: true },
          },
        },
      },
    },
  });

  if (!changeover) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const canView =
    changeover.operatorId === session.user.id || ["qa", "engineer", "admin"].includes(session.user.role);

  if (!canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json({ changeover });
}
