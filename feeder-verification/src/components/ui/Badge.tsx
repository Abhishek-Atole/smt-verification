import { ReactNode } from "react";

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700">
      {children}
    </span>
  );
}
