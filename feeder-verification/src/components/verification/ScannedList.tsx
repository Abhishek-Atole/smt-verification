import { ScannedFeeder } from "@/store/useVerificationStore";

export function ScannedList({ scans }: { scans: ScannedFeeder[] }) {
  return (
    <div className="flex-1 overflow-auto p-4">
      <h3 className="mb-3 text-sm font-semibold text-neutral-700">Scanned Feeders</h3>
      <ul className="space-y-2">
        {scans.map((scan) => (
          <li key={scan.lineItemId} className="rounded-md border border-neutral-200 p-3 text-sm">
            <p className="font-medium text-neutral-900">{scan.feederNumber}</p>
            <p className="text-neutral-600">{scan.scannedMpn}</p>
            <p className="text-xs text-neutral-500">LOT: {scan.lotCode ?? "-"}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
