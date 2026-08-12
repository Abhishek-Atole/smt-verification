import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { findIdempotencyAudit } from "@/lib/idempotency";
import { matchScan } from "@/lib/scan-matcher";
import { getChangeoverProgress } from "@/lib/progress";
import { requireSession } from "@/lib/route-auth";

const ScanSchema = z.object({
  scannedValue: z.string().min(1),
  lotCode: z.string().optional(),
  idempotencyKey: z.string().uuid(),
});

const LotSchema = z.object({
  lineItemId: z.string().uuid(),
  lotCode: z.string().nullable(),
  idempotencyKey: z.string().uuid().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession();
  if (error) return error;

  const { id: changeoverId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = ScanSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { scannedValue, lotCode, idempotencyKey } = parsed.data;

  const cachedSuccess = await findIdempotencyAudit({
    eventType: "scan_ok",
    idempotencyKey,
    userId: session.user.id,
    changeoverId,
  });
  if (cachedSuccess) {
    const cachedPayload = cachedSuccess.payload as { scanId?: string };
    if (cachedPayload.scanId) {
      const scan = await prisma.verificationScan.findUnique({
        where: { id: cachedPayload.scanId },
        select: {
          id: true,
          lineItemId: true,
          scannedMpn: true,
          scannedLotCode: true,
          matchType: true,
          isAlternate: true,
          scannedAt: true,
          lineItem: { select: { feederNumber: true, description: true } },
          alternative: { select: { make: true, mpn: true, rank: true } },
        },
      });

      if (scan) {
        const progress = await getChangeoverProgress(changeoverId);
        return NextResponse.json(
          {
            scan,
            match: {
              feederNumber: scan.lineItem.feederNumber,
              make: scan.alternative.make,
              matchType: scan.matchType,
              isAlternate: scan.isAlternate,
            },
            progress,
          },
          { status: 201 },
        );
      }
    }
  }

  const cachedFailure = await findIdempotencyAudit({
    eventType: "scan_fail",
    idempotencyKey,
    userId: session.user.id,
    changeoverId,
  });
  if (cachedFailure) {
    return NextResponse.json(
      { error: "NO_MATCH", message: `\"${scannedValue}\" not found in BOM` },
      { status: 422 },
    );
  }

  const changeover = await prisma.changeover.findUnique({
    where: { id: changeoverId },
    select: {
      id: true,
      bomHeaderId: true,
      operatorId: true,
      status: true,
      version: true,
    },
  });
  if (!changeover) return NextResponse.json({ error: "Changeover not found" }, { status: 404 });

  const isOwner = changeover.operatorId === session.user.id;
  const canWrite = isOwner || ["engineer", "admin"].includes(session.user.role);
  if (!canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (changeover.status !== "in_progress") {
    return NextResponse.json({ error: `Changeover is ${changeover.status}` }, { status: 409 });
  }

  const match = await matchScan(changeover.bomHeaderId, scannedValue);
  if (!match) {
    await prisma.auditLog.create({
      data: {
        changeoverId,
        userId: session.user.id,
        eventType: "scan_fail",
        payload: { scannedValue, reason: "no_match", idempotencyKey },
      },
    });

    return NextResponse.json(
      { error: "NO_MATCH", message: `\"${scannedValue}\" not found in BOM` },
      { status: 422 },
    );
  }

  try {
    const scan = await prisma.verificationScan.create({
      data: {
        changeoverId,
        lineItemId: match.lineItemId,
        alternativeId: match.alternativeId,
        scannedMpn: scannedValue.trim().toUpperCase(),
        scannedLotCode: lotCode ?? null,
        matchType: match.matchType,
        isAlternate: match.isAlternate,
        scannedBy: session.user.id,
      },
      select: {
        id: true,
        lineItemId: true,
        scannedMpn: true,
        scannedLotCode: true,
        matchType: true,
        isAlternate: true,
        scannedAt: true,
        lineItem: { select: { feederNumber: true, description: true } },
        alternative: { select: { make: true, mpn: true, rank: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        changeoverId,
        userId: session.user.id,
        eventType: "scan_ok",
        payload: {
          idempotencyKey,
          scanId: scan.id,
          feeder: scan.lineItem.feederNumber,
          mpn: scan.scannedMpn,
          matchType: scan.matchType,
          isAlternate: scan.isAlternate,
          make: scan.alternative.make,
          lot: scan.scannedLotCode,
        },
      },
    });

    const progress = await getChangeoverProgress(changeoverId);

    if (progress.isComplete) {
      await prisma.changeover.update({
        where: { id: changeoverId },
        data: { status: "verified", version: { increment: 1 } },
      });
    }

    return NextResponse.json(
      {
        scan,
        match: {
          feederNumber: match.feederNumber,
          make: match.make,
          matchType: match.matchType,
          isAlternate: match.isAlternate,
        },
        progress,
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    if (typeof err === "object" && err && "code" in err && err.code === "P2002") {
      return NextResponse.json(
        {
          error: "DUPLICATE",
          message: `Feeder ${match.feederNumber} already verified in this changeover`,
        },
        { status: 409 },
      );
    }

    throw err;
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession();
  if (error) return error;

  const { id: changeoverId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = LotSchema.safeParse(body);

  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const idempotencyKey = parsed.data.idempotencyKey || crypto.randomUUID();
  const cachedAudit = await findIdempotencyAudit({
    eventType: "scan_lot",
    idempotencyKey,
    userId: session.user.id,
    changeoverId,
  });
  if (cachedAudit) {
    return NextResponse.json({ ok: true });
  }

  const changeover = await prisma.changeover.findUnique({
    where: { id: changeoverId },
    select: { operatorId: true },
  });

  if (!changeover) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const canWrite = changeover.operatorId === session.user.id || ["engineer", "admin"].includes(session.user.role);
  if (!canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const updated = await prisma.verificationScan.updateMany({
    where: {
      changeoverId,
      lineItemId: parsed.data.lineItemId,
    },
    data: {
      scannedLotCode: parsed.data.lotCode,
    },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  if (parsed.data.idempotencyKey) {
    await prisma.auditLog.create({
      data: {
        changeoverId,
        userId: session.user.id,
        eventType: "scan_lot",
        payload: {
          idempotencyKey: parsed.data.idempotencyKey,
          lineItemId: parsed.data.lineItemId,
          lotCode: parsed.data.lotCode,
        },
      },
    });
  }

  return NextResponse.json({ ok: true });
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

  const scans = await prisma.verificationScan.findMany({
    where: { changeoverId: id },
    select: {
      id: true,
      lineItemId: true,
      scannedMpn: true,
      scannedLotCode: true,
      matchType: true,
      isAlternate: true,
      scannedAt: true,
      lineItem: { select: { feederNumber: true, description: true, packageDesc: true } },
      alternative: { select: { make: true, mpn: true, rank: true } },
      scannedByUser: { select: { name: true, employeeId: true } },
    },
    orderBy: { scannedAt: "asc" },
  });

  return NextResponse.json({ scans });
}
