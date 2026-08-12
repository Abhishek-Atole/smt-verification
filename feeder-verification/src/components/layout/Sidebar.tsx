"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/changeover/new", label: "New Changeover" },
  { href: "/bom", label: "BOM" },
  { href: "/admin", label: "Admin" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 border-r border-neutral-200 bg-neutral-50 p-4">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-700">Feeder Verification</h2>
      <nav className="flex flex-col gap-2">
        {LINKS.map((link) => {
          const active = pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-md px-3 py-2 text-sm ${
                active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
