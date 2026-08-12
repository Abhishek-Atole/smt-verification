import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return <AppShell>{children}</AppShell>;
}
