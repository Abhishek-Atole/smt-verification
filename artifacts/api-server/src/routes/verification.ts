import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  bomsTable,
  changeoverSessionsTable,
  feederScansTable,
  scanRecordsTable,
  sessionsTable,
  auditLogsTable,
  spliceRecordsTable,
  bomItemsTable,
  componentAlternatesTable,
  componentsTable,
  sessionHandoversTable,
} from "@workspace/db/schema";
import { and, desc, eq, inArray, isNull, sql, or, gt, lt, lte } from "drizzle-orm";
import { usersTable } from "@workspace/db/schema";
import { getSessionProgress, verifyFeederScan } from "../services/verificationService";
import ScanValidationPipeline from "../services/scan-validation-pipeline";
import { generateSessionId } from "../lib/generateSessionId";
import { parsePagination, paginate } from "../lib/pagination";
import { isUniqueViolation } from "../lib/dbErrors";
import {
  attachActor,
  requireOperatorSessionOwnership,
  requireSessionReadAccess,
  requireRole,
  requireAuth,
  type AuthRequest,
} from "../middleware/auth";

const router: IRouter = Router();

router.use(attachActor);

function toNumber(value: unknown): number {
  return Number(value);
}

async function getEnrichedScansForSession(sessionId: string, limit?: number) {
  const [session] = await db
    .select({ id: changeoverSessionsTable.id, bomId: changeoverSessionsTable.bomId })
    .from(changeoverSessionsTable)
    .where(eq(changeoverSessionsTable.id, sessionId));

  if (!session) {
    return null;
  }

  const query = db
    .select()
    .from(feederScansTable)
    .where(eq(feederScansTable.sessionId, sessionId))
    .orderBy(desc(feederScansTable.scannedAt));

  const scans = limit ? await query.limit(limit) : await query;

  const feederNumbers = Array.from(new Set(scans.map((scan) => scan.feederNumber).filter(Boolean)));
  const bomMap = new Map<string, {
    internalPartNumber: string | null;
    mpn1: string | null;
    mpn2: string | null;
    mpn3: string | null;
    make1: string | null;
    make2: string | null;
    make3: string | null;
    description: string | null;
    packageDescription: string | null;
  }>();

  if (feederNumbers.length > 0) {
    const { bomItemsTable } = await import("@workspace/db/schema");
    const bomItems = await db
      .select({
        feederNumber: bomItemsTable.feederNumber,
        internalPartNumber: bomItemsTable.internalPartNumber,
        mpn1: bomItemsTable.mpn1,
        mpn2: bomItemsTable.mpn2,
        mpn3: bomItemsTable.mpn3,
        make1: bomItemsTable.make1,
        make2: bomItemsTable.make2,
        make3: bomItemsTable.make3,
        description: bomItemsTable.itemName,
        packageDescription: bomItemsTable.packageDescription,
      })
      .from(bomItemsTable)
      .where(
        and(
          eq(bomItemsTable.bomId, session.bomId),
          inArray(bomItemsTable.feederNumber, feederNumbers),
        ),
      );

    for (const item of bomItems) {
      if (!bomMap.has(item.feederNumber)) {
        bomMap.set(item.feederNumber, {
          internalPartNumber: item.internalPartNumber,
          mpn1: item.mpn1,
          mpn2: item.mpn2,
          mpn3: item.mpn3,
          make1: item.make1,
          make2: item.make2,
          make3: item.make3,
          description: item.description,
          packageDescription: item.packageDescription,
        });
      }
    }
  }

  const enrichedScans = scans.map((scan) => {
    const bom = bomMap.get(scan.feederNumber) ?? null;
    return {
      ...scan,
      approvedBy: scan.matchedField === "manual_override" ? scan.matchedMake : null,
      bom: {
        internalPartNumber: bom?.internalPartNumber ?? null,
        mpn1: bom?.mpn1 ?? null,
        mpn2: bom?.mpn2 ?? null,
        mpn3: bom?.mpn3 ?? null,
        make1: bom?.make1 ?? null,
        make2: bom?.make2 ?? null,
        make3: bom?.make3 ?? null,
        description: bom?.description ?? null,
        packageDescription: bom?.packageDescription ?? null,
      },
    };
  });

  return { session, scans: enrichedScans };
}

router.post("/verification/sessions", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const operatorId = String(req.body?.operatorId ?? "").trim();
    const bomId = toNumber(req.body?.bomId);

    if (!operatorId || !Number.isFinite(bomId)) {
      res.status(400).json({ error: "operatorId and bomId are required" });
      return;
    }

    // Enforce max 2 active sessions per operator
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(changeoverSessionsTable)
      .where(and(eq(changeoverSessionsTable.operatorId, operatorId), eq(changeoverSessionsTable.status, "active")));

    if (countResult && countResult.count >= 2) {
      res.status(409).json({ error: "Complete your previous active sessions before creating a new one. Maximum 2 active sessions allowed." });
      return;
    }

    // Generate new session ID in format SMT_YYYYMMDD_NNNNNN
    const sessionId = await generateSessionId();

    const [session] = await db
      .insert(changeoverSessionsTable)
      .values({
        id: sessionId,
        operatorId,
        bomId,
        status: "active",
      })
      .returning();

    res.status(201).json(session);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create verification session" });
  }
});

