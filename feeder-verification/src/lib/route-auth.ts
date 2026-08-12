import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function requireSession() {
  const session = await getServerSession(authOptions);
  const user = session?.user;

  if (!user) {
    return {
      session: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { session, error: null };
}
