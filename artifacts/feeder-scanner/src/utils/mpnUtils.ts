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

  // Every BOM MPN column (mpn_1..mpn_8) is a valid option for this feeder. The
  // BOM editor lets users add up to 8 MPNs, so the client must offer all of them
  // — capping at mpn_3 silently dropped alternates the server still verifies.
  for (let n = 1; n <= 8; n += 1) {
    const mpn = normalizeMpn(bomItem[`mpn${n}`] ?? bomItem[`mpn_${n}`]);
    const make = String(bomItem[`make${n}`] ?? bomItem[`make_${n}`] ?? "");
    if (mpn) {
      candidates.push({
        value: mpn,
        label: `MPN ${n}`,
        make,
        isPrimary: n === 1,
      });
    }
  }

  const ipn = normalizeMpn(bomItem.internalPartNumber ?? bomItem.internal_part_number);

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