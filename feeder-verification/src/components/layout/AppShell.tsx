import { ReactNode } from "react";
import { Sidebar } from "@/components/layout/Sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-white text-neutral-900">
      <Sidebar />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
