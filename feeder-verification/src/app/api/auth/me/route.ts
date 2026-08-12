import { NextResponse } from "next/server";
import { requireSession } from "@/lib/route-auth";

export async function GET() {
  const { session, error } = await requireSession();
  if (error) return error;

  return NextResponse.json({
    user: {
      id: session.user.id,
      name: session.user.name,
      role: session.user.role,
      employeeId: session.user.employeeId,
    },
  });
}
