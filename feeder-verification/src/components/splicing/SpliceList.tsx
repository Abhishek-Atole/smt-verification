import { SpliceEntry } from "@/store/useSplicingStore";

export function SpliceList({ entries }: { entries: SpliceEntry[] }) {
  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-md border border-neutral-200 p-3 text-sm">
          <p className="font-medium text-neutral-900">{entry.feederNumber}</p>
          <p className="text-neutral-600">
            {entry.oldSpoolMpn} {"->"} {entry.newSpoolMpn}
          </p>
          <p className="text-xs text-neutral-500">{new Date(entry.splicedAt).toLocaleString()}</p>
        </li>
      ))}
    </ul>
  );
}
