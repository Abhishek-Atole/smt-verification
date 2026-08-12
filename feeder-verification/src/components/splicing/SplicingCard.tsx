import { ReactNode } from "react";

export function SplicingCard({ children }: { children: ReactNode }) {
  return <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">{children}</section>;
}
