import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { findIdempotencyAudit } from "@/lib/idempotency";
import { requireSession } from "@/lib/route-auth";

const CreateSchema = z.object({
  bomHeaderId: z.string().uuid(),
  lineNumber: z.string().optional(),
  shift: z.enum(["MORNING", "EVENING", "NIGHT"]).optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const { session, error } = await requireSession();
  if (error) return error;

  if (!["operator", "engineer", "admin"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden - QA cannot create changeovers" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const idempotencyKey = parsed.data.idempotencyKey || crypto.randomUUID();
  const cachedAudit = await findIdempotencyAudit({
    eventType: "changeover_created",
    idempotencyKey,
    userId: session.user.id,
  });
  if (cachedAudit) {
    const cachedPayload = cachedAudit.payload as { changeoverId?: string };
    if (cachedPayload.changeoverId) {
      const existing = await prisma.changeover.findUnique({
        where: { id: cachedPayload.changeoverId },
        select: {
          id: true,
          status: true,
          startedAt: true,
          lineNumber: true,
          shift: true,
          operator: { select: { name: true, employeeId: true } },
          bomHeader: { select: { bomNumber: true, revision: true } },
        },
      });

      if (existing) {
        return NextResponse.json({ changeover: existing }, { status: 201 });
      }
    }
  }

  const changeover = await prisma.changeover.create({
    data: {
      bomHeaderId: parsed.data.bomHeaderId,
      operatorId: session.user.id,
      lineNumber: parsed.data.lineNumber,
      shift: parsed.data.shift,
      notes: parsed.data.notes,
    },
    select: {
      id: true,
      status: true,
      startedAt: true,
      lineNumber: true,
      shift: true,
      operator: { select: { name: true, employeeId: true } },
      bomHeader: { select: { bomNumber: true, revision: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      changeoverId: changeover.id,
      userId: session.user.id,
      eventType: "changeover_created",
      payload: {
        changeoverId: changeover.id,
        bomHeaderId: parsed.data.bomHeaderId,
        idempotencyKey: parsed.data.idempotencyKey,
      },
    },
  });

  return NextResponse.json({ changeover }, { status: 201 });
}

export async function GET() {
  const { session, error } = await requireSession();
  if (error) return error;

  const isPrivileged = ["qa", "engineer", "admin"].includes(session.user.role);
  const where = isPrivileged ? {} : { operatorId: session.user.id };

  const changeovers = await prisma.changeover.findMany({
    where,
    select: {
      id: true,
      status: true,
      lineNumber: true,
      shift: true,
      startedAt: true,
      completedAt: true,
      operator: { select: { name: true, employeeId: true, role: true } },
      bomHeader: { select: { bomNumber: true, revision: true, customerName: true } },
      _count: {
        select: {
          verificationScans: true,
          spliceRecords: true,
        },
      },
    },
    orderBy: { startedAt: "desc" },
  });

  return NextResponse.json({ changeovers });
}
