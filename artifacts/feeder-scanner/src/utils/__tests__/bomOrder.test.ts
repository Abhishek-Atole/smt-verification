import { describe, expect, test } from "vitest";
import { compareBomOrder, pickNextLegacyFeeder } from "../bomOrder";

// These mirror the server's GET /bom/:bomId ORDER BY (api-server/src/routes/bom.ts).
// AUTO_LEGACY locks feeders in this order, so a regression here silently resequences a
// changeover — which is how the original bug shipped.
const row = (feederNumber: string, srNo: string | null = null, id = 0) => ({
  feederNumber,
  srNo,
  id,
});

const order = (rows: ReturnType<typeof row>[]) =>
  [...rows].sort(compareBomOrder).map((r) => r.feederNumber);

describe("compareBomOrder — AUTO_LEGACY serial order", () => {
  test("orders by sr_no numerically, so '00' leads even though it was inserted last", () => {
    const rows = [
      row("YSMF021", "1", 7),
      row("YSMF020", "00", 19), // true first feeder, 13th by row id
      row("YSMF030", "10", 16),
      row("YSMF022", "2", 8),
    ];
    expect(order(rows)).toEqual(["YSMF020", "YSMF021", "YSMF022", "YSMF030"]);
    expect(order(rows)[2]).toBe("YSMF022"); // 2 before 10 — not a text sort
  });

  test("blank sr_no falls back to a numeric-aware feeder sort (F2 before F10)", () => {
    expect(order([row("F10"), row("F2"), row("F8")])).toEqual(["F2", "F8", "F10"]);
  });

  test("a numerically sequenced row outranks an unsequenced one", () => {
    expect(order([row("F50"), row("F01", "1")])).toEqual(["F01", "F50"]);
  });

  test("identical feeder numbers tie-break by id, keeping duplicate rows in place", () => {
    const rows = [row("F18", null, 54), row("F18", null, 53)];
    expect([...rows].sort(compareBomOrder).map((r) => r.id)).toEqual([53, 54]);
  });

  test("feeder numbers with no digits sink to the end", () => {
    expect(order([row("XYZ"), row("F3")])).toEqual(["F3", "XYZ"]);
  });

  test("does not mutate the array it is given", () => {
    const rows = [row("F2"), row("F1")];
    [...rows].sort(compareBomOrder);
    expect(rows.map((r) => r.feederNumber)).toEqual(["F2", "F1"]);
  });
});

describe("pickNextLegacyFeeder — never auto-lock a feeder the BOM lacks", () => {
  const bom = [{ feederNumber: "FR-22" }, { feederNumber: "FR-23" }];

  test("skips the bundled sample feeder and locks the real first one", () => {
    // The store's bomEntries starts as the sample BOM, so on first paint these are the
    // candidates. "F01" is not in this BOM: locking it stranded the changeover.
    expect(pickNextLegacyFeeder(["F01", "FR-22", "FR-23"], bom)).toBe("FR-22");
  });

  test("returns undefined while the real BOM has not loaded (no phantom lock)", () => {
    expect(pickNextLegacyFeeder(["F01", "F02"], undefined)).toBeUndefined();
    expect(pickNextLegacyFeeder(["F01", "F02"], [])).toBeUndefined();
  });

  test("advances to the next real feeder in order", () => {
    expect(pickNextLegacyFeeder(["FR-23"], bom)).toBe("FR-23");
  });

  test("matches feeder numbers case- and whitespace-insensitively", () => {
    expect(pickNextLegacyFeeder([" fr-22 "], bom)).toBe(" fr-22 ");
  });

  test("returns undefined when every remaining feeder is unknown", () => {
    expect(pickNextLegacyFeeder(["F01"], bom)).toBeUndefined();
  });
});