router.get("/verification/sessions", requireAuth, async (req: AuthRequest, res) => {
  try {
    const actor = req.actor!;
    const requestedRole = String(req.query.role ?? "").trim().toLowerCase();
    const pg = parsePagination(req);

    if (requestedRole === "qa" || requestedRole === "supervisor") {
      if (actor.role !== "qa" && actor.role !== "supervisor" && actor.role !== "admin") {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(changeoverSessionsTable);

      const sessions = await db
        .select({
          id: changeoverSessionsTable.id,
          operatorId: changeoverSessionsTable.operatorId,
          bomId: changeoverSessionsTable.bomId,
          status: changeoverSessionsTable.status,
          startedAt: changeoverSessionsTable.startedAt,
          completedAt: changeoverSessionsTable.completedAt,
          verificationMode: changeoverSessionsTable.verificationMode,
          createdAt: changeoverSessionsTable.createdAt,
        })
        .from(changeoverSessionsTable)
        .orderBy(desc(changeoverSessionsTable.startedAt))
        .limit(pg.limit)
        .offset(pg.offset);

      res.json(paginate(sessions, total, pg));
      return;
    }

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(changeoverSessionsTable)
      .where(and(eq(changeoverSessionsTable.operatorId, actor.id), eq(changeoverSessionsTable.status, "active")));

    const sessions = await db
      .select({
        id: changeoverSessionsTable.id,
        operatorId: changeoverSessionsTable.operatorId,
        bomId: changeoverSessionsTable.bomId,
        status: changeoverSessionsTable.status,
        startedAt: changeoverSessionsTable.startedAt,
        completedAt: changeoverSessionsTable.completedAt,
        verificationMode: changeoverSessionsTable.verificationMode,
        createdAt: changeoverSessionsTable.createdAt,
      })
      .from(changeoverSessionsTable)
      .where(and(eq(changeoverSessionsTable.operatorId, actor.id), eq(changeoverSessionsTable.status, "active")))
      .orderBy(desc(changeoverSessionsTable.startedAt))
      .limit(pg.limit)
      .offset(pg.offset);

    res.json(paginate(sessions, total, pg));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list verification sessions" });
  }
});

router.get("/verification/sessions/mine", requireAuth, async (req: AuthRequest, res) => {
  try {
    const actor = req.actor!;
    const pg = parsePagination(req);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(changeoverSessionsTable)
      .where(and(eq(changeoverSessionsTable.operatorId, actor.id), eq(changeoverSessionsTable.status, "active")));

    const sessions = await db
      .select({
        id: changeoverSessionsTable.id,
        operatorId: changeoverSessionsTable.operatorId,
        bomId: changeoverSessionsTable.bomId,
        status: changeoverSessionsTable.status,
        startedAt: changeoverSessionsTable.startedAt,
        completedAt: changeoverSessionsTable.completedAt,
        verificationMode: changeoverSessionsTable.verificationMode,
        createdAt: changeoverSessionsTable.createdAt,
      })
      .from(changeoverSessionsTable)
      .where(and(eq(changeoverSessionsTable.operatorId, actor.id), eq(changeoverSessionsTable.status, "active")))
      .orderBy(desc(changeoverSessionsTable.startedAt))
      .limit(pg.limit)
      .offset(pg.offset);

    res.json(paginate(sessions, total, pg));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list operator sessions" });
  }
});

router.get("/verification/sessions/active", requireAuth, async (req: AuthRequest, res) => {
  try {
    const actor = req.actor!;
    const isOperator = actor.role === "operator";

    // Query changeover sessions table
    const changeoverQuery = db
      .select({
        id: changeoverSessionsTable.id,
        bomId: changeoverSessionsTable.bomId,
        operatorId: changeoverSessionsTable.operatorId,
        operatorName: usersTable.name,
        status: changeoverSessionsTable.status,
        startedAt: changeoverSessionsTable.startedAt,
        bomName: bomsTable.name,
      })
      .from(changeoverSessionsTable)
      .leftJoin(bomsTable, eq(changeoverSessionsTable.bomId, bomsTable.id))
      .leftJoin(usersTable, eq(changeoverSessionsTable.operatorId, usersTable.id))
      .$dynamic();

    const changeoverConditions = [inArray(changeoverSessionsTable.status, ["active", "qa_confirmed"])];
    if (isOperator) {
      changeoverConditions.push(eq(changeoverSessionsTable.operatorId, actor.id));
    }

    const changeoverSessions = await changeoverQuery
      .where(and(...changeoverConditions))
      .orderBy(desc(changeoverSessionsTable.startedAt))
      .limit(100);

    // Also include active sessions from legacy sessions table
    let legacySessions: {
      id: string; bomId: number | null; operatorId: string | null;
      operatorName: string | null; status: string | null;
      startedAt: Date | null; bomName: string | null;
    }[] = [];

    const legacy = await db
      .select({
        id: sessionsTable.id,
        bomId: sessionsTable.bomId,
        operatorName: sessionsTable.operatorName,
        status: sessionsTable.status,
        startedAt: sessionsTable.startTime,
        bomName: bomsTable.name,
      })
      .from(sessionsTable)
      .leftJoin(bomsTable, eq(sessionsTable.bomId, bomsTable.id))
      .where(and(
        inArray(sessionsTable.status, ["active", "qa_confirmed"]),
        isNull(sessionsTable.endTime),
        isNull(sessionsTable.deletedAt),
      ))
      .orderBy(desc(sessionsTable.startTime));

    legacySessions = legacy.map((s) => ({
      id: String(s.id),
      bomId: s.bomId,
      operatorId: String(s.id),
      operatorName: s.operatorName,
      status: s.status,
      startedAt: s.startedAt,
      bomName: s.bomName,
    }));

    const merged = [...changeoverSessions, ...legacySessions].sort(
      (a, b) => new Date(b.startedAt ?? 0).getTime() - new Date(a.startedAt ?? 0).getTime()
    );

    res.json({ sessions: merged, total: merged.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load active sessions" });
  }
});

router.get("/verification/sessions/:sessionId/progress", requireSessionReadAccess, async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId ?? "").trim();
    if (!sessionId) {
      res.status(400).json({ error: "Invalid sessionId" });
      return;
    }

    const [session] = await db
      .select({ id: changeoverSessionsTable.id })
      .from(changeoverSessionsTable)
      .where(eq(changeoverSessionsTable.id, sessionId));

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const progress = await getSessionProgress(sessionId);
    const verifiedRows = await db
      .select({ feederNumber: feederScansTable.feederNumber })
      .from(feederScansTable)
      .where(
        and(
          eq(feederScansTable.sessionId, sessionId),
          eq(feederScansTable.status, "verified"),
        ),
      )
      .groupBy(feederScansTable.feederNumber);

    res.json({
      ...progress,
      verifiedFeeders: verifiedRows.map((row) => row.feederNumber),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get session progress" });
  }
});

router.post("/verification/scan", requireOperatorSessionOwnership, async (req: AuthRequest, res) => {
  try {
    const sessionId = String(req.body?.sessionId ?? "").trim(); // String format: SMT_YYYYMMDD_NNNNNN
    const feederNumber = String(req.body?.feederNumber ?? "").trim();
    const scannedValue = String(req.body?.scannedValue ?? "").trim();
    const lotNumber = req.body?.lotNumber == null ? null : String(req.body.lotNumber);
    const dateCode = req.body?.dateCode == null ? null : String(req.body.dateCode);
    const reelId = req.body?.reelId == null ? null : String(req.body.reelId);

    if (!sessionId || !feederNumber || !scannedValue) {
      res.status(400).json({
        error: "sessionId, feederNumber, and scannedValue are required",
      });
      return;
    }

    // Get session to verify operator ownership and get operatorId
    const [session] = await db
      .select({
        id: changeoverSessionsTable.id,
        operatorId: changeoverSessionsTable.operatorId,
        verificationMode: changeoverSessionsTable.verificationMode,
        status: changeoverSessionsTable.status,
      })
      .from(changeoverSessionsTable)
      .where(eq(changeoverSessionsTable.id, sessionId));

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // Run 7-stage validation pipeline
    const verificationMode = session.verificationMode as "AUTO" | "MANUAL" | "FREE_SCAN";
    const validationResult = await ScanValidationPipeline.validate(
      sessionId,
      feederNumber,
      scannedValue,
      verificationMode
    );

    // If MANUAL mode and failed, return requiresOverride flag
    // Frontend will show ManualOverrideDialog to get supervisor approval
    if (
      session.verificationMode === "MANUAL" &&
      validationResult.status === "failed" &&
      validationResult.requiresOverride
    ) {
      res.status(202).json({
        ...validationResult,
        requiresOverride: true,
        message: `Manual override required. Contact supervisor to approve: ${scannedValue}`,
      });
      return;
    }

    // Write scan record in transaction (optimistic locking - BUG-23 fix)
    let savedScan: any;
    let idempotentRetry = false;
    try {
      await db.transaction(async (tx) => {
        // Lock session row for update
        await tx.execute(
          sql`SELECT 1 FROM changeover_sessions WHERE id = ${sessionId} FOR UPDATE`
        );

        // Map validation result to database status
        let dbStatus: "verified" | "failed" | "duplicate";
        if (
          validationResult.status === "pass" ||
          validationResult.status === "alternate_pass" ||
          validationResult.status === "manual_pass"
        ) {
          dbStatus = "verified";
        } else {
          dbStatus = "failed";
        }

        const result = await tx
          .insert(feederScansTable)
          .values({
            sessionId,
            feederNumber,
            scannedValue,
            matchedField: validationResult.matchedField,
            matchedMake: validationResult.matchedMake,
            lotCode: lotNumber || null,
            verificationMode: session.verificationMode,
            status: dbStatus,
            operatorId: session.operatorId,
          })
          .returning();

        savedScan = result[0];
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Idempotent retry: re-fetch the row that already represents this scan
      // and return it without re-writing the audit log.
      idempotentRetry = true;
      req.log.warn(
        { sessionId, feederNumber, scannedValue },
        "/verification/scan idempotent retry: unique violation absorbed",
      );
      const [existing] = await db
        .select()
        .from(feederScansTable)
        .where(
          and(
            eq(feederScansTable.sessionId, sessionId),
            eq(feederScansTable.feederNumber, feederNumber),
            eq(feederScansTable.scannedValue, scannedValue),
          ),
        )
        .orderBy(desc(feederScansTable.scannedAt))
        .limit(1);
      savedScan = existing;
    }

    if (!idempotentRetry) {
      // Write audit log for this scan (only on first insert)
      await db
        .insert(auditLogsTable)
        .values({
          entityType: "scan",
          entityId: String(savedScan.id),
          action: "create",
          oldValue: JSON.stringify({}),
          newValue: JSON.stringify({
            status: validationResult.status,
            feederNumber,
            scannedValue,
            matchedField: validationResult.matchedField,
          }),
          changedBy: session.operatorId,
          description: `Feeder ${feederNumber} scan: ${validationResult.message}`,
        })
        .catch((err) => req.log.warn("Audit log write failed:", err));
    }

    // Get session progress for dashboard update
    const progress = await getSessionProgress(sessionId);

    // Auto-transition to pending_qa when all feeders have been scanned
    if (
      progress.total > 0 &&
      progress.verified >= progress.total &&
      session.status === "active"
    ) {
      await transitionToPendingQA(sessionId).catch((err) =>
        req.log.warn({ err, sessionId }, "Failed to auto-transition to pending_qa"),
      );
    }

    // Return enriched result to frontend
    res.json({
      id: savedScan?.id,
      ...validationResult,
      progress,
      timestamp: new Date().toISOString(),
      ...(idempotentRetry ? { idempotent: true } : {}),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to process feeder scan" });
  }
});

router.get("/verification/sessions/:sessionId/scans", requireSessionReadAccess, async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId ?? "").trim();
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    const payload = await getEnrichedScansForSession(sessionId, 20);
    if (!payload) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json({ scans: payload.scans });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list feeder scans" });
  }
});

router.get("/verification/sessions/:sessionId/final-report", requireSessionReadAccess, async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId ?? "").trim();
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    const payload = await getEnrichedScansForSession(sessionId);
    if (!payload) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const scans = payload.scans;
    const summary = {
      totalScans: scans.length,
      verified: scans.filter((scan) => scan.status === "verified").length,
      failed: scans.filter((scan) => scan.status === "failed").length,
      duplicate: scans.filter((scan) => scan.status === "duplicate").length,
      manualOverride: scans.filter((scan) => scan.verificationMode === "MANUAL_OVERRIDE").length,
      auto: scans.filter((scan) => scan.verificationMode !== "MANUAL_OVERRIDE").length,
    };

    const splices = await db
      .select()
      .from(spliceRecordsTable)
      .where(eq(spliceRecordsTable.changeoverId, sessionId))
      .orderBy(spliceRecordsTable.splicedAt);

    res.json({
      reportType: "VERIFICATION_FINAL_REPORT",
      sessionId,
      generatedAt: new Date().toISOString(),
      summary,
      scans,
      splices,
      spliceStats: {
        total: splices.length,
        verified: splices.filter((s) => s.qaResult === "pass" || s.qaResult === "alternate_accepted").length,
        rejected: splices.filter((s) => s.qaResult === "fail").length,
        unverified: splices.filter((s) => !s.qaResult || s.qaResult === "pending").length,
      },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to generate final report" });
  }
});

// ── PHASE 1: STRICT AUTO FEEDER VERIFICATION ────────────────────────────────

/**
 * POST /api/verification/check-feeder
 * Step 1: Validate feeder number exists in BOM for current session
 */
router.post("/verification/check-feeder", attachActor, async (req: AuthRequest, res) => {
  try {
    const sessionId = String(req.body?.sessionId ?? "").trim();
    const feederNumber = String(req.body?.feederNumber ?? "").trim();

    if (!sessionId || !feederNumber) {
      res.status(400).json({ error: "sessionId and feederNumber are required" });
      return;
    }

    // Get session and BOM
    const session = await db.query.changeoverSessionsTable.findFirst({
      where: eq(changeoverSessionsTable.id, sessionId),
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // Check if feeder already scanned in this session
    const existingScan = await db.query.feederScansTable.findFirst({
      where: and(
        eq(feederScansTable.sessionId, sessionId),
        eq(feederScansTable.feederNumber, feederNumber),
        eq(feederScansTable.status, "verified")
      ),
    });

    if (existingScan) {
      return res.json({
        found: true,
        alreadyScanned: true,
        message: `Feeder ${feederNumber} already verified`,
      });
    }

    // Look up feeder in BOM
    const { bomItemsTable } = await import("@workspace/db/schema");
    const bomItem = await db.query.bomItemsTable.findFirst({
      where: and(
        eq(bomItemsTable.bomId, session.bomId),
        eq(bomItemsTable.feederNumber, feederNumber)
      ),
    });

    if (!bomItem) {
      return res.json({
        found: false,
        message: `Feeder ${feederNumber} not in BOM`,
      });
    }

    // Return BOM data for this feeder
    res.json({
      found: true,
      alreadyScanned: false,
      bomData: {
        feederNumber: bomItem.feederNumber,
        internalPartNumber: bomItem.internalPartNumber,
        mpn1: bomItem.mpn1,
        mpn2: bomItem.mpn2,
        mpn3: bomItem.mpn3,
        make1: bomItem.make1,
        make2: bomItem.make2,
        make3: bomItem.make3,
        description: bomItem.itemName,
        packageDescription: bomItem.packageDescription,
      },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

/**
 * POST /api/verification/validate-mpn
 * Step 2: Validate scanned MPN matches one of the BOM options
 */
router.post("/verification/validate-mpn", attachActor, async (req: AuthRequest, res) => {
  try {
    const sessionId = String(req.body?.sessionId ?? "").trim();
    const feederNumber = String(req.body?.feederNumber ?? "").trim();
    const scannedValue = String(req.body?.scannedValue ?? "").trim();

    if (!sessionId || !feederNumber || !scannedValue) {
      res.status(400).json({ error: "sessionId, feederNumber, and scannedValue are required" });
      return;
    }

    const session = await db.query.changeoverSessionsTable.findFirst({
      where: eq(changeoverSessionsTable.id, sessionId),
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const { bomItemsTable } = await import("@workspace/db/schema");
    const bomItem = await db.query.bomItemsTable.findFirst({
      where: and(
        eq(bomItemsTable.bomId, session.bomId),
        eq(bomItemsTable.feederNumber, feederNumber)
      ),
    });

    if (!bomItem) {
      res.status(404).json({ error: "Feeder not in BOM" });
      return;
    }

    // STRICT EXACT MATCH — case-insensitive, trimmed
    const scanned = scannedValue.toUpperCase();
    const mpn1 = bomItem.mpn1?.trim().toUpperCase() ?? "";
    const mpn2 = bomItem.mpn2?.trim().toUpperCase() ?? "";
    const mpn3 = bomItem.mpn3?.trim().toUpperCase() ?? "";

    // Also check internal part number tokens
    const internalTokens = (bomItem.internalPartNumber || "")
      .split(/\s+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);

    let matchedField: string | null = null;
    let matchedMake: string | null = null;
    let isAlternate = false;

    if (mpn1 && scanned === mpn1) {
      matchedField = "mpn1";
      matchedMake = bomItem.make1;
      isAlternate = false;
    } else if (mpn2 && scanned === mpn2) {
      matchedField = "mpn2";
      matchedMake = bomItem.make2;
      isAlternate = true;
    } else if (mpn3 && scanned === mpn3) {
      matchedField = "mpn3";
      matchedMake = bomItem.make3;
      isAlternate = true;
    } else if (internalTokens.includes(scanned)) {
      matchedField = "internalPartNumber";
      matchedMake = null;
      isAlternate = false;
    } else {
      // NO MATCH
      return res.json({
        valid: false,
        error: "MPN_MISMATCH",
        scanned: scannedValue,
        expected: [mpn1, mpn2, mpn3].filter(Boolean),
      });
    }

    // MATCH FOUND
    const alternateCount = [mpn1, mpn2, mpn3].filter(Boolean).length;

    res.json({
      valid: true,
      matchedField,
      matchedMake,
      isAlternate,
      alternateCount,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Validation error" });
  }
});

/**
 * POST /api/verification/save-scan
 * Step 3: Save the complete scan record to database
 */
router.post("/verification/save-scan", attachActor, async (req: AuthRequest, res) => {
  try {
    const {
      sessionId,
      feederNumber,
      scannedValue,
      lotCode,
      matchedField,
      matchedMake,
      status,
      verificationMode,
    } = req.body;

    if (!sessionId || !feederNumber || !scannedValue) {
      res.status(400).json({ error: "sessionId, feederNumber, and scannedValue are required" });
      return;
    }

    const actor = req.actor!;

    try {
      await db.transaction(async (tx) => {
        // Insert scan record
        await tx.insert(feederScansTable).values({
          sessionId,
          feederNumber,
          scannedValue,
          lotCode: lotCode || null,
          matchedField,
          matchedMake,
          status: status || "verified",
          verificationMode: verificationMode || "AUTO",
          operatorId: actor.id,
          scannedAt: new Date(),
        });

        // Get updated progress
        const progress = await getSessionProgress(sessionId);

        res.json({ success: true, progress });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Client retry of an already-recorded scan within the idempotency
        // window — return success without inserting a second row.
        req.log.warn(
          { sessionId, feederNumber, scannedValue },
          "save-scan idempotent retry: unique violation absorbed",
        );
        const progress = await getSessionProgress(sessionId);
        res.json({ success: true, progress, idempotent: true });
        return;
      }
      throw err;
    }
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to save scan" });
  }
});

/**
 * POST /api/verification/sessions/:sessionId/reset
 * Reset all scans and splices for a session
 */
router.post("/verification/sessions/:sessionId/reset", attachActor, requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = String(req.params.sessionId ?? "").trim();

    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    await db.transaction(async (tx) => {
      // Delete all scans for this session
      await tx.delete(feederScansTable).where(eq(feederScansTable.sessionId, sessionId));

      // TODO: Delete all splices for this session when added

      // Update session status back to active
      await tx
        .update(changeoverSessionsTable)
        .set({ status: "active", completedAt: null })
        .where(eq(changeoverSessionsTable.id, sessionId));
    });

    res.json({ success: true, message: "Session reset" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to reset session" });
  }
});

// ── SECTION 3: 200% FEEDER VERIFICATION (QA/Engineer reverification) ──────────

/**
 * transitionToPendingQA(sessionId)
 * Mark a session as pending QA review after operator completes changeover scanning.
 * This triggers the session to appear in the QA/Engineer dashboard.
 */
async function transitionToPendingQA(sessionId: string): Promise<void> {
  const [session] = await db
    .select({ operatorId: changeoverSessionsTable.operatorId })
    .from(changeoverSessionsTable)
    .where(eq(changeoverSessionsTable.id, sessionId));

  if (!session) throw new Error(`Session ${sessionId} not found`);

  await db.transaction(async (tx) => {
    await tx
      .update(changeoverSessionsTable)
      .set({
        status: "pending_qa",
        changeoverOperatorId: session.operatorId,
      })
      .where(eq(changeoverSessionsTable.id, sessionId));

    await tx.insert(auditLogsTable).values({
      entityType: "session",
      entityId: sessionId,
      action: "session_pending_qa",
      changedBy: session.operatorId,
      newValue: JSON.stringify({ sessionId, operatorId: session.operatorId }),
      description: `Session ${sessionId} entered QA review queue (changeover complete)`,
    });
  });
}

/**
 * Count splices for a changeover that have not yet been approved or rejected
 * by QA/Supervisor (qa_result NULL or 'pending').
 */
async function countUnverifiedSplices(changeoverId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(spliceRecordsTable)
    .where(
      and(
        eq(spliceRecordsTable.changeoverId, changeoverId),
        or(
          isNull(spliceRecordsTable.qaResult),
          eq(spliceRecordsTable.qaResult, "pending"),
        ),
      ),
    );
  return row?.count ?? 0;
}

function rejectUnverifiedSplices(res: any, unverifiedCount: number): void {
  res.status(409).json({
    error: "Splice verification incomplete",
    unverified_splice_count: unverifiedCount,
    action_required:
      "Approve or reject each pending splice via POST /api/verification/splices/:spliceId/approve or /reject before confirming this session.",
  });
}

/**
 * GET /api/verification/qa-queue
 * Returns sessions pending or recently completed QA review.
 * Access: qa, engineer only.
 */
router.get(
  "/verification/qa-queue",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const pg = parsePagination(req);
      const qaStatuses = ["pending_qa", "qa_in_review", "qa_confirmed"] as const;

      // Count totals for pagination metadata
      const [{ totalCo }] = await db
        .select({ totalCo: sql<number>`count(*)::int` })
        .from(changeoverSessionsTable)
        .where(inArray(changeoverSessionsTable.status, qaStatuses));

      const [{ totalLegacy }] = await db
        .select({ totalLegacy: sql<number>`count(*)::int` })
        .from(sessionsTable)
        .where(and(
          inArray(sessionsTable.status, ["pending_qa", "qa_in_review", "qa_confirmed"]),
          isNull(sessionsTable.deletedAt),
        ));

      const total = totalCo + totalLegacy;

      if (total === 0) {
        res.json(paginate([], total, pg));
        return;
      }

      // Fetch changeover sessions in QA flow (paginated)
      const changeoverSessions = await db
        .select({
          id: changeoverSessionsTable.id,
          operatorId: changeoverSessionsTable.operatorId,
          operatorName: usersTable.name,
          status: changeoverSessionsTable.status,
          startedAt: changeoverSessionsTable.startedAt,
          completedAt: changeoverSessionsTable.completedAt,
          qaVerifiedById: changeoverSessionsTable.qaVerifiedById,
          qaVerifiedAt: changeoverSessionsTable.qaVerifiedAt,
          qaDiscrepancyFound: changeoverSessionsTable.qaDiscrepancyFound,
          qaLockExpiresAt: changeoverSessionsTable.qaLockExpiresAt,
          bomId: changeoverSessionsTable.bomId,
          bomName: bomsTable.name,
          verificationMode: changeoverSessionsTable.verificationMode,
        })
        .from(changeoverSessionsTable)
        .leftJoin(usersTable, eq(changeoverSessionsTable.operatorId, usersTable.id))
        .leftJoin(bomsTable, eq(changeoverSessionsTable.bomId, bomsTable.id))
        .where(inArray(changeoverSessionsTable.status, qaStatuses))
        .orderBy(desc(changeoverSessionsTable.startedAt))
        .limit(pg.limit)
        .offset(pg.offset);

      // Also fetch legacy sessions in QA flow (no pagination — usually very few)
      const legacySessions = await db
        .select({
          id: sessionsTable.id,
          operatorId: sql<string | null>`NULL`,
          operatorName: sessionsTable.operatorName,
          status: sessionsTable.status,
          startedAt: sessionsTable.startTime,
          completedAt: sessionsTable.endTime,
          qaVerifiedById: sql<string | null>`NULL`,
          qaVerifiedAt: sql<Date | null>`NULL`,
          qaDiscrepancyFound: sql<boolean | null>`NULL`,
          qaLockExpiresAt: sql<Date | null>`NULL`,
          bomId: sessionsTable.bomId,
          bomName: bomsTable.name,
          verificationMode: sessionsTable.verificationMode,
        })
        .from(sessionsTable)
        .leftJoin(bomsTable, eq(sessionsTable.bomId, bomsTable.id))
        .where(
          and(
            inArray(sessionsTable.status, ["pending_qa", "qa_in_review", "qa_confirmed"]),
            isNull(sessionsTable.deletedAt),
          ),
        )
        .orderBy(desc(sessionsTable.startTime));

      const allSessions = [...changeoverSessions, ...legacySessions];

      // Collect session IDs for bulk scan-count queries
      const changeoverIds = changeoverSessions.map((s) => String(s.id));
      const legacyIds = legacySessions
        .filter((s) => /^\d+$/.test(String(s.id)))
        .map((s) => Number(s.id));

      // Build maps for O(1) lookup — replaces N+1 per-session queries
      const totalScanMap = new Map<string, number>();
      const pendingQaMap = new Map<string, number>();
      const legacyTotalMap = new Map<number, number>();
      const spliceTotalMap = new Map<string, number>();
      const spliceUnverifiedMap = new Map<string, number>();

      if (changeoverIds.length > 0) {
        // Bulk-fetch total scan counts for ALL changeover sessions in one query
        const totalCountRows = await db
          .select({
            sessionId: feederScansTable.sessionId,
            count: sql<number>`count(*)::int`,
          })
          .from(feederScansTable)
          .where(inArray(feederScansTable.sessionId, changeoverIds))
          .groupBy(feederScansTable.sessionId);
        for (const row of totalCountRows) {
          totalScanMap.set(row.sessionId, row.count);
        }

        // Bulk-fetch pending-QA scan counts for ALL changeover sessions in one query
        const pendingCountRows = await db
          .select({
            sessionId: feederScansTable.sessionId,
            count: sql<number>`count(*)::int`,
          })
          .from(feederScansTable)
          .where(
            and(
              inArray(feederScansTable.sessionId, changeoverIds),
              or(
                isNull(feederScansTable.qaResult),
                eq(feederScansTable.qaResult, "pending"),
              ),
            ),
          )
          .groupBy(feederScansTable.sessionId);
        for (const row of pendingCountRows) {
          pendingQaMap.set(row.sessionId, row.count);
        }

        // Bulk-fetch total splice counts (Part C2) — splice_records.changeover_id = session id
        const spliceTotalRows = await db
          .select({
            changeoverId: spliceRecordsTable.changeoverId,
            count: sql<number>`count(*)::int`,
          })
          .from(spliceRecordsTable)
          .where(inArray(spliceRecordsTable.changeoverId, changeoverIds))
          .groupBy(spliceRecordsTable.changeoverId);
        for (const row of spliceTotalRows) {
          spliceTotalMap.set(row.changeoverId, row.count);
        }

        // Bulk-fetch unverified splice counts (qa_result NULL or 'pending')
        const spliceUnverifiedRows = await db
          .select({
            changeoverId: spliceRecordsTable.changeoverId,
            count: sql<number>`count(*)::int`,
          })
          .from(spliceRecordsTable)
          .where(
            and(
              inArray(spliceRecordsTable.changeoverId, changeoverIds),
              or(
                isNull(spliceRecordsTable.qaResult),
                eq(spliceRecordsTable.qaResult, "pending"),
              ),
            ),
          )
          .groupBy(spliceRecordsTable.changeoverId);
        for (const row of spliceUnverifiedRows) {
          spliceUnverifiedMap.set(row.changeoverId, row.count);
        }
      }

      if (legacyIds.length > 0) {
        const legacyCountRows = await db
          .select({
            sessionId: scanRecordsTable.sessionId,
            count: sql<number>`count(*)::int`,
          })
          .from(scanRecordsTable)
          .where(inArray(scanRecordsTable.sessionId, legacyIds))
          .groupBy(scanRecordsTable.sessionId);
        for (const row of legacyCountRows) {
          legacyTotalMap.set(row.sessionId, row.count);
        }
      }

      // Status sort rank
      const statusRank: Record<string, number> = {
        pending_qa: 0,
        qa_in_review: 1,
        qa_confirmed: 2,
        incomplete: 3,
      };

      // Enrich — zero DB queries in this loop (all counts from Maps)
      const enriched = allSessions.map((s) => {
        const isLegacy = typeof s.id === "number" || /^\d+$/.test(String(s.id));
        const sid = String(s.id);
        let totalScans = 0;
        let pendingQa = 0;
        if (isLegacy) {
          totalScans = legacyTotalMap.get(Number(sid)) ?? 0;
          pendingQa = s.status === "qa_confirmed" ? 0 : totalScans;
        } else {
          totalScans = totalScanMap.get(sid) ?? 0;
          pendingQa = pendingQaMap.get(sid) ?? 0;
        }
        const spliceCount = isLegacy ? 0 : spliceTotalMap.get(sid) ?? 0;
        const unverifiedSplices = isLegacy ? 0 : spliceUnverifiedMap.get(sid) ?? 0;
        return {
          ...s,
          totalScans,
          pendingQa,
          spliceCount,
          unverifiedSplices,
          hasPendingSplices: unverifiedSplices > 0,
          sortRank: statusRank[s.status] ?? 9,
        };
      });

      enriched.sort((a, b) => {
        if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
        return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
      });

      res.json(paginate(enriched, total, pg));
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to load QA queue" });
    }
  },
);

/**
 * GET /api/verification/qa-queue/:sessionId
 * Returns full session detail for QA reverification.
 */
router.get(
  "/verification/qa-queue/:sessionId",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const sessionId = String(req.params.sessionId ?? "").trim();
      if (!sessionId) {
        res.status(400).json({ error: "sessionId is required" });
        return;
      }

      const isLegacy = /^\d+$/.test(sessionId);

      let session: any;
      let scans: any[];
      let splices: any[];

      if (isLegacy) {
        const numericId = Number(sessionId);

        const [legacySession] = await db
          .select({
            id: sessionsTable.id,
            operatorName: sessionsTable.operatorName,
            status: sessionsTable.status,
            startedAt: sessionsTable.startTime,
            completedAt: sessionsTable.endTime,
            bomId: sessionsTable.bomId,
            bomName: bomsTable.name,
            verificationMode: sessionsTable.verificationMode,
          })
          .from(sessionsTable)
          .leftJoin(bomsTable, eq(sessionsTable.bomId, bomsTable.id))
          .where(and(eq(sessionsTable.id, numericId), isNull(sessionsTable.deletedAt)));

        if (!legacySession) {
          res.status(404).json({ error: "Session not found" });
          return;
        }

        session = {
          id: String(legacySession.id),
          operatorId: null,
          operatorName: legacySession.operatorName,
          status: legacySession.status,
          startedAt: legacySession.startedAt,
          completedAt: legacySession.completedAt,
          qaVerifiedById: null,
          qaVerifiedAt: null,
          qaDiscrepancyFound: null,
          qaLockExpiresAt: null,
          bomId: legacySession.bomId,
          bomName: legacySession.bomName,
          verificationMode: legacySession.verificationMode,
        };

        const rawScans = await db
          .select({
            id: scanRecordsTable.id,
            feederNumber: scanRecordsTable.feederNumber,
            scannedValue: scanRecordsTable.internalIdScanned,
            matchedField: sql<string | null>`NULL`,
            matchedMake: sql<string | null>`NULL`,
            lotCode: scanRecordsTable.lotNumber,
            status: scanRecordsTable.status,
            scannedAt: scanRecordsTable.scannedAt,
            operatorId: sql<string | null>`NULL`,
            qaVerifiedById: sql<string | null>`NULL`,
            qaVerifiedAt: sql<Date | null>`NULL`,
            qaResult: sql<string | null>`CASE WHEN ${scanRecordsTable.validationResult} = 'pass' THEN 'pass' WHEN ${scanRecordsTable.validationResult} = 'alternate_pass' THEN 'alternate_accepted' WHEN ${scanRecordsTable.validationResult} = 'mismatch' THEN 'fail' ELSE NULL END`,
            qaNotes: sql<string | null>`NULL`,
          })
          .from(scanRecordsTable)
          .where(eq(scanRecordsTable.sessionId, numericId))
          .orderBy(scanRecordsTable.feederNumber);

        scans = rawScans;
        splices = [];
      } else {
        const [coSession] = await db
          .select({
            id: changeoverSessionsTable.id,
            operatorId: changeoverSessionsTable.operatorId,
            operatorName: usersTable.name,
            status: changeoverSessionsTable.status,
            startedAt: changeoverSessionsTable.startedAt,
            completedAt: changeoverSessionsTable.completedAt,
            qaVerifiedById: changeoverSessionsTable.qaVerifiedById,
            qaVerifiedAt: changeoverSessionsTable.qaVerifiedAt,
            qaDiscrepancyFound: changeoverSessionsTable.qaDiscrepancyFound,
            qaLockExpiresAt: changeoverSessionsTable.qaLockExpiresAt,
            bomId: changeoverSessionsTable.bomId,
            bomName: bomsTable.name,
            verificationMode: changeoverSessionsTable.verificationMode,
          })
          .from(changeoverSessionsTable)
          .leftJoin(usersTable, eq(changeoverSessionsTable.operatorId, usersTable.id))
          .leftJoin(bomsTable, eq(changeoverSessionsTable.bomId, bomsTable.id))
          .where(eq(changeoverSessionsTable.id, sessionId));

        if (!coSession) {
          res.status(404).json({ error: "Session not found" });
          return;
        }

        session = coSession;

        const rawScans = await db
          .select({
            id: feederScansTable.id,
            feederNumber: feederScansTable.feederNumber,
            scannedValue: feederScansTable.scannedValue,
            matchedField: feederScansTable.matchedField,
            matchedMake: feederScansTable.matchedMake,
            lotCode: feederScansTable.lotCode,
            status: feederScansTable.status,
            scannedAt: feederScansTable.scannedAt,
            operatorId: feederScansTable.operatorId,
            qaVerifiedById: feederScansTable.qaVerifiedById,
            qaVerifiedAt: feederScansTable.qaVerifiedAt,
            qaResult: feederScansTable.qaResult,
            qaNotes: feederScansTable.qaNotes,
          })
          .from(feederScansTable)
          .where(eq(feederScansTable.sessionId, sessionId))
          .orderBy(feederScansTable.feederNumber);

        scans = rawScans;

        splices = await db
          .select({
            id: spliceRecordsTable.id,
            changeoverId: spliceRecordsTable.changeoverId,
            feederNumber: spliceRecordsTable.feederNumber,
            lineItemId: spliceRecordsTable.lineItemId,
            oldSpoolMpn: spliceRecordsTable.oldSpoolMpn,
            oldSpoolLot: spliceRecordsTable.oldSpoolLot,
            newSpoolMpn: spliceRecordsTable.newSpoolMpn,
            newSpoolLot: spliceRecordsTable.newSpoolLot,
            splicedBy: spliceRecordsTable.splicedBy,
            splicedAt: spliceRecordsTable.splicedAt,
            oldSpoolLotCode: spliceRecordsTable.oldSpoolLotCode,
            newSpoolLotCode: spliceRecordsTable.newSpoolLotCode,
            oldSpoolMatchedField: spliceRecordsTable.oldSpoolMatchedField,
            newSpoolMatchedField: spliceRecordsTable.newSpoolMatchedField,
            allocationVerified: spliceRecordsTable.allocationVerified,
            oldSpoolPayload: spliceRecordsTable.oldSpoolPayload,
            newSpoolPayload: spliceRecordsTable.newSpoolPayload,
            validationWarnings: spliceRecordsTable.validationWarnings,
            durationSeconds: spliceRecordsTable.durationSeconds,
            qaVerifiedById: spliceRecordsTable.qaVerifiedById,
            qaVerifiedAt: spliceRecordsTable.qaVerifiedAt,
            qaResult: spliceRecordsTable.qaResult,
          })
          .from(spliceRecordsTable)
          .where(eq(spliceRecordsTable.changeoverId, sessionId));
      }

      // Enrich scans with BOM expected values
      const feederNumbers = Array.from(new Set(scans.map((s) => s.feederNumber)));
      const bomItems = feederNumbers.length > 0 && session.bomId
        ? await db
            .select({
              feederNumber: bomItemsTable.feederNumber,
              mpn1: bomItemsTable.mpn1,
              mpn2: bomItemsTable.mpn2,
              mpn3: bomItemsTable.mpn3,
              make1: bomItemsTable.make1,
              make2: bomItemsTable.make2,
              make3: bomItemsTable.make3,
              description: bomItemsTable.itemName,
              internalPartNumber: bomItemsTable.internalPartNumber,
            })
            .from(bomItemsTable)
            .where(
              and(
                eq(bomItemsTable.bomId, session.bomId),
                inArray(bomItemsTable.feederNumber, feederNumbers),
              ),
            )
        : [];

      const bomMap = new Map(bomItems.map((b) => [b.feederNumber, b]));
      const enrichedScans = scans.map((scan) => ({
        ...scan,
        expected: bomMap.get(scan.feederNumber) ?? null,
      }));

      // Part C2: splice verification summary for the QA UI.
      const spliceStats = {
        total: splices.length,
        verified: splices.filter(
          (s) => s.qaResult === "pass" || s.qaResult === "alternate_accepted",
        ).length,
        rejected: splices.filter((s) => s.qaResult === "fail").length,
        unverified: splices.filter((s) => !s.qaResult || s.qaResult === "pending").length,
      };

      res.json({ session, scans: enrichedScans, splices, spliceStats });
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to load session detail" });
    }
  },
);

/**
 * POST /api/verification/qa-queue/:sessionId/lock
 * Lock a session for QA review (15 min lock).
 */
router.post(
  "/verification/qa-queue/:sessionId/lock",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const sessionId = String(req.params.sessionId ?? "").trim();
      const actor = req.actor!;
      const isLegacy = /^\d+$/.test(sessionId);

      if (isLegacy) {
        const numericId = Number(sessionId);
        const [session] = await db
          .select({ status: sessionsTable.status })
          .from(sessionsTable)
          .where(and(eq(sessionsTable.id, numericId), isNull(sessionsTable.deletedAt)));

        if (!session) {
          res.status(404).json({ error: "Session not found" });
          return;
        }

        const lockExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

        await db
          .update(sessionsTable)
          .set({
            status: session.status === "pending_qa" ? "qa_in_review" : session.status,
          })
          .where(eq(sessionsTable.id, numericId));

        await db.insert(auditLogsTable).values({
          entityType: "session",
          entityId: sessionId,
          action: "qa_lock_acquired",
          changedBy: actor.id,
          newValue: JSON.stringify({ sessionId, lockedBy: actor.id, expiresAt: lockExpiresAt.toISOString() }),
          description: `QA review lock acquired by ${actor.name} on legacy session ${sessionId}`,
        });

        res.json({ success: true, lockExpiresAt });
        return;
      }

      const [session] = await db
        .select({ status: changeoverSessionsTable.status, qaLockExpiresAt: changeoverSessionsTable.qaLockExpiresAt })
        .from(changeoverSessionsTable)
        .where(eq(changeoverSessionsTable.id, sessionId));

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      // Check if locked by someone else
      if (session.qaLockExpiresAt && new Date(session.qaLockExpiresAt) > new Date()) {
        res.status(423).json({
          error: "Session is locked by another reviewer",
          lockExpiresAt: session.qaLockExpiresAt,
          canTakeOver: true,
        });
        return;
      }

      const lockExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

      await db
        .update(changeoverSessionsTable)
        .set({
          qaLockExpiresAt: lockExpiresAt,
          status: session.status === "pending_qa" ? "qa_in_review" : session.status,
        })
        .where(eq(changeoverSessionsTable.id, sessionId));

      await db.insert(auditLogsTable).values({
        entityType: "session",
        entityId: sessionId,
        action: "qa_lock_acquired",
        changedBy: actor.id,
        newValue: JSON.stringify({ sessionId, lockedBy: actor.id, expiresAt: lockExpiresAt.toISOString() }),
        description: `QA review lock acquired by ${actor.name} on session ${sessionId}`,
      });

      res.json({ success: true, lockExpiresAt });
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to lock session" });
    }
  },
);

/**
 * POST /api/verification/qa-queue/:sessionId/unlock
 * Release QA lock (clear take-over, or release without completing).
 */
router.post(
  "/verification/qa-queue/:sessionId/unlock",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const sessionId = String(req.params.sessionId ?? "").trim();
      const isLegacy = /^\d+$/.test(sessionId);

      if (isLegacy) {
        const numericId = Number(sessionId);
        const [session] = await db
          .select({ status: sessionsTable.status })
          .from(sessionsTable)
          .where(and(eq(sessionsTable.id, numericId), isNull(sessionsTable.deletedAt)));

        if (!session) {
          res.status(404).json({ error: "Session not found" });
          return;
        }

        await db
          .update(sessionsTable)
          .set({
            status: session.status === "qa_in_review" ? "pending_qa" : session.status,
          })
          .where(eq(sessionsTable.id, numericId));

        res.json({ success: true, message: "Lock released" });
        return;
      }

      const [session] = await db
        .select({ status: changeoverSessionsTable.status })
        .from(changeoverSessionsTable)
        .where(eq(changeoverSessionsTable.id, sessionId));

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      await db
        .update(changeoverSessionsTable)
        .set({
          qaLockExpiresAt: null,
          status: session.status === "qa_in_review" ? "pending_qa" : session.status,
        })
        .where(eq(changeoverSessionsTable.id, sessionId));

      res.json({ success: true, message: "Lock released" });
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to unlock session" });
    }
  },
);

/**
 * POST /api/verification/qa-queue/:sessionId/manual-confirm
 * QA/Engineer confirms all feeder slots as manually verified.
 */
router.post(
  "/verification/qa-queue/:sessionId/manual-confirm",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const sessionId = String(req.params.sessionId ?? "").trim();
      const actor = req.actor!;
      const isLegacy = /^\d+$/.test(sessionId);

      if (isLegacy) {
        const numericId = Number(sessionId);
        const [session] = await db
          .select({ id: sessionsTable.id })
          .from(sessionsTable)
          .where(and(eq(sessionsTable.id, numericId), isNull(sessionsTable.deletedAt)));

        if (!session) {
          res.status(404).json({ error: "Session not found" });
          return;
        }

        await db.transaction(async (tx) => {
          // For legacy, just set all scans to 'ok' and validation_result to 'pass'
          await tx
            .update(scanRecordsTable)
            .set({
              status: "ok",
              validationResult: "pass",
            })
            .where(eq(scanRecordsTable.sessionId, numericId));

          await tx
            .update(sessionsTable)
            .set({
              status: "qa_confirmed",
              qaName: actor.name,
            })
            .where(eq(sessionsTable.id, numericId));

          const [{ count: updatedCount }] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(scanRecordsTable)
            .where(eq(scanRecordsTable.sessionId, numericId));

          await tx.insert(auditLogsTable).values({
            entityType: "session",
            entityId: sessionId,
            action: "qa_manual_confirm",
            changedBy: actor.id,
            newValue: JSON.stringify({ sessionId, verifiedBy: actor.id, feederCount: updatedCount }),
            description: `QA manual confirmation by ${actor.name} on legacy session ${sessionId} — ${updatedCount} feeder(s) confirmed`,
          });
        });

        res.json({ success: true, message: "All feeders manually confirmed" });
        return;
      }

      const [session] = await db
        .select({ id: changeoverSessionsTable.id })
        .from(changeoverSessionsTable)
        .where(eq(changeoverSessionsTable.id, sessionId));

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      // Part C1: block qa_confirmed unless every BOM feeder has a verified scan.
      const progress = await getSessionProgress(sessionId);
      const requiredCount = Math.max(progress.total, 1);
      if (progress.verified < requiredCount) {
        res.status(409).json({
          error: "QA 200 verification failed",
          verified_count: progress.verified,
          required_count: requiredCount,
        });
        return;
      }

      // Part C3: block confirmation while any splice is still unverified.
      const unverifiedSplices = await countUnverifiedSplices(sessionId);
      if (unverifiedSplices > 0) {
        rejectUnverifiedSplices(res, unverifiedSplices);
        return;
      }

      await db.transaction(async (tx) => {
        // Update all pending feeder scans to qa_result = 'pass'
        await tx
          .update(feederScansTable)
          .set({
            qaResult: "pass",
            qaVerifiedById: actor.id,
            qaVerifiedAt: new Date(),
          })
          .where(
            and(
              eq(feederScansTable.sessionId, sessionId),
              or(
                isNull(feederScansTable.qaResult),
                eq(feederScansTable.qaResult, "pending"),
              ),
            ),
          );

        // Update session
        await tx
          .update(changeoverSessionsTable)
          .set({
            qaVerifiedById: actor.id,
            qaVerifiedAt: new Date(),
            qaVerificationMethod: "manual_confirm",
            qaDiscrepancyFound: false,
            status: "qa_confirmed",
            qaLockExpiresAt: null,
          })
          .where(eq(changeoverSessionsTable.id, sessionId));

        // Count updated scans
        const [{ count: updatedCount }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(feederScansTable)
          .where(
            and(
              eq(feederScansTable.sessionId, sessionId),
              eq(feederScansTable.qaVerifiedById, actor.id),
            ),
          );

        await tx.insert(auditLogsTable).values({
          entityType: "session",
          entityId: sessionId,
          action: "qa_manual_confirm",
          changedBy: actor.id,
          newValue: JSON.stringify({ sessionId, verifiedBy: actor.id, feederCount: updatedCount }),
          description: `QA manual confirmation by ${actor.name} on session ${sessionId} — ${updatedCount} feeder(s) confirmed`,
        });
      });

      res.json({ success: true, message: "All feeders manually confirmed" });
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to confirm feeders" });
    }
  },
);

/**
 * POST /api/verification/qa-queue/:sessionId/rescan
 * QA/Engineer re-scans an individual feeder slot.
 */
router.post(
  "/verification/qa-queue/:sessionId/rescan",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const sessionId = String(req.params.sessionId ?? "").trim();
      const feederNumber = String(req.body?.feederNumber ?? "").trim();
      const scannedValue = String(req.body?.scannedValue ?? "").trim();
      const actor = req.actor!;
      const isLegacy = /^\d+$/.test(sessionId);

      if (!sessionId || !feederNumber || !scannedValue) {
        res.status(400).json({ error: "sessionId, feederNumber, and scannedValue are required" });
        return;
      }

      let session: { id: string | number; bomId: number; status: string };

      if (isLegacy) {
        const numericId = Number(sessionId);
        const [legacySession] = await db
          .select({
            id: sessionsTable.id,
            bomId: sessionsTable.bomId,
            status: sessionsTable.status,
          })
          .from(sessionsTable)
          .where(and(eq(sessionsTable.id, numericId), isNull(sessionsTable.deletedAt)));

        if (!legacySession) {
          res.status(404).json({ error: "Session not found" });
          return;
        }

        session = {
          id: legacySession.id,
          bomId: legacySession.bomId ?? 0,
          status: legacySession.status,
        };
      } else {
        const [coSession] = await db
          .select({
            id: changeoverSessionsTable.id,
            bomId: changeoverSessionsTable.bomId,
            status: changeoverSessionsTable.status,
          })
          .from(changeoverSessionsTable)
          .where(eq(changeoverSessionsTable.id, sessionId));

        if (!coSession) {
          res.status(404).json({ error: "Session not found" });
          return;
        }

        session = coSession;
      }

      // Get BOM item for this feeder
      const [bomItem] = await db
        .select({
          mpn1: bomItemsTable.mpn1,
          mpn2: bomItemsTable.mpn2,
          mpn3: bomItemsTable.mpn3,
          make1: bomItemsTable.make1,
          make2: bomItemsTable.make2,
          make3: bomItemsTable.make3,
          internalPartNumber: bomItemsTable.internalPartNumber,
          componentId: bomItemsTable.componentId,
        })
        .from(bomItemsTable)
        .where(
          and(
            eq(bomItemsTable.bomId, session.bomId),
            eq(bomItemsTable.feederNumber, feederNumber),
          ),
        );

      if (!bomItem) {
        res.status(404).json({ error: "Feeder not found in BOM" });
        return;
      }

      // Check MPN match (including alternates on mpn2/mpn3)
      const scanned = scannedValue.trim().toUpperCase();
      const mpn1 = bomItem.mpn1?.trim().toUpperCase() ?? "";
      const mpn2 = bomItem.mpn2?.trim().toUpperCase() ?? "";
      const mpn3 = bomItem.mpn3?.trim().toUpperCase() ?? "";

      let qaResult: "pass" | "fail" | "alternate_accepted";
      let matchedField: string | null = null;

      if (mpn1 && scanned === mpn1) {
        qaResult = "pass";
        matchedField = "mpn1";
      } else if (mpn2 && scanned === mpn2) {
        qaResult = "alternate_accepted";
        matchedField = "mpn2";
      } else if (mpn3 && scanned === mpn3) {
        qaResult = "alternate_accepted";
        matchedField = "mpn3";
      } else if (bomItem.componentId) {
        // Check component_alternates table for approved substitutes
        const [{ count: altCount }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(componentAlternatesTable)
          .innerJoin(
            componentsTable,
            eq(componentAlternatesTable.alternateComponentId, componentsTable.id),
          )
          .where(
            and(
              eq(componentAlternatesTable.primaryComponentId, bomItem.componentId),
              eq(componentsTable.mpn, scannedValue),
              eq(componentAlternatesTable.approvalStatus, "approved"),
            ),
          );

        if (altCount > 0) {
          qaResult = "alternate_accepted";
          matchedField = "approved_alternate";
        } else {
          qaResult = "fail";
        }
      } else {
        qaResult = "fail";
      }

      const now = new Date();
      let updatedScan: any;

      if (isLegacy) {
        const numericId = Number(sessionId);
        const [uScan] = await db
          .update(scanRecordsTable)
          .set({
            status: qaResult === "fail" ? "reject" : "ok",
            validationResult: qaResult === "pass" ? "pass" : (qaResult === "alternate_accepted" ? "alternate_pass" : "mismatch"),
          })
          .where(
            and(
              eq(scanRecordsTable.sessionId, numericId),
              eq(scanRecordsTable.feederNumber, feederNumber),
            ),
          )
          .returning();
        updatedScan = uScan;
      } else {
        const [uScan] = await db
          .update(feederScansTable)
          .set({
            qaResult,
            qaVerifiedById: actor.id,
            qaVerifiedAt: now,
            qaNotes: qaResult === "fail" ? String(req.body?.notes ?? "") : null,
          })
          .where(
            and(
              eq(feederScansTable.sessionId, sessionId),
              eq(feederScansTable.feederNumber, feederNumber),
            ),
          )
          .returning();
        updatedScan = uScan;

        // If fail, flag discrepancy on session
        if (qaResult === "fail") {
          await db
            .update(changeoverSessionsTable)
            .set({ qaDiscrepancyFound: true })
            .where(eq(changeoverSessionsTable.id, sessionId));
        }
      }

      await db.insert(auditLogsTable).values({
        entityType: "scan",
        entityId: `${sessionId}:${feederNumber}`,
        action: "qa_rescan",
        changedBy: actor.id,
        newValue: JSON.stringify({ sessionId, feederNumber, scannedValue, qaResult, matchedField }),
        description: `QA re-scan: feeder ${feederNumber} → ${qaResult} by ${actor.name}`,
      });

      res.json({
        success: true,
        qaResult,
        matchedField,
        feederNumber,
        scannedValue,
        updatedScan,
      });
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to process QA re-scan" });
    }
  },
);

/**
 * POST /api/verification/qa-queue/:sessionId/complete
 * Complete QA review. If discrepancies exist, status becomes qa_confirmed.
 */
router.post(
  "/verification/qa-queue/:sessionId/complete",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const sessionId = String(req.params.sessionId ?? "").trim();
      const actor = req.actor!;
      const isLegacy = /^\d+$/.test(sessionId);

      if (isLegacy) {
        const numericId = Number(sessionId);
        const [session] = await db
          .select({
            id: sessionsTable.id,
            status: sessionsTable.status,
          })
          .from(sessionsTable)
          .where(and(eq(sessionsTable.id, numericId), isNull(sessionsTable.deletedAt)));

        if (!session) {
          res.status(404).json({ error: "Session not found" });
          return;
        }

        await db.transaction(async (tx) => {
          await tx
            .update(sessionsTable)
            .set({
              status: "qa_confirmed",
              qaName: actor.name,
            })
            .where(eq(sessionsTable.id, numericId));

          await tx.insert(auditLogsTable).values({
            entityType: "session",
            entityId: sessionId,
            action: "qa_review_complete",
            changedBy: actor.id,
            newValue: JSON.stringify({ sessionId, qaVerifiedBy: actor.id }),
            description: `QA review completed by ${actor.name} on legacy session ${sessionId}`,
          });
        });

        res.json({
          success: true,
          status: "qa_confirmed",
          discrepancyFound: false,
        });
        return;
      }

      const [session] = await db
        .select({
          id: changeoverSessionsTable.id,
          qaDiscrepancyFound: changeoverSessionsTable.qaDiscrepancyFound,
        })
        .from(changeoverSessionsTable)
        .where(eq(changeoverSessionsTable.id, sessionId));

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      // Part C1: block qa_confirmed unless every BOM feeder has a verified scan.
      const progress = await getSessionProgress(sessionId);
      const requiredCount = Math.max(progress.total, 1);
      if (progress.verified < requiredCount) {
        res.status(409).json({
          error: "QA 200 verification failed",
          verified_count: progress.verified,
          required_count: requiredCount,
        });
        return;
      }

      // Part C3: block confirmation while any splice is still unverified.
      const unverifiedSplices = await countUnverifiedSplices(sessionId);
      if (unverifiedSplices > 0) {
        rejectUnverifiedSplices(res, unverifiedSplices);
        return;
      }

      await db.transaction(async (tx) => {
        await tx
          .update(changeoverSessionsTable)
          .set({
            status: "qa_confirmed",
            qaVerifiedById: actor.id,
            qaVerifiedAt: new Date(),
            qaLockExpiresAt: null,
          })
          .where(eq(changeoverSessionsTable.id, sessionId));

        await tx.insert(auditLogsTable).values({
          entityType: "session",
          entityId: sessionId,
          action: "qa_review_complete",
          changedBy: actor.id,
          newValue: JSON.stringify({
            sessionId,
            qaVerifiedBy: actor.id,
            discrepancyFound: session.qaDiscrepancyFound,
          }),
          description: `QA review completed by ${actor.name} on session ${sessionId}${
            session.qaDiscrepancyFound ? " (discrepancies found)" : ""
          }`,
        });
      });

      res.json({
        success: true,
        status: "qa_confirmed",
        discrepancyFound: session.qaDiscrepancyFound,
      });
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to complete QA review" });
    }
  },
);

/**
 * POST /api/verification/sessions/:sessionId/mark-incomplete
 * Mark a session as incomplete (sets status to "incomplete", releases QA lock).
 */
router.post(
  "/verification/sessions/:sessionId/mark-incomplete",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const sessionId = String(req.params.sessionId ?? "").trim();
      const actor = req.actor!;

      const [session] = await db
        .select({ id: changeoverSessionsTable.id })
        .from(changeoverSessionsTable)
        .where(eq(changeoverSessionsTable.id, sessionId));

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      await db.transaction(async (tx) => {
        await tx
          .update(changeoverSessionsTable)
          .set({
            status: "incomplete",
            qaLockExpiresAt: null,
          })
          .where(eq(changeoverSessionsTable.id, sessionId));

        await tx.insert(auditLogsTable).values({
          entityType: "session",
          entityId: sessionId,
          action: "session_marked_incomplete",
          changedBy: actor.id,
          newValue: JSON.stringify({ sessionId, markedBy: actor.id }),
          description: `Session ${sessionId} marked as incomplete by ${actor.name}`,
        });
      });

      res.json({ success: true });
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to mark session as incomplete" });
    }
  },
);

