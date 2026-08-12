import { ReactNode } from "react";

export function VerificationCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-base font-semibold text-neutral-900">{title}</h2>
      {children}
    </section>
  );
}
