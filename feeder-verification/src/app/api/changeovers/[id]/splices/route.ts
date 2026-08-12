import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { findIdempotencyAudit } from "@/lib/idempotency";
import { matchScan } from "@/lib/scan-matcher";
import { requireSession } from "@/lib/route-auth";

const SpliceSchema = z.object({
  oldSpoolMpn: z.string().min(1),
  oldSpoolLot: z.string().optional(),
  newSpoolMpn: z.string().min(1),
  newSpoolLot: z.string().optional(),
  idempotencyKey: z.string().uuid(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession();
  if (error) return error;

  const { id: changeoverId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = SpliceSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { oldSpoolMpn, oldSpoolLot, newSpoolMpn, newSpoolLot, idempotencyKey } = parsed.data;

  const cachedAudit = await findIdempotencyAudit({
    eventType: "splice",
    idempotencyKey,
    userId: session.user.id,
    changeoverId,
  });
  if (cachedAudit) {
    const cachedPayload = cachedAudit.payload as { spliceId?: string };
    if (cachedPayload.spliceId) {
      const existing = await prisma.spliceRecord.findUnique({
        where: { id: cachedPayload.spliceId },
        select: {
          id: true,
          lineItemId: true,
          oldSpoolMpn: true,
          oldSpoolLot: true,
          newSpoolMpn: true,
          newSpoolLot: true,
          splicedAt: true,
          lineItem: { select: { feederNumber: true } },
        },
      });

      if (existing) {
        return NextResponse.json({ splice: existing }, { status: 201 });
      }
    }
  }

  const changeover = await prisma.changeover.findUnique({
    where: { id: changeoverId },
    select: {
      status: true,
      bomHeaderId: true,
      operatorId: true,
    },
  });

  if (!changeover) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (![
    "verified",
    "splicing",
  ].includes(changeover.status)) {
    return NextResponse.json({ error: "Verification not complete" }, { status: 409 });
  }

  const isOwner = changeover.operatorId === session.user.id;
  const canSplice = isOwner || ["engineer", "admin"].includes(session.user.role);
  if (!canSplice) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const oldMatch = await matchScan(changeover.bomHeaderId, oldSpoolMpn);
  if (!oldMatch) {
    return NextResponse.json(
      { error: "OLD_NO_MATCH", message: "Old spool MPN not in BOM" },
      { status: 422 },
    );
  }

  const newMatch = await matchScan(changeover.bomHeaderId, newSpoolMpn);
  if (!newMatch) {
    return NextResponse.json(
      { error: "NEW_NO_MATCH", message: "New spool MPN not in BOM" },
      { status: 422 },
    );
  }

  if (oldMatch.lineItemId !== newMatch.lineItemId) {
    return NextResponse.json(
      { error: "FEEDER_MISMATCH", message: "Splice must be on the same feeder slot" },
      { status: 422 },
    );
  }

  const splice = await prisma.spliceRecord.create({
    data: {
      changeoverId,
      lineItemId: oldMatch.lineItemId,
      oldSpoolMpn,
      oldSpoolLot,
      newSpoolMpn,
      newSpoolLot,
      splicedBy: session.user.id,
    },
    select: {
      id: true,
      lineItemId: true,
      oldSpoolMpn: true,
      oldSpoolLot: true,
      newSpoolMpn: true,
      newSpoolLot: true,
      splicedAt: true,
      lineItem: { select: { feederNumber: true } },
    },
  });

  await prisma.changeover.update({
    where: { id: changeoverId },
    data: { status: "splicing", version: { increment: 1 } },
  });

  await prisma.auditLog.create({
    data: {
      changeoverId,
      userId: session.user.id,
      eventType: "splice",
      payload: {
        spliceId: splice.id,
        idempotencyKey,
        lineItemId: oldMatch.lineItemId,
        oldSpoolMpn,
        newSpoolMpn,
      },
    },
  });

  return NextResponse.json({ splice }, { status: 201 });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession();
  if (error) return error;

  const { id } = await params;

  const changeover = await prisma.changeover.findUnique({
    where: { id },
    select: { operatorId: true },
  });
  if (!changeover) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const canView =
    changeover.operatorId === session.user.id || ["qa", "engineer", "admin"].includes(session.user.role);
  if (!canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const splices = await prisma.spliceRecord.findMany({
    where: { changeoverId: id },
    select: {
      id: true,
      lineItemId: true,
      oldSpoolMpn: true,
      oldSpoolLot: true,
      newSpoolMpn: true,
      newSpoolLot: true,
      splicedAt: true,
      lineItem: { select: { feederNumber: true } },
      splicedByUser: { select: { name: true, employeeId: true } },
    },
    orderBy: { splicedAt: "desc" },
  });

  return NextResponse.json({ splices });
}