/**
 * GET /api/verification/qa-queue/:sessionId/discrepancy
 * Returns discrepancy report for a session.
 */
router.get(
  "/verification/qa-queue/:sessionId/discrepancy",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const sessionId = String(req.params.sessionId ?? "").trim();

      const [session] = await db
        .select({
          id: changeoverSessionsTable.id,
          operatorId: changeoverSessionsTable.operatorId,
          bomId: changeoverSessionsTable.bomId,
          qaDiscrepancyFound: changeoverSessionsTable.qaDiscrepancyFound,
          qaVerifiedById: changeoverSessionsTable.qaVerifiedById,
          qaVerifiedAt: changeoverSessionsTable.qaVerifiedAt,
        })
        .from(changeoverSessionsTable)
        .where(eq(changeoverSessionsTable.id, sessionId));

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      // Find failed QA scans
      const failedScans = await db
        .select({
          feederNumber: feederScansTable.feederNumber,
          scannedValue: feederScansTable.scannedValue,
          matchedField: feederScansTable.matchedField,
          qaResult: feederScansTable.qaResult,
          qaNotes: feederScansTable.qaNotes,
          qaVerifiedById: feederScansTable.qaVerifiedById,
          qaVerifiedAt: feederScansTable.qaVerifiedAt,
        })
        .from(feederScansTable)
        .where(
          and(
            eq(feederScansTable.sessionId, sessionId),
            eq(feederScansTable.qaResult, "fail"),
          ),
        );

      // Get BOM expected values for failed scans
      const feederNumbers = failedScans.map((s) => s.feederNumber);
      const bomItems = feederNumbers.length > 0
        ? await db
            .select({
              feederNumber: bomItemsTable.feederNumber,
              mpn1: bomItemsTable.mpn1,
              mpn2: bomItemsTable.mpn2,
              mpn3: bomItemsTable.mpn3,
            })
            .from(bomItemsTable)
            .where(
              and(
                eq(bomItemsTable.bomId, session.bomId ?? -1),
                inArray(bomItemsTable.feederNumber, feederNumbers),
              ),
            )
        : [];

      const bomMap = new Map(bomItems.map((b) => [b.feederNumber, b]));
      const discrepancyItems = failedScans.map((scan) => {
        const bom = bomMap.get(scan.feederNumber);
        return {
          feederNumber: scan.feederNumber,
          expectedMpn: bom?.mpn1 ?? "",
          scannedMpn: scan.scannedValue,
          notes: scan.qaNotes ?? "",
          qaPerson: scan.qaVerifiedById,
          time: scan.qaVerifiedAt,
        };
      });

      // Get QA person name
      let qaPersonName = "";
      if (session.qaVerifiedById) {
        const [qaUser] = await db
          .select({ name: usersTable.name })
          .from(usersTable)
          .where(eq(usersTable.id, session.qaVerifiedById));
        if (qaUser) qaPersonName = qaUser.name;
      }

      res.json({
        sessionId,
        qaDiscrepancyFound: session.qaDiscrepancyFound,
        qaPerson: qaPersonName,
        qaVerifiedAt: session.qaVerifiedAt,
        discrepancyCount: discrepancyItems.length,
        items: discrepancyItems,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to load discrepancy report" });
    }
  },
);

