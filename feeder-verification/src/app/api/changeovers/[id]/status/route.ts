import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ChangeoverStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findIdempotencyAudit } from "@/lib/idempotency";
import { requireSession } from "@/lib/route-auth";

const PatchSchema = z.object({
  status: z.nativeEnum(ChangeoverStatus),
  version: z.number().int().min(0),
  idempotencyKey: z.string().uuid().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession();
  if (error) return error;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const idempotencyKey = parsed.data.idempotencyKey || crypto.randomUUID();
  const cachedAudit = await findIdempotencyAudit({
    eventType: "changeover_status",
    idempotencyKey,
    userId: session.user.id,
    changeoverId: id,
  });
  if (cachedAudit) {
    return NextResponse.json({ ok: true });
  }

  const current = await prisma.changeover.findUnique({
    where: { id },
    select: { operatorId: true, version: true },
  });

  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const canWrite = current.operatorId === session.user.id || ["engineer", "admin"].includes(session.user.role);
  if (!canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const updated = await prisma.changeover.updateMany({
    where: { id, version: parsed.data.version },
    data: {
      status: parsed.data.status,
      completedAt: parsed.data.status === "complete" ? new Date() : null,
      version: { increment: 1 },
    },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "CONFLICT", message: "Stale version. Please refresh and retry." }, { status: 409 });
  }

  await prisma.auditLog.create({
    data: {
      changeoverId: id,
      userId: session.user.id,
      eventType: "changeover_status",
      payload: {
        status: parsed.data.status,
        idempotencyKey: parsed.data.idempotencyKey,
      },
    },
  });

  return NextResponse.json({ ok: true });
}
