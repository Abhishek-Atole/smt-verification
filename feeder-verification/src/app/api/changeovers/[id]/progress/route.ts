import { NextRequest, NextResponse } from "next/server";
import { getChangeoverProgress } from "@/lib/progress";
import { requireSession } from "@/lib/route-auth";
import { prisma } from "@/lib/prisma";

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

  const progress = await getChangeoverProgress(id);
  return NextResponse.json({ progress });
}