/**
 * POST /api/verification/splices/:spliceId/approve
 * QA/Supervisor approves an individual splice record.
 */
router.post(
  "/verification/splices/:spliceId/approve",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const spliceId = String(req.params.spliceId ?? "").trim();
      const actor = req.actor!;

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(spliceId)) {
        res.status(400).json({ error: "Invalid splice ID" });
        return;
      }

      const [splice] = await db
        .select()
        .from(spliceRecordsTable)
        .where(eq(spliceRecordsTable.id, spliceId));

      if (!splice) {
        res.status(404).json({ error: "Splice not found" });
        return;
      }

      if (splice.qaResult === "pass") {
        res.json({ success: true, message: "Splice already approved" });
        return;
      }

      await db
        .update(spliceRecordsTable)
        .set({
          qaResult: "pass",
          qaVerifiedById: actor.id,
          qaVerifiedAt: new Date(),
        })
        .where(eq(spliceRecordsTable.id, spliceId));

      await db.insert(auditLogsTable).values({
        entityType: "feeder_splice",
        entityId: `splice_${spliceId}`,
        action: "splice_approved",
        changedBy: actor.id,
        oldValue: JSON.stringify({ qaResult: splice.qaResult }),
        newValue: JSON.stringify({ qaResult: "pass", approvedBy: actor.id }),
        description: `Splice ${spliceId} for feeder ${splice.feederNumber} approved by ${actor.name}`,
      });

      res.json({ success: true, message: "Splice approved" });
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to approve splice" });
    }
  },
);

