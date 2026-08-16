import { db } from "@workspace/db";
import {
  changeoverSessionsTable,
  bomItemsTable,
  feederScansTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Scan validation status enumeration
 * - pass: Primary MPN (mpn1) or internal ID matched
 * - alternate_pass: MPN2 or MPN3 matched
 * - manual_pass: Supervisor override approved
 * - failed: No match found
 * - feeder_not_found: Feeder not in BOM
 * - unvalidated: FREE_SCAN mode (no validation)
 */
export type ScanValidationStatus =
  | "pass"
  | "alternate_pass"
  | "manual_pass"
  | "failed"
  | "feeder_not_found"
  | "unvalidated";

export interface ScanValidationResult {
  status: ScanValidationStatus;
  feederNumber: string;
  scannedValue: string;
  matchedItemId: number | null;
  matchedField: string | null; // 'internalPartNumber' | 'mpn1' | 'mpn2' | 'mpn3'
  matchedMake: string | null;
  alternateUsed: boolean;
  expectedValues: { mpn: string; make: string }[];
  message: string;
  requiresOverride?: boolean; // For MANUAL mode failures
}

interface BomItem {
  id: number;
  feederNumber: string;
  internalPartNumber: string | null;
  mpn1: string | null;
  mpn2: string | null;
  mpn3: string | null;
  mpn4: string | null;
  mpn5: string | null;
  mpn6: string | null;
  mpn7: string | null;
  mpn8: string | null;
  make1: string | null;
  make2: string | null;
  make3: string | null;
  make4: string | null;
  make5: string | null;
  make6: string | null;
  make7: string | null;
  make8: string | null;
}

interface Session {
  id: string;
  bomId: number | null;
  verificationMode: "AUTO" | "MANUAL" | "FREE_SCAN";
  operatorId: string;
}

/**
 * ScanValidationPipeline: 7-Stage Feeder Validation Engine
 *
 * The pipeline validates a scanned component value against BOM specifications
 * using an exact 7-stage decision tree.
 *
 * Decision Tree:
 * ├─ Stage 1: Fetch & validate session (must be active, not free-scan bypass yet)
 * ├─ Stage 2: Normalize scanned value (trim, uppercase)
 * ├─ Stage 3: Find feeder in BOM → feeder_not_found if missing
 * ├─ Stage 4: Match against internal part number (tokenized) → pass if match
 * ├─ Stage 5: Match against MPN1 (exact normalized) → pass if match
 * ├─ Stage 6: Match against MPN2 (exact normalized) → alternate_pass if match
 * ├─ Stage 7: Match against MPN3 (exact normalized) → alternate_pass if match
 * └─ Stage 8: No match → failed with expected values
 *
 * Special Cases:
 * - FREE_SCAN mode: Bypass all validation → status='unvalidated'
 * - MANUAL mode failure: Return requiresOverride=true → prompt for supervisor approval
 */
export class ScanValidationPipeline {
  /**
   * Normalize value for exact matching (trim, uppercase)
   * Skip empty/null values
   */
  private static normalizeExact(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = String(value).trim().toUpperCase();
    if (
      trimmed === "" ||
      trimmed === "N/A" ||
      trimmed === "NA" ||
      trimmed === "NULL" ||
      trimmed === "NONE" ||
      trimmed === "-"
    ) {
      return null;
    }
    return trimmed;
  }

  /**
   * Tokenize value for flexible matching (split on whitespace, uppercase each token)
   * Returns array of non-empty tokens
   */
  private static tokenize(value: string | null | undefined): string[] {
    if (!value) return [];
    return String(value)
      .trim()
      .toUpperCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  /**
   * Stage 1: Fetch and validate session
   */
  private static async fetchAndValidateSession(
    sessionId: string
  ): Promise<Session | null> {
    const [fetchedSession] = await db
      .select({
        id: changeoverSessionsTable.id,
        bomId: changeoverSessionsTable.bomId,
        verificationMode: changeoverSessionsTable.verificationMode,
        operatorId: changeoverSessionsTable.operatorId,
      })
      .from(changeoverSessionsTable)
      .where(
        and(
          eq(changeoverSessionsTable.id, sessionId),
          eq(changeoverSessionsTable.status, "active")
        )
      );

    if (!fetchedSession) {
      return null;
    }

    return {
      ...fetchedSession,
      verificationMode: fetchedSession.verificationMode as "AUTO" | "MANUAL" | "FREE_SCAN",
    };
  }

  /**
   * Stage 3: Find feeder in BOM
   */
  private static async findBomItem(
    bomId: number,
    feederNumber: string
  ): Promise<BomItem | null> {
    const [item] = await db
      .select({
        id: bomItemsTable.id,
        feederNumber: bomItemsTable.feederNumber,
        internalPartNumber: bomItemsTable.internalPartNumber,
        mpn1: bomItemsTable.mpn1,
        mpn2: bomItemsTable.mpn2,
        mpn3: bomItemsTable.mpn3,
        mpn4: bomItemsTable.mpn4,
        mpn5: bomItemsTable.mpn5,
        mpn6: bomItemsTable.mpn6,
        mpn7: bomItemsTable.mpn7,
        mpn8: bomItemsTable.mpn8,
        make1: bomItemsTable.make1,
        make2: bomItemsTable.make2,
        make3: bomItemsTable.make3,
        make4: bomItemsTable.make4,
        make5: bomItemsTable.make5,
        make6: bomItemsTable.make6,
        make7: bomItemsTable.make7,
        make8: bomItemsTable.make8,
      })
      .from(bomItemsTable)
      .where(
        and(
          eq(bomItemsTable.bomId, bomId),
          eq(bomItemsTable.feederNumber, feederNumber)
        )
      );

    return item || null;
  }

  /**
   * Stage 4: Match against internal part number (tokenized)
   * Checks if any token in scanned value matches a token in internal part number
   */
  private static matchInternalPartNumber(
    bomItem: BomItem,
    normalizedScanned: string
  ): boolean {
    if (!bomItem.internalPartNumber) return false;
    const tokens = this.tokenize(bomItem.internalPartNumber);
    return tokens.includes(normalizedScanned);
  }

  /**
   * Stage 5: Match against MPN1 (exact normalized)
   */
  private static matchMpn1(
    bomItem: BomItem,
    normalizedScanned: string
  ): boolean {
    if (!bomItem.mpn1) return false;
    const normalized = this.normalizeExact(bomItem.mpn1);
    return normalized === normalizedScanned;
  }

  /**
   * Stage 6: Match against MPN2 (exact normalized)
   */
  private static matchMpn2(
    bomItem: BomItem,
    normalizedScanned: string
  ): boolean {
    if (!bomItem.mpn2) return false;
    const normalized = this.normalizeExact(bomItem.mpn2);
    return normalized === normalizedScanned;
  }

  /**
   * Stage 7: Match against MPN3 (exact normalized)
   */
  private static matchMpn3(
    bomItem: BomItem,
    normalizedScanned: string
  ): boolean {
    if (!bomItem.mpn3) return false;
    const normalized = this.normalizeExact(bomItem.mpn3);
    return normalized === normalizedScanned;
  }

  /**
   * Match against MPN4 (exact normalized)
   */
  private static matchMpn4(
    bomItem: BomItem,
    normalizedScanned: string
  ): boolean {
    if (!bomItem.mpn4) return false;
    const normalized = this.normalizeExact(bomItem.mpn4);
    return normalized === normalizedScanned;
  }

  /**
   * Match against MPN5 (exact normalized)
   */
  private static matchMpn5(
    bomItem: BomItem,
    normalizedScanned: string
  ): boolean {
    if (!bomItem.mpn5) return false;
    const normalized = this.normalizeExact(bomItem.mpn5);
    return normalized === normalizedScanned;
  }

  /**
   * Match against MPN6 (exact normalized)
   */
  private static matchMpn6(
    bomItem: BomItem,
    normalizedScanned: string
  ): boolean {
    if (!bomItem.mpn6) return false;
    const normalized = this.normalizeExact(bomItem.mpn6);
    return normalized === normalizedScanned;
  }

  /**
   * Match against MPN7 (exact normalized)
   */
  private static matchMpn7(
    bomItem: BomItem,
    normalizedScanned: string
  ): boolean {
    if (!bomItem.mpn7) return false;
    const normalized = this.normalizeExact(bomItem.mpn7);
    return normalized === normalizedScanned;
  }

  /**
   * Match against MPN8 (exact normalized)
   */
  private static matchMpn8(
    bomItem: BomItem,
    normalizedScanned: string
  ): boolean {
    if (!bomItem.mpn8) return false;
    const normalized = this.normalizeExact(bomItem.mpn8);
    return normalized === normalizedScanned;
  }

  /**
   * Build expected values list for failed scans
   */
  private static buildExpectedValues(bomItem: BomItem): {
    mpn: string;
    make: string;
  }[] {
    const values: { mpn: string; make: string }[] = [];

    if (bomItem.mpn1 && bomItem.make1) {
      values.push({ mpn: bomItem.mpn1, make: bomItem.make1 });
    }
    if (bomItem.mpn2 && bomItem.make2) {
      values.push({ mpn: bomItem.mpn2, make: bomItem.make2 });
    }
    if (bomItem.mpn3 && bomItem.make3) {
      values.push({ mpn: bomItem.mpn3, make: bomItem.make3 });
    }
    if (bomItem.mpn4 && bomItem.make4) {
      values.push({ mpn: bomItem.mpn4, make: bomItem.make4 });
    }
    if (bomItem.mpn5 && bomItem.make5) {
      values.push({ mpn: bomItem.mpn5, make: bomItem.make5 });
    }
    if (bomItem.mpn6 && bomItem.make6) {
      values.push({ mpn: bomItem.mpn6, make: bomItem.make6 });
    }
    if (bomItem.mpn7 && bomItem.make7) {
      values.push({ mpn: bomItem.mpn7, make: bomItem.make7 });
    }
    if (bomItem.mpn8 && bomItem.make8) {
      values.push({ mpn: bomItem.mpn8, make: bomItem.make8 });
    }

    return values;
  }

  /**
   * Execute the full 7-stage validation pipeline
   *
   * @param sessionId Session identifier (format: SMT_YYYYMMDD_NNNNNN)
   * @param feederNumber Feeder position identifier
   * @param scannedValue Raw scanned component value
   * @param verificationMode Optional override for verification mode
   * @returns Comprehensive validation result with decision tree info
   */
  static async validate(
    sessionId: string,
    feederNumber: string,
    scannedValue: string,
    verificationMode?: "AUTO" | "MANUAL" | "FREE_SCAN"
  ): Promise<ScanValidationResult> {
    try {
      // Stage 1: Fetch and validate session
      const session = await this.fetchAndValidateSession(sessionId);

      if (!session) {
        return {
          status: "failed",
          feederNumber,
          scannedValue,
          matchedItemId: null,
          matchedField: null,
          matchedMake: null,
          alternateUsed: false,
          expectedValues: [],
          message: `Session ${sessionId} not found or not active`,
        };
      }

      // Check for FREE_SCAN mode: bypass all validation
      const mode = verificationMode || session.verificationMode;
      if (mode === "FREE_SCAN") {
        return {
          status: "unvalidated",
          feederNumber,
          scannedValue,
          matchedItemId: null,
          matchedField: null,
          matchedMake: null,
          alternateUsed: false,
          expectedValues: [],
          message: `Component scanned in FREE_SCAN mode (no validation): ${scannedValue}`,
        };
      }

      // Stage 2: Normalize scanned value
      const normalizedScanned = this.normalizeExact(scannedValue);
      if (!normalizedScanned) {
        return {
          status: "failed",
          feederNumber,
          scannedValue,
          matchedItemId: null,
          matchedField: null,
          matchedMake: null,
          alternateUsed: false,
          expectedValues: [],
          message: `Invalid scanned value: "${scannedValue}" (empty or skipped)`,
        };
      }

      // If BOM is null, treat as FREE_SCAN mode
      if (session.bomId === null) {
        return {
          status: "unvalidated",
          feederNumber,
          scannedValue,
          matchedItemId: null,
          matchedField: null,
          matchedMake: null,
          alternateUsed: false,
          expectedValues: [],
          message: `No BOM assigned to session; operating in scan-only mode`,
        };
      }

      // Stage 3: Find feeder in BOM
      const bomItem = await this.findBomItem(session.bomId, feederNumber);

      if (!bomItem) {
        return {
          status: "feeder_not_found",
          feederNumber,
          scannedValue,
          matchedItemId: null,
          matchedField: null,
          matchedMake: null,
          alternateUsed: false,
          expectedValues: [],
          message: `Feeder ${feederNumber} not found in BOM`,
        };
      }

      // Stage 4: Match against internal part number (tokenized)
      if (this.matchInternalPartNumber(bomItem, normalizedScanned)) {
        return {
          status: "pass",
          feederNumber,
          scannedValue,
          matchedItemId: bomItem.id,
          matchedField: "internalPartNumber",
          matchedMake: null,
          alternateUsed: false,
          expectedValues: this.buildExpectedValues(bomItem),
          message: `✓ Component matched internal part number`,
        };
      }

      // Stage 5: Match against MPN1 (exact normalized)
      if (this.matchMpn1(bomItem, normalizedScanned)) {
        return {
          status: "pass",
          feederNumber,
          scannedValue,
          matchedItemId: bomItem.id,
          matchedField: "mpn1",
          matchedMake: bomItem.make1 || null,
          alternateUsed: false,
          expectedValues: this.buildExpectedValues(bomItem),
          message: `✓ Component matched primary MPN (${bomItem.mpn1})`,
        };
      }

      // Stage 6: Match against MPN2 (exact normalized)
      if (this.matchMpn2(bomItem, normalizedScanned)) {
        return {
          status: "alternate_pass",
          feederNumber,
          scannedValue,
          matchedItemId: bomItem.id,
          matchedField: "mpn2",
          matchedMake: bomItem.make2 || null,
          alternateUsed: true,
          expectedValues: this.buildExpectedValues(bomItem),
          message: `✓ Component matched alternate MPN-2 (${bomItem.mpn2})`,
        };
      }

      // Stage 7: Match against MPN3 (exact normalized)
      if (this.matchMpn3(bomItem, normalizedScanned)) {
        return {
          status: "alternate_pass",
          feederNumber,
          scannedValue,
          matchedItemId: bomItem.id,
          matchedField: "mpn3",
          matchedMake: bomItem.make3 || null,
          alternateUsed: true,
          expectedValues: this.buildExpectedValues(bomItem),
          message: `✓ Component matched alternate MPN-3 (${bomItem.mpn3})`,
        };
      }

      // Match against MPN4 (exact normalized)
      if (this.matchMpn4(bomItem, normalizedScanned)) {
        return {
          status: "alternate_pass",
          feederNumber,
          scannedValue,
          matchedItemId: bomItem.id,
          matchedField: "mpn4",
          matchedMake: bomItem.make4 || null,
          alternateUsed: true,
          expectedValues: this.buildExpectedValues(bomItem),
          message: `✓ Component matched alternate MPN-4 (${bomItem.mpn4})`,
        };
      }

      // Match against MPN5 (exact normalized)
      if (this.matchMpn5(bomItem, normalizedScanned)) {
        return {
          status: "alternate_pass",
          feederNumber,
          scannedValue,
          matchedItemId: bomItem.id,
          matchedField: "mpn5",
          matchedMake: bomItem.make5 || null,
          alternateUsed: true,
          expectedValues: this.buildExpectedValues(bomItem),
          message: `✓ Component matched alternate MPN-5 (${bomItem.mpn5})`,
        };
      }

      // Match against MPN6 (exact normalized)
      if (this.matchMpn6(bomItem, normalizedScanned)) {
        return {
          status: "alternate_pass",
          feederNumber,
          scannedValue,
          matchedItemId: bomItem.id,
          matchedField: "mpn6",
          matchedMake: bomItem.make6 || null,
          alternateUsed: true,
          expectedValues: this.buildExpectedValues(bomItem),
          message: `✓ Component matched alternate MPN-6 (${bomItem.mpn6})`,
        };
      }

      // Match against MPN7 (exact normalized)
      if (this.matchMpn7(bomItem, normalizedScanned)) {
        return {
          status: "alternate_pass",
          feederNumber,
          scannedValue,
          matchedItemId: bomItem.id,
          matchedField: "mpn7",
          matchedMake: bomItem.make7 || null,
          alternateUsed: true,
          expectedValues: this.buildExpectedValues(bomItem),
          message: `✓ Component matched alternate MPN-7 (${bomItem.mpn7})`,
        };
      }

      // Match against MPN8 (exact normalized)
      if (this.matchMpn8(bomItem, normalizedScanned)) {
        return {
          status: "alternate_pass",
          feederNumber,
          scannedValue,
          matchedItemId: bomItem.id,
          matchedField: "mpn8",
          matchedMake: bomItem.make8 || null,
          alternateUsed: true,
          expectedValues: this.buildExpectedValues(bomItem),
          message: `✓ Component matched alternate MPN-8 (${bomItem.mpn8})`,
        };
      }

      // Stage 8: No match → failed
      // In MANUAL mode, set requiresOverride = true to prompt supervisor approval
      return {
        status: "failed",
        feederNumber,
        scannedValue,
        matchedItemId: bomItem.id,
        matchedField: null,
        matchedMake: null,
        alternateUsed: false,
        expectedValues: this.buildExpectedValues(bomItem),
        message: `✗ Component mismatch. Expected: ${
          bomItem.mpn1 || "N/A"
        }; Scanned: ${scannedValue}`,
        requiresOverride: mode === "MANUAL",
      };
    } catch (err) {
      logger.error(err, "ScanValidationPipeline error");
      return {
        status: "failed",
        feederNumber,
        scannedValue,
        matchedItemId: null,
        matchedField: null,
        matchedMake: null,
        alternateUsed: false,
        expectedValues: [],
        message: `Validation engine error: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      };
    }
  }
}

export default ScanValidationPipeline;
