import { describe, expect, test } from "vitest";
import { buildCandidates } from "@/utils/mpnUtils";

describe("buildCandidates — BOM MPNs offered for verification", () => {
  test("includes ALL MPN1..MPN8 columns, not just the first three", () => {
    const bomItem = {
      mpn1: "AAA1", mpn2: "BBB2", mpn3: "CCC3",
      mpn4: "DDD4", mpn5: "EEE5", mpn6: "FFF6",
      mpn7: "GGG7", mpn8: "HHH8",
      make1: "M1", make5: "M5",
    };
    const candidates = buildCandidates(bomItem);
    const values = candidates.map((c) => c.value);
    expect(values).toEqual(["AAA1", "BBB2", "CCC3", "DDD4", "EEE5", "FFF6", "GGG7", "HHH8"]);
    // Primary is MPN 1 only; everything else is an alternate (same classification).
    expect(candidates[0].isPrimary).toBe(true);
    expect(candidates[1].isPrimary).toBe(false);
    expect(candidates[4].label).toBe("MPN 5");
    expect(candidates[4].make).toBe("M5");
  });

  test("supports snake_case mpn_N keys and skips blanks", () => {
    const candidates = buildCandidates({
      mpn_1: "AAA1",
      mpn_3: "CCC3",
      mpn_8: "HHH8",
      mpn2: "",
      make_8: "Maker8",
    });
    expect(candidates.map((c) => c.value)).toEqual(["AAA1", "CCC3", "HHH8"]);
    expect(candidates[2].make).toBe("Maker8");
  });

  test("still appends the full internal part number + its tokens last", () => {
    const candidates = buildCandidates({ mpn1: "AAA1", internalPartNumber: "IPN-X IPN-Y" });
    const values = candidates.map((c) => c.value);
    // The full normalized value is offered first, then the individual tokens.
    expect(values).toEqual(["AAA1", "IPN-X IPN-Y", "IPN-X", "IPN-Y"]);
  });
});