/**
 * POST /api/verification/splices/:spliceId/reject
 * QA/Supervisor rejects an individual splice record.
 */
router.post(
  "/verification/splices/:spliceId/reject",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const spliceId = String(req.params.spliceId ?? "").trim();
      const notes = String(req.body?.notes ?? "").trim();
      const actor = req.actor!;

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(spliceId)) {
        res.status(400).json({ error: "Invalid splice ID" });
        return;
      }

      const [splice] = await db
        .select()
        .from(spliceRecordsTable)
        .where(eq(spliceRecordsTable.id, spliceId));

      if (!splice) {
        res.status(404).json({ error: "Splice not found" });
        return;
      }

      if (splice.qaResult === "fail") {
        res.json({ success: true, message: "Splice already rejected" });
        return;
      }

      await db
        .update(spliceRecordsTable)
        .set({
          qaResult: "fail",
          qaVerifiedById: actor.id,
          qaVerifiedAt: new Date(),
        })
        .where(eq(spliceRecordsTable.id, spliceId));

      await db.insert(auditLogsTable).values({
        entityType: "feeder_splice",
        entityId: `splice_${spliceId}`,
        action: "splice_rejected",
        changedBy: actor.id,
        oldValue: JSON.stringify({ qaResult: splice.qaResult }),
        newValue: JSON.stringify({ qaResult: "fail", rejectedBy: actor.id, notes }),
        description: `Splice ${spliceId} for feeder ${splice.feederNumber} rejected by ${actor.name}${notes ? `: ${notes}` : ""}`,
      });

      res.json({ success: true, message: "Splice rejected" });
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to reject splice" });
    }
  },
);

