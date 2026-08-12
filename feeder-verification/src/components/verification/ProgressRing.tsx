interface ProgressRingProps {
  percentage: number;
}

export function ProgressRing({ percentage }: ProgressRingProps) {
  return (
    <div className="rounded-lg border border-neutral-200 p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-500">Verification Progress</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-900">{percentage}%</p>
    </div>
  );
}
