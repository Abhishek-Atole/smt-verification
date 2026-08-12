import { NextResponse } from "next/server";

export async function POST(req: Request) {
  return NextResponse.json(
    {
      error: "Use NextAuth signIn(\"credentials\") for login",
    },
    { status: 410 },
  );
}