/**
 * GET /api/verification/sessions/:sessionId/pending-splices
 * Returns all splices pending QA approval for a session.
 */
router.get(
  "/verification/sessions/:sessionId/pending-splices",
  attachActor,
  requireRole("qa", "supervisor", "admin", "operator"),
  async (req: AuthRequest, res) => {
    try {
      const sessionId = String(req.params.sessionId ?? "").trim();

      const pendingSplices = await db
        .select()
        .from(spliceRecordsTable)
        .where(
          and(
            eq(spliceRecordsTable.changeoverId, sessionId),
            eq(spliceRecordsTable.qaResult, "pending"),
          ),
        )
        .orderBy(desc(spliceRecordsTable.splicedAt));

      res.json({ splices: pendingSplices, total: pendingSplices.length });
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to load pending splices" });
    }
  },
);

// ── SECTION 4: SHIFT HANDOVER ────────────────────────────────────────────────

/**
 * GET /api/verification/handover/operators
 * Returns a list of operators available for handover.
 */
router.get(
  "/verification/handover/operators",
  attachActor,
  requireAuth,
  async (_req: AuthRequest, res) => {
    try {
      const operators = await db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          employeeId: usersTable.employee_id,
          role: usersTable.role,
        })
        .from(usersTable)
        .where(eq(usersTable.role, "operator"))
        .orderBy(usersTable.name);

      res.json({ operators });
    } catch (err) {
      _req.log.error(err);
      res.status(500).json({ error: "Failed to load operators" });
    }
  },
);

