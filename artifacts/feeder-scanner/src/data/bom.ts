import type { BOMEntry, ComponentOption } from "@/types";

export const BOM_DATA: BOMEntry[] = [
  {
    feederId: "F01",
    alternatives: [
      { mpn: "CAP-100N-0402", partId: "P1001", description: "100nF Capacitor 0402" },
      {
        mpn: "CAP-100N-0402-ALT",
        partId: "P1001B",
        description: "100nF Capacitor 0402 Alt Brand",
      },
    ],
  },
  {
    feederId: "F02",
    alternatives: [
      { mpn: "RES-10K-0603", partId: "P2001", description: "10K Resistor 0603" },
      { mpn: "RES-10K-0603-ALT1", partId: "P2001B", description: "10K Resistor 0603 Alt 1" },
      { mpn: "RES-10K-0603-ALT2", partId: "P2001C", description: "10K Resistor 0603 Alt 2" },
    ],
  },
];

export const getBOMEntry = (feederId: string, entries: BOMEntry[] = BOM_DATA): BOMEntry | undefined =>
  entries.find((entry) => entry.feederId.toUpperCase() === feederId.toUpperCase());

export const validateComponent = (
  feederId: string,
  scannedValue: string,
  entries: BOMEntry[] = BOM_DATA,
): ComponentOption | null => {
  const entry = getBOMEntry(feederId, entries);
  if (!entry) {
    return null;
  }

  const normalized = scannedValue.trim().toUpperCase();

  return (
    entry.alternatives.find(
      (alt) => alt.mpn.toUpperCase() === normalized || alt.partId.toUpperCase() === normalized,
    ) ?? null
  );
};
