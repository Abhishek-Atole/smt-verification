import { db } from "@workspace/db";
import { scanRecordsTable, sessionsTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Scan validation statuses from ScanValidationPipeline
 * - pass: Primary MPN matched
 * - alternate_pass: MPN2 or MPN3 matched (alternate component acceptable)
 * - manual_pass: Manual override approved
 * - failed: No match found
 * - feeder_not_found: Feeder not in BOM
 * - unvalidated: FREE_SCAN mode (excluded from FPY)
 */
export type ScanStatus = "pass" | "alternate_pass" | "manual_pass" | "failed" | "feeder_not_found" | "unvalidated";

/**
 * Core metrics data types
 */
export interface KPIData {
  totalScans: number;
  validScans: number; // Excludes unvalidated
  passingScans: number; // pass + alternate_pass + manual_pass
  failingScans: number; // failed + feeder_not_found
  mismatchCount: number; // component mismatch scans
  alternatePassCount: number; // alternate component passes
  fpy: number; // First Pass Yield (0-100)
  passRate: number; // Percentage
  defectRate: number; // Percentage
  avgCycleTime: number; // Seconds
}

export interface OEEData {
  availability: number; // 0-1
  efficiency: number; // 0-1
  quality: number; // 0-1
  oee: number; // 0-1
}

export interface FeederMetrics {
  feederNumber: string;
  scanCount: number;
  passCount: number;
  defectCount: number;
  passRate: number;
  defectRate: number;
  partNumbers: Set<string>;
}

export interface ComponentMetrics {
  partNumber: string;
  description: string | null;
  scanCount: number;
  passCount: number;
  defectCount: number;
  passRate: number;
  defectRate: number;
}

export interface HourlyMetrics {
  hour: number;
  scanCount: number;
  passCount: number;
  defectCount: number;
  passRate: number;
  defectRate: number;
}

/**
 * AnalyticsService - Centralized metrics calculation engine
 *
 * **FPY Formula (CORRECTED)**:
 * FPY = (pass + alternate_pass + manual_pass) / (total - unvalidated) × 100
 *
 * Rationale:
 * - unvalidated (FREE_SCAN) scans are not verification attempts, exclude from denominator
 * - alternate_pass is a valid component match, counts as pass
 * - manual_pass is operator-approved, counts as pass
 * - failed includes both component mismatch and feeder not found
 *
 * **OEE Formula**:
 * OEE = Availability × Efficiency × Quality
 * - Availability: (Scheduled Time - Downtime) / Scheduled Time (for now: 100% if session completed)
 * - Efficiency: Actual Throughput / Expected Throughput (scans per minute vs benchmark)
 * - Quality: (Total - Defects) / Total (pass + alternate_pass + manual_pass count as good)
 */
export class AnalyticsService {
  /**
   * Calculate First Pass Yield (FPY)
   *
   * FPY = (pass + alternate_pass + manual_pass) / (total - unvalidated) × 100
   */
  static calculateFPY(scans: Array<{ validationResult: string | null }>): number {
    if (scans.length === 0) return 0;

    // Count different scan statuses
    const passing = scans.filter(
      (s) => s.validationResult === "pass" || s.validationResult === "alternate_pass" || s.validationResult === "manual_pass"
    ).length;

    // Exclude unvalidated scans from denominator
    const validScans = scans.filter((s) => s.validationResult !== "unvalidated").length;

    if (validScans === 0) return 0;
    return Math.round((passing / validScans) * 100 * 10) / 10;
  }

  /**
   * Calculate Overall Equipment Effectiveness (OEE)
   *
   * OEE = Availability × Efficiency × Quality
   */
  static calculateOEE(
    durationMinutes: number,
    scans: Array<{ validationResult: string | null }>,
    expectedScansPerMinute: number = 5
  ): OEEData {
    if (scans.length === 0 || durationMinutes === 0) {
      return {
        availability: 0,
        efficiency: 0,
        quality: 0,
        oee: 0,
      };
    }

    // Availability: 100% if session completed (no downtime tracking yet)
    const availability = 1.0;

    // Efficiency: Actual scans/min vs expected scans/min
    const actualThroughput = scans.length / durationMinutes;
    const efficiency = Math.min(1.0, actualThroughput / expectedScansPerMinute);

    // Quality: (pass + alternate_pass + manual_pass) / total
    const goodScans = scans.filter(
      (s) => s.validationResult === "pass" || s.validationResult === "alternate_pass" || s.validationResult === "manual_pass"
    ).length;
    const quality = goodScans / scans.length;

    // OEE = Availability × Efficiency × Quality
    const oee = availability * efficiency * quality;

    return {
      availability: Math.round(availability * 100 * 10) / 10 / 100,
      efficiency: Math.round(efficiency * 100 * 10) / 10 / 100,
      quality: Math.round(quality * 100 * 10) / 10 / 100,
      oee: Math.round(oee * 100 * 10) / 10 / 100,
    };
  }

  /**
   * Calculate cycle time (average time between scans)
   */
  static calculateCycleTime(scans: Array<{ scannedAt: Date | string }>): number {
    if (scans.length < 2) return 0;

    // Sort by time
    const sorted = [...scans].sort((a, b) => {
      const aTime = typeof a.scannedAt === "string" ? new Date(a.scannedAt).getTime() : a.scannedAt.getTime();
      const bTime = typeof b.scannedAt === "string" ? new Date(b.scannedAt).getTime() : b.scannedAt.getTime();
      return aTime - bTime;
    });

    // Calculate time differences
    let totalSeconds = 0;
    for (let i = 1; i < sorted.length; i++) {
      const prev = typeof sorted[i - 1].scannedAt === "string" ? new Date(sorted[i - 1].scannedAt).getTime() : (sorted[i - 1].scannedAt as Date).getTime();
      const curr = typeof sorted[i].scannedAt === "string" ? new Date(sorted[i].scannedAt).getTime() : (sorted[i].scannedAt as Date).getTime();
      totalSeconds += (curr - prev) / 1000;
    }

    return Math.round(totalSeconds / (sorted.length - 1));
  }

  /**
   * Calculate throughput (scans per minute)
   */
  static calculateThroughput(scanCount: number, durationMinutes: number): number {
    if (durationMinutes === 0) return 0;
    return Math.round((scanCount / durationMinutes) * 10) / 10;
  }

  /**
   * Calculate pass rate percentage
   */
  static calculatePassRate(scans: Array<{ validationResult: string | null }>): number {
    if (scans.length === 0) return 0;

    const passing = scans.filter(
      (s) => s.validationResult === "pass" || s.validationResult === "alternate_pass" || s.validationResult === "manual_pass"
    ).length;

    return Math.round((passing / scans.length) * 100 * 10) / 10;
  }

  /**
   * Calculate defect rate percentage
   */
  static calculateDefectRate(scans: Array<{ validationResult: string | null }>): number {
    return 100 - this.calculatePassRate(scans);
  }

  /**
   * Aggregate scans by feeder
   */
  static aggregateByFeeder(
    scans: Array<{
      feederNumber: string;
      partNumber: string | null;
      validationResult: string | null;
    }>
  ): Map<string, FeederMetrics> {
    const feederMap = new Map<string, FeederMetrics>();

    for (const scan of scans) {
      const feederNum = scan.feederNumber;
      if (!feederMap.has(feederNum)) {
        feederMap.set(feederNum, {
          feederNumber: feederNum,
          scanCount: 0,
          passCount: 0,
          defectCount: 0,
          passRate: 0,
          defectRate: 0,
          partNumbers: new Set(),
        });
      }

      const entry = feederMap.get(feederNum)!;
      entry.scanCount++;

      if (
        scan.validationResult === "pass" ||
        scan.validationResult === "alternate_pass" ||
        scan.validationResult === "manual_pass"
      ) {
        entry.passCount++;
      } else if (scan.validationResult !== "unvalidated") {
        entry.defectCount++;
      }

      if (scan.partNumber) {
        entry.partNumbers.add(scan.partNumber);
      }
    }

    // Calculate rates
    feederMap.forEach((entry) => {
      if (entry.scanCount > 0) {
        entry.passRate = Math.round((entry.passCount / entry.scanCount) * 100 * 10) / 10;
        entry.defectRate = Math.round((entry.defectCount / entry.scanCount) * 100 * 10) / 10;
      }
    });

    return feederMap;
  }

  /**
   * Aggregate scans by component/part number
   */
  static aggregateByComponent(
    scans: Array<{
      partNumber: string | null;
      description: string | null;
      validationResult: string | null;
    }>
  ): Map<string, ComponentMetrics> {
    const componentMap = new Map<string, ComponentMetrics>();

    for (const scan of scans) {
      const partNum = scan.partNumber || "unknown";
      if (!componentMap.has(partNum)) {
        componentMap.set(partNum, {
          partNumber: partNum,
          description: scan.description || null,
          scanCount: 0,
          passCount: 0,
          defectCount: 0,
          passRate: 0,
          defectRate: 0,
        });
      }

      const entry = componentMap.get(partNum)!;
      entry.scanCount++;

      if (
        scan.validationResult === "pass" ||
        scan.validationResult === "alternate_pass" ||
        scan.validationResult === "manual_pass"
      ) {
        entry.passCount++;
      } else if (scan.validationResult !== "unvalidated") {
        entry.defectCount++;
      }
    }

    // Calculate rates
    componentMap.forEach((entry) => {
      if (entry.scanCount > 0) {
        entry.passRate = Math.round((entry.passCount / entry.scanCount) * 100 * 10) / 10;
        entry.defectRate = Math.round((entry.defectCount / entry.scanCount) * 100 * 10) / 10;
      }
    });

    return componentMap;
  }

  /**
   * Aggregate scans by hour
   */
  static aggregateByHour(scans: Array<{ scannedAt: Date | string; validationResult: string | null }>): HourlyMetrics[] {
    const hourlyMap = new Map<number, HourlyMetrics>();

    for (const scan of scans) {
      const scanDate = typeof scan.scannedAt === "string" ? new Date(scan.scannedAt) : scan.scannedAt;
      const hour = scanDate.getHours();

      if (!hourlyMap.has(hour)) {
        hourlyMap.set(hour, {
          hour,
          scanCount: 0,
          passCount: 0,
          defectCount: 0,
          passRate: 0,
          defectRate: 0,
        });
      }

      const entry = hourlyMap.get(hour)!;
      entry.scanCount++;

      if (
        scan.validationResult === "pass" ||
        scan.validationResult === "alternate_pass" ||
        scan.validationResult === "manual_pass"
      ) {
        entry.passCount++;
      } else if (scan.validationResult !== "unvalidated") {
        entry.defectCount++;
      }
    }

    // Calculate rates for all 24 hours
    return Array.from({ length: 24 }, (_, i) => {
      const entry = hourlyMap.get(i);
      if (!entry) {
        return {
          hour: i,
          scanCount: 0,
          passCount: 0,
          defectCount: 0,
          passRate: 0,
          defectRate: 0,
        };
      }

      entry.passRate = entry.scanCount > 0 ? Math.round((entry.passCount / entry.scanCount) * 100 * 10) / 10 : 0;
      entry.defectRate = entry.scanCount > 0 ? Math.round((entry.defectCount / entry.scanCount) * 100 * 10) / 10 : 0;
      return entry;
    });
  }

  /**
   * Calculate KPI summary for a session or set of scans
   */
  static calculateKPI(scans: Array<{ validationResult: string | null; scannedAt: Date | string }>): KPIData {
    const validScans = scans.filter((s) => s.validationResult !== "unvalidated");
    const passing = scans.filter(
      (s) => s.validationResult === "pass" || s.validationResult === "alternate_pass" || s.validationResult === "manual_pass" || s.validationResult === "ok"
    );
    const failing = validScans.filter(
      (s) => s.validationResult === "failed" || s.validationResult === "feeder_not_found" || s.validationResult === "ng"
    );
    const mismatches = validScans.filter(
      (s) => s.validationResult === "mismatch"
    );
    const alternatePasses = scans.filter(
      (s) => s.validationResult === "alternate_pass"
    );

    const passRate = validScans.length > 0 ? Math.round((passing.length / validScans.length) * 100 * 10) / 10 : 0;
    const fpy = passRate;
    const avgCycleTime = this.calculateCycleTime(scans);

    return {
      totalScans: scans.length,
      validScans: validScans.length,
      passingScans: passing.length,
      failingScans: failing.length,
      mismatchCount: mismatches.length,
      alternatePassCount: alternatePasses.length,
      fpy,
      passRate,
      defectRate: 100 - passRate,
      avgCycleTime,
    };
  }

  /**
   * Get KPI from database for a session
   */
  static async getSessionKPI(sessionId: number): Promise<KPIData> {
    try {
      const scans = await db.select().from(scanRecordsTable).where(eq(scanRecordsTable.sessionId, sessionId));
      return this.calculateKPI(scans);
    } catch (error) {
      logger.error({ err: error, sessionId }, "Failed to get session KPI");
      return {
        totalScans: 0,
        validScans: 0,
        passingScans: 0,
        failingScans: 0,
        mismatchCount: 0,
        alternatePassCount: 0,
        fpy: 0,
        passRate: 0,
        defectRate: 0,
        avgCycleTime: 0,
      };
    }
  }

  /**
   * Get OEE from database for a session
   */
  static async getSessionOEE(sessionId: number): Promise<OEEData> {
    try {
      const session = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
      if (session.length === 0) {
        return { availability: 0, efficiency: 0, quality: 0, oee: 0 };
      }

      const sessionData = session[0];
      const startTime = new Date(sessionData.startTime);
      const endTime = sessionData.endTime ? new Date(sessionData.endTime) : new Date();
      const durationMs = endTime.getTime() - startTime.getTime();
      const durationMinutes = durationMs / 60000;

      const scans = await db.select().from(scanRecordsTable).where(eq(scanRecordsTable.sessionId, sessionId));

      return this.calculateOEE(durationMinutes, scans);
    } catch (error) {
      logger.error({ err: error, sessionId }, "Failed to get session OEE");
      return { availability: 0, efficiency: 0, quality: 0, oee: 0 };
    }
  }
}
