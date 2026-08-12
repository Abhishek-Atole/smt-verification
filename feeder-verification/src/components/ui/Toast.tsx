"use client";

export function Toast({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 shadow-sm">
      {message}
    </div>
  );
}
