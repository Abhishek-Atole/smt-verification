import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/route-auth";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession();
  if (error) return error;

  const { id } = await params;

  const changeover = await prisma.changeover.findUnique({
    where: { id },
    select: { operatorId: true },
  });
  if (!changeover) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const canWrite = changeover.operatorId === session.user.id || ["engineer", "admin"].includes(session.user.role);
  if (!canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.changeover.update({
    where: { id },
    data: {
      status: "aborted",
      completedAt: new Date(),
      version: { increment: 1 },
    },
  });

  await prisma.auditLog.create({
    data: {
      changeoverId: id,
      userId: session.user.id,
      eventType: "changeover_aborted",
      payload: {},
    },
  });

  return NextResponse.json({ ok: true });
}
