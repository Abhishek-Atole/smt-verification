import { describe, expect, test } from "vitest";
import { vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

import { verifyMPN } from "../verificationService";

const bomRow = {
  feederNumber: "YSM-001",
  internalPartNumber: "RDSCAP0353 RDSCAP0312",
  make1: "KEMET",
  mpn1: "C0603C472K5RACAUTO",
  make2: "YAGEO",
  mpn2: "CC0603KRX7R9BB472",
  make3: null,
  mpn3: null,
};

describe("verifyMPN - exact token matching", () => {
  test("matches mpn1 exactly", () => {
    const result = verifyMPN("C0603C472K5RACAUTO", bomRow);
    expect(result.valid).toBe(true);
    expect(result.matchedField).toBe("mpn1");
    expect(result.errorCode).toBeNull();
  });

  test("matches mpn2 exactly", () => {
    const result = verifyMPN("CC0603KRX7R9BB472", bomRow);
    expect(result.valid).toBe(true);
    expect(result.matchedField).toBe("mpn2");
    expect(result.errorCode).toBeNull();
  });

  test("matches internalPartNumber first token", () => {
    const result = verifyMPN("RDSCAP0353", bomRow);
    expect(result.valid).toBe(true);
    expect(result.matchedField).toBe("internalPartNumber");
    expect(result.matchedMake).toBeNull();
  });

  test("matches internalPartNumber second token", () => {
    const result = verifyMPN("RDSCAP0312", bomRow);
    expect(result.valid).toBe(true);
    expect(result.matchedField).toBe("internalPartNumber");
    expect(result.matchedMake).toBeNull();
  });

  test("matches case-insensitively (lowercase scan)", () => {
    const result = verifyMPN("c0603c472k5racauto", bomRow);
    expect(result.valid).toBe(true);
    expect(result.matchedField).toBe("mpn1");
  });

  test("matches with leading/trailing whitespace in scan", () => {
    const result = verifyMPN("  CC0603KRX7R9BB472  ", bomRow);
    expect(result.valid).toBe(true);
    expect(result.matchedField).toBe("mpn2");
  });

  test("returns matchedMake for mpn1 match", () => {
    const result = verifyMPN("C0603C472K5RACAUTO", bomRow);
    expect(result.matchedMake).toBe("KEMET");
  });

  test("returns matchedMake for mpn2 match", () => {
    const result = verifyMPN("CC0603KRX7R9BB472", bomRow);
    expect(result.matchedMake).toBe("YAGEO");
  });

  test("returns null matchedMake for internalPartNumber match", () => {
    const result = verifyMPN("RDSCAP0312", bomRow);
    expect(result.matchedMake).toBeNull();
  });

  test("hasAlternates true when mpn2 exists", () => {
    const result = verifyMPN("CC0603KRX7R9BB472", bomRow);
    expect(result.hasAlternates).toBe(true);
  });

  test("hasAlternates false when only mpn1 exists", () => {
    const result = verifyMPN("ABC123", {
      ...bomRow,
      mpn2: null,
      make2: null,
    });
    expect(result.hasAlternates).toBe(false);
  });

  test("rejects mpn from wrong feeder", () => {
    const result = verifyMPN("WRONG-MPN", bomRow);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("COMPONENT_MISMATCH");
  });

  test("rejects make name (KEMET, YAGEO) as scan value", () => {
    expect(verifyMPN("KEMET", bomRow).valid).toBe(false);
    expect(verifyMPN("YAGEO", bomRow).valid).toBe(false);
  });

  test("rejects partial MPN match", () => {
    expect(verifyMPN("C0603C472", bomRow).valid).toBe(false);
  });

  test("rejects empty string scan", () => {
    const result = verifyMPN("", bomRow);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("COMPONENT_MISMATCH");
  });

  test("rejects fuzzy near-match (C0603C472K5RACAUT)", () => {
    const result = verifyMPN("C0603C472K5RACAUT", bomRow);
    expect(result.valid).toBe(false);
  });

  test("returns COMPONENT_MISMATCH for no match", () => {
    const result = verifyMPN("NOPE", bomRow);
    expect(result.errorCode).toBe("COMPONENT_MISMATCH");
  });

  test("handles null mpn2 and mpn3 gracefully", () => {
    const result = verifyMPN("RDSCAP0353", {
      ...bomRow,
      mpn2: null,
      mpn3: null,
      make2: null,
      make3: null,
    });
    expect(result.valid).toBe(true);
  });

  test("handles internalPartNumber with extra spaces", () => {
    const result = verifyMPN("RDSCAP0353", {
      ...bomRow,
      internalPartNumber: "  RDSCAP0353   RDSCAP0312  ",
    });
    expect(result.valid).toBe(true);
  });

  test("handles internalPartNumber with newline separator", () => {
    const result = verifyMPN("RDSCAP0312", {
      ...bomRow,
      internalPartNumber: "RDSCAP0353\nRDSCAP0312",
    });
    expect(result.valid).toBe(true);
  });
});