/**
 * GET /api/verification/handover/pending
 * Returns pending handovers for the current user (as incoming operator).
 */
router.get(
  "/verification/handover/pending",
  attachActor,
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const actor = req.actor!;
      const handovers = await db
        .select({
          id: sessionHandoversTable.id,
          sessionId: sessionHandoversTable.sessionId,
          fromOperatorId: sessionHandoversTable.fromOperatorId,
          toOperatorId: sessionHandoversTable.toOperatorId,
          initiatedAt: sessionHandoversTable.initiatedAt,
          status: sessionHandoversTable.status,
          notes: sessionHandoversTable.notes,
          fromOperatorName: usersTable.name,
          sessionStatus: changeoverSessionsTable.status,
        })
        .from(sessionHandoversTable)
        .leftJoin(usersTable, eq(sessionHandoversTable.fromOperatorId, usersTable.id))
        .leftJoin(changeoverSessionsTable, eq(sessionHandoversTable.sessionId, changeoverSessionsTable.id))
        .where(
          and(
            eq(sessionHandoversTable.toOperatorId, actor.id),
            eq(sessionHandoversTable.status, "pending"),
          ),
        )
        .orderBy(desc(sessionHandoversTable.initiatedAt));

      res.json({ handovers, total: handovers.length });
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to load pending handovers" });
    }
  },
);

