// AUTO_LEGACY's serial engine auto-locks the next un-verified feeder from the order of
// the BOM array it is handed (see the grouping effect in ActiveSession.tsx). That order
// used to come purely from the network, so a change in the server's ordering silently
// resequenced a changeover — which is exactly how feeders ended up locked in the wrong
// order and no scan could ever match.
//
// This mirrors the server's GET /bom/:bomId ORDER BY (api-server/src/routes/bom.ts):
// numeric sr_no first, then a numeric-aware sort of feeder_number so blank-sr_no BOMs
// still read F2 before F10, then feeder_number, then id. Keep the two in lockstep.
type BomOrderRow = {
  srNo?: string | number | null;
  feederNumber?: string | null;
  id?: number | null;
};

const ALL_DIGITS = /^[0-9]+$/;

// "YSMF020" -> 20, "F18" -> 18, "F18" (duplicate row) -> 18, "ABC" -> MAX (sinks last).
function naturalFeederKey(feederNumber: string | null | undefined): number {
  const digits = String(feederNumber ?? "").replace(/[^0-9]/g, "");
  return digits ? Number(digits) : Number.MAX_SAFE_INTEGER;
}

export function compareBomOrder(a: BomOrderRow, b: BomOrderRow): number {
  const aSr = String(a?.srNo ?? "").trim();
  const bSr = String(b?.srNo ?? "").trim();
  const aSequenced = ALL_DIGITS.test(aSr);
  const bSequenced = ALL_DIGITS.test(bSr);

  // A numerically sequenced row always outranks an unsequenced one (matches the SQL
  // CASE ... THEN 0 ELSE 1 END).
  if (aSequenced !== bSequenced) {
    return aSequenced ? -1 : 1;
  }
  if (aSequenced && bSequenced) {
    const bySrNo = Number(aSr) - Number(bSr);
    if (bySrNo !== 0) {
      return bySrNo;
    }
  }

  const aNatural = naturalFeederKey(a?.feederNumber);
  const bNatural = naturalFeederKey(b?.feederNumber);
  if (aNatural !== bNatural) {
    return aNatural - bNatural;
  }

  const aFeeder = String(a?.feederNumber ?? "");
  const bFeeder = String(b?.feederNumber ?? "");
  if (aFeeder !== bFeeder) {
    return aFeeder < bFeeder ? -1 : 1;
  }

  return Number(a?.id ?? 0) - Number(b?.id ?? 0);
}

const normalizeFeeder = (value: string | null | undefined) => String(value ?? "").trim().toUpperCase();

// Which feeder AUTO_LEGACY should auto-lock next: the first un-verified feeder that
// ACTUALLY EXISTS in the loaded BOM.
//
// The "exists" check is the whole point. `remainingFeeders` is backed by the verification
// store's bomEntries, which starts as the bundled sample BOM and is only replaced once the
// real BOM response lands — and the auto-lock effect runs before that replacement. On first
// paint remainingFeeders therefore names sample feeders ("F01") that the session's BOM does
// not contain. Locking one stranded the changeover permanently: pendingFeeder being set made
// the effect bail out forever, and no scanned MPN could ever match a feeder absent from the
// BOM, so the operator saw "Feeder F01 selected" and nothing worked.
export function pickNextLegacyFeeder(
  remainingFeeders: readonly string[],
  bomItems: ReadonlyArray<{ feederNumber?: string | null }> | undefined,
): string | undefined {
  const known = new Set((bomItems ?? []).map((item) => normalizeFeeder(item.feederNumber)));
  return remainingFeeders.find((feeder) => known.has(normalizeFeeder(feeder)));
}
