import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/route-auth";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; scanId: string }> },
) {
  const { session, error } = await requireSession();
  if (error) return error;

  if (session.user.role !== "engineer" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, scanId } = await params;

  const deleted = await prisma.verificationScan.deleteMany({
    where: {
      id: scanId,
      changeoverId: id,
    },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.auditLog.create({
    data: {
      changeoverId: id,
      userId: session.user.id,
      eventType: "scan_deleted",
      payload: { scanId },
    },
  });

  return NextResponse.json({ ok: true });
}
