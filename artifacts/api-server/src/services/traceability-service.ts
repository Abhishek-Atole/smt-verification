import { db } from "@workspace/db";
import {
  componentHistoryTable,
  scanRecordsTable,
  sessionsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export class TraceabilityService {
  /**
   * Find all scans using a specific reel
   */
  static async findScansForReel(reelId: string) {
    const result = await db
      .select()
      .from(scanRecordsTable)
      .where(eq(scanRecordsTable.reelId, reelId));

    return result;
  }

  /**
   * Find all scans for a given lot number
   */
  static async findScansForLot(lotNumber: string) {
    const result = await db
      .select()
      .from(scanRecordsTable)
      .where(eq(scanRecordsTable.lotNumber, lotNumber));

    return result;
  }

  /**
   * Find all scans for a given date code
   */
  static async findScansForDateCode(dateCode: string) {
    const result = await db
      .select()
      .from(scanRecordsTable)
      .where(eq(scanRecordsTable.dateCode, dateCode));

    return result;
  }

  /**
   * Get full traceability chain for a session
   * Returns: PCB → Reel → Lot → Feeder mapping
   */
  static async getSessionTraceability(sessionId: number) {
    const scans = await db
      .select({
        scanId: scanRecordsTable.id,
        feederId: scanRecordsTable.feederId,
        feederNumber: scanRecordsTable.feederNumber,
        reelId: scanRecordsTable.reelId,
        scannedMpn: scanRecordsTable.scannedMpn,
        lotNumber: scanRecordsTable.lotNumber,
        dateCode: scanRecordsTable.dateCode,
        status: scanRecordsTable.status,
        validationResult: scanRecordsTable.validationResult,
        alternateUsed: scanRecordsTable.alternateUsed,
        scannedAt: scanRecordsTable.scannedAt,
      })
      .from(scanRecordsTable)
      .where(eq(scanRecordsTable.sessionId, sessionId));

    // Group by feeder, get latest scan per feeder
    const latestScans = new Map();
    scans.forEach((scan) => {
      const key = scan.feederId;
      if (!latestScans.has(key) || scan.scannedAt > latestScans.get(key).scannedAt) {
        latestScans.set(key, scan);
      }
    });

    return Array.from(latestScans.values());
  }

  /**
   * Find all sessions using a specific reel
   */
  static async findSessionsForReel(reelId: string) {
    const result = await db
      .select({
        sessionId: scanRecordsTable.sessionId,
        session: sessionsTable,
        scan: scanRecordsTable,
      })
      .from(scanRecordsTable)
      .innerJoin(
        sessionsTable,
        eq(scanRecordsTable.sessionId, sessionsTable.id)
      )
      .where(eq(scanRecordsTable.reelId, reelId));

    return result;
  }

  /**
   * Find all sessions using a specific lot
   */
  static async findSessionsForLot(lotNumber: string) {
    const result = await db
      .select({
        sessionId: scanRecordsTable.sessionId,
        session: sessionsTable,
        scan: scanRecordsTable,
      })
      .from(scanRecordsTable)
      .innerJoin(
        sessionsTable,
        eq(scanRecordsTable.sessionId, sessionsTable.id)
      )
      .where(eq(scanRecordsTable.lotNumber, lotNumber));

    return result;
  }

  /**
   * Get alternate usage report - which alternates were used in which sessions
   */
  static async getAlternateUsageReport(limit: number = 100) {
    const result = await db
      .select({
        feederNumber: scanRecordsTable.feederNumber,
        scannedMpn: scanRecordsTable.scannedMpn,
        alternateUsed: scanRecordsTable.alternateUsed,
        sessionId: scanRecordsTable.sessionId,
        scannedAt: scanRecordsTable.scannedAt,
      })
      .from(scanRecordsTable)
      .where(eq(scanRecordsTable.alternateUsed, true));

    return result.slice(0, limit);
  }

  /**
   * Record component history entry
   */
  static async recordComponentHistory(
    scanRecordId: number | null,
    reelId: string | null,
    mpn: string,
    lotNumber: string | null,
    dateCode: string | null,
    quantity?: number
  ) {
    const result = await db
      .insert(componentHistoryTable)
      .values({
        scanRecordId,
        reelId,
        mpn,
        lotNumber,
        dateCode,
        quantity,
      })
      .returning();

    return result[0];
  }
}
