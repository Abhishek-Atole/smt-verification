export type MpnCandidate = {
  value: string;
  label: string;
  make: string;
  isPrimary: boolean;
};

export function normalizeMpn(val: string | null | undefined): string {
  if (!val) {
    return "";
  }

  const s = String(val).trim().toUpperCase();
  if (["", "N/A", "NA", "-", "NONE"].includes(s)) {
    return "";
  }

  return s;
}

export function buildCandidates(bomItem: any): MpnCandidate[] {
  const candidates: MpnCandidate[] = [];

  const m1 = normalizeMpn(bomItem.mpn1 ?? bomItem.mpn_1);
  const m2 = normalizeMpn(bomItem.mpn2 ?? bomItem.mpn_2);
  const m3 = normalizeMpn(bomItem.mpn3 ?? bomItem.mpn_3);
  const ipn = normalizeMpn(bomItem.internalPartNumber ?? bomItem.internal_part_number);

  if (m1) {
    candidates.push({ value: m1, label: "MPN 1", make: String(bomItem.make1 ?? bomItem.make_1 ?? ""), isPrimary: true });
  }

  if (m2) {
    candidates.push({ value: m2, label: "MPN 2", make: String(bomItem.make2 ?? bomItem.make_2 ?? ""), isPrimary: false });
  }

  if (m3) {
    candidates.push({ value: m3, label: "MPN 3", make: String(bomItem.make3 ?? bomItem.make_3 ?? ""), isPrimary: false });
  }

  if (ipn) {
    // Accept the full normalized internalPartNumber string as a candidate
    // (in addition to the individual tokens) so that scanning the entire
    // multi-word value matches without false "MPN Mismatch" errors.
    if (!candidates.some((c) => c.value === ipn)) {
      candidates.push({ value: ipn, label: "Internal ID", make: "", isPrimary: false });
    }
    ipn
      .split(/[\s/]+/)
      .map((token) => token.trim().toUpperCase())
      .filter(Boolean)
      .forEach((token) => {
        if (!candidates.some((c) => c.value === token)) {
          candidates.push({ value: token, label: "Internal ID", make: "", isPrimary: false });
        }
      });
  }

  return candidates;
}