/**
 * POST /api/verification/handover/:sessionId
 * Initiate a shift handover.
 */
router.post(
  "/verification/handover/:sessionId",
  attachActor,
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const sessionId = String(req.params.sessionId ?? "").trim();
      const toOperatorId = String(req.body?.toOperatorId ?? "").trim();
      const toSupervisorId = String(req.body?.toSupervisorId ?? "").trim();
      const notes = String(req.body?.notes ?? "").trim();
      const actor = req.actor!;

      if (!sessionId || !toOperatorId) {
        res.status(400).json({ error: "sessionId and toOperatorId are required" });
        return;
      }

      // Verify session exists
      const [session] = await db
        .select({
          id: changeoverSessionsTable.id,
          operatorId: changeoverSessionsTable.operatorId,
          status: changeoverSessionsTable.status,
        })
        .from(changeoverSessionsTable)
        .where(eq(changeoverSessionsTable.id, sessionId));

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      // Only the session operator or a supervisor/engineer can initiate handover
      const isOperator = String(session.operatorId) === String(actor.id);
      const isSupervisor = actor.role === "supervisor" || actor.role === "qa" || actor.role === "admin";
      if (!isOperator && !isSupervisor) {
        res.status(403).json({ error: "Only the session operator or a supervisor can initiate handover" });
        return;
      }

      // Check for existing pending handover
      const [existing] = await db
        .select({ id: sessionHandoversTable.id })
        .from(sessionHandoversTable)
        .where(
          and(
            eq(sessionHandoversTable.sessionId, sessionId),
            eq(sessionHandoversTable.status, "pending"),
          ),
        );

      if (existing) {
        res.status(409).json({ error: "A pending handover already exists for this session" });
        return;
      }

      await db.transaction(async (tx) => {
        const now = new Date();
        const [handover] = await tx
          .insert(sessionHandoversTable)
          .values({
            sessionId,
            fromOperatorId: session.operatorId,
            fromSupervisorId: isOperator && toSupervisorId ? toSupervisorId : actor.id,
            toOperatorId,
            toSupervisorId: toSupervisorId || null,
            initiatedAt: now,
            status: "pending",
            notes: notes || null,
          })
          .returning();

        await tx
          .update(changeoverSessionsTable)
          .set({
            handedOverToOperatorId: toOperatorId,
            handedOverToSupervisorId: toSupervisorId || null,
            handedOverAt: now,
            status: "handed_over",
          })
          .where(eq(changeoverSessionsTable.id, sessionId));

        await tx.insert(auditLogsTable).values({
          entityType: "session",
          entityId: sessionId,
          action: "handover_initiated",
          changedBy: actor.id,
          newValue: JSON.stringify({
            sessionId,
            fromOperator: session.operatorId,
            toOperator: toOperatorId,
            toSupervisor: toSupervisorId || null,
          }),
          description: `Handover initiated from operator to ${toOperatorId} on session ${sessionId}`,
        });

        res.status(201).json(handover);
      });
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to initiate handover" });
    }
  },
);

/**
 * POST /api/verification/handover/:sessionId/accept
 * Accept a pending shift handover.
 */
router.post(
  "/verification/handover/:sessionId/accept",
  attachActor,
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const sessionId = String(req.params.sessionId ?? "").trim();
      const actor = req.actor!;

      const [handover] = await db
        .select({
          id: sessionHandoversTable.id,
          fromOperatorId: sessionHandoversTable.fromOperatorId,
          toOperatorId: sessionHandoversTable.toOperatorId,
          status: sessionHandoversTable.status,
        })
        .from(sessionHandoversTable)
        .where(
          and(
            eq(sessionHandoversTable.sessionId, sessionId),
            eq(sessionHandoversTable.status, "pending"),
          ),
        );

      if (!handover) {
        res.status(404).json({ error: "No pending handover found for this session" });
        return;
      }

      // Only the designated incoming operator can accept
      if (String(handover.toOperatorId) !== String(actor.id)) {
        res.status(403).json({ error: "Only the designated incoming operator can accept this handover" });
        return;
      }

      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(sessionHandoversTable)
          .set({
            status: "accepted",
            acceptedAt: now,
          })
          .where(eq(sessionHandoversTable.id, handover.id));

        await tx
          .update(changeoverSessionsTable)
          .set({
            handoverAcceptedAt: now,
            handoverAcceptedById: actor.id,
            splicingOperatorId: actor.id,
            status: "active_splicing",
          })
          .where(eq(changeoverSessionsTable.id, sessionId));

        await tx.insert(auditLogsTable).values({
          entityType: "session",
          entityId: sessionId,
          action: "handover_accepted",
          changedBy: actor.id,
          newValue: JSON.stringify({ sessionId, byOperator: actor.id, acceptedAt: now.toISOString() }),
          description: `Handover accepted by operator ${actor.id} on session ${sessionId}`,
        });
      });

      res.json({ success: true, message: "Handover accepted" });
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to accept handover" });
    }
  },
);

/**
 * POST /api/verification/handover/:sessionId/reject
 * Reject a pending shift handover, returning the session to the original operator.
 */
router.post(
  "/verification/handover/:sessionId/reject",
  attachActor,
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const sessionId = String(req.params.sessionId ?? "").trim();
      const actor = req.actor!;

      const [handover] = await db
        .select({
          id: sessionHandoversTable.id,
          fromOperatorId: sessionHandoversTable.fromOperatorId,
          toOperatorId: sessionHandoversTable.toOperatorId,
          status: sessionHandoversTable.status,
        })
        .from(sessionHandoversTable)
        .where(
          and(
            eq(sessionHandoversTable.sessionId, sessionId),
            eq(sessionHandoversTable.status, "pending"),
          ),
        );

      if (!handover) {
        res.status(404).json({ error: "No pending handover found for this session" });
        return;
      }

      // Only the designated incoming operator can reject
      if (String(handover.toOperatorId) !== String(actor.id)) {
        res.status(403).json({ error: "Only the designated incoming operator can reject this handover" });
        return;
      }

      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(sessionHandoversTable)
          .set({
            status: "rejected",
            acceptedAt: now,
          })
          .where(eq(sessionHandoversTable.id, handover.id));

        // Revert session to its pre-handover state
        await tx
          .update(changeoverSessionsTable)
          .set({
            handedOverToOperatorId: null,
            handedOverToSupervisorId: null,
            handedOverAt: null,
            status: "active",
          })
          .where(eq(changeoverSessionsTable.id, sessionId));

        await tx.insert(auditLogsTable).values({
          entityType: "session",
          entityId: sessionId,
          action: "handover_rejected",
          changedBy: actor.id,
          newValue: JSON.stringify({ sessionId, byOperator: actor.id, rejectedAt: now.toISOString() }),
          description: `Handover rejected by operator ${actor.id} on session ${sessionId}`,
        });
      });

      res.json({ success: true, message: "Handover rejected" });
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to reject handover" });
    }
  },
);

export default router;