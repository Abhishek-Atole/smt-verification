import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBomCsv } from "@/lib/bom-parser";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/route-auth";

const UploadSchema = z.object({
  csv: z.string().min(1),
});

export async function GET() {
  const { error } = await requireSession();
  if (error) return error;

  const boms = await prisma.bomHeader.findMany({
    where: { isActive: true },
    select: {
      id: true,
      bomNumber: true,
      revision: true,
      bomDate: true,
      customerName: true,
      partNameInternal: true,
      _count: { select: { lineItems: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ boms });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireSession();
  if (error) return error;

  if (!["engineer", "admin"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = UploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const bom = parseBomCsv(parsed.data.csv);

  const created = await prisma.$transaction(async (tx) => {
    const header = await tx.bomHeader.create({
      data: {
        bomNumber: bom.bomNumber,
        revision: bom.revision,
        bomDate: bom.bomDate,
        customerName: bom.customerName,
        partNameInternal: bom.partNameInternal,
      },
      select: { id: true, bomNumber: true, revision: true },
    });

    for (let index = 0; index < bom.lines.length; index += 1) {
      const line = bom.lines[index];
      const lineItem = await tx.bomLineItem.create({
        data: {
          bomHeaderId: header.id,
          srNo: index + 1,
          feederNumber: line.feederNumber,
          ucalPartNumbers: line.ucalPartNumbers,
          description: line.description,
          packageDesc: line.packageDesc,
        },
        select: { id: true },
      });

      if (!line.alternatives.length) continue;
      await tx.bomAlternative.createMany({
        data: line.alternatives.map((alternative) => ({
          lineItemId: lineItem.id,
          rank: alternative.rank,
          make: alternative.make,
          mpn: alternative.mpn,
          supplierCode: alternative.supplierCode,
        })),
      });
    }

    return header;
  });

  return NextResponse.json({ bom: created }, { status: 201 });
}
