import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Use signOut() from next-auth/react",
    },
    { status: 410 },
  );
}
