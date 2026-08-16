
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sessionsTable, scanRecordsTable, spliceRecordsTable, bomItemsTable, bomsTable, auditLogsTable, usersTable, type BomItem } from "@workspace/db/schema";
import { eq, and, sql, desc, isNull, isNotNull, count, inArray } from "drizzle-orm";
import { z } from "zod";
import { attachActor, requireRole, requireAuth, type AuthRequest } from "../middleware/auth";
import { scanLimiter } from "../middleware/rateLimiters";
import { auditLog } from "../lib/auditLogger";
import { isUniqueViolation } from "../lib/dbErrors";
import { TimestampService } from "../services/timestamp-service";
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const router: IRouter = Router();

router.use(attachActor);

type BomRowForMPN = {
  internalPartNumber?: string | null;
  mpn1?: string | null;
  mpn2?: string | null;
  mpn3?: string | null;
  mpn4?: string | null;
  mpn5?: string | null;
  mpn6?: string | null;
  mpn7?: string | null;
  mpn8?: string | null;
  make1?: string | null;
  make2?: string | null;
  make3?: string | null;
  make4?: string | null;
  make5?: string | null;
  make6?: string | null;
  make7?: string | null;
  make8?: string | null;
};

type MatchResult = {
  matchedField: "internalPartNumber" | "mpn1" | "mpn2" | "mpn3" | "mpn4" | "mpn5" | "mpn6" | "mpn7" | "mpn8";
  matchedMake: string | null;
} | null;

type SpliceMatch = {
  matchedField: "mpn1" | "mpn2" | "mpn3" | "mpn4" | "mpn5" | "mpn6" | "mpn7" | "mpn8" | "internalPartNumber";
  matchedAs: string;
  matchedMake: string;
  status: "verified" | "alternate";
};

type SpliceAuditPayload = {
  feederNumber: string;
  scannedValue: string;
  matchedAs: string;
  matchedField: string;
  lotCode: string | null;
  status: "verified" | "alternate" | "failed";
  verificationMode: string;
  operatorId: number | string;
  splicedAt: string;
};

function normalizeExact(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (["", "N/A", "NA", "-", "NONE"].includes(normalized)) {
    return "";
  }
  return normalized;
}

function tokenizeInternalPartNumber(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(/\s+/)
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);
}

function verifyMPN(scanned: string, bomRow: BomRowForMPN): MatchResult {
  const s = scanned.trim().toUpperCase();

  const internalTokens = tokenizeInternalPartNumber(bomRow.internalPartNumber);
  if (internalTokens.includes(s)) {
    return { matchedField: "internalPartNumber", matchedMake: null };
  }

  // Also accept the full normalized internalPartNumber string itself
  // (in addition to the individual tokens) so scanning the entire
  // multi-word value (e.g. "RDSCAP0353 RDSCAP0312 YAGEO") matches.
  const fullInternalId = normalizeExact(bomRow.internalPartNumber);
  if (fullInternalId && fullInternalId === s) {
    return { matchedField: "internalPartNumber", matchedMake: null };
  }

  if (normalizeExact(bomRow.mpn1) === s) {
    return { matchedField: "mpn1", matchedMake: bomRow.make1 ?? null };
  }

  if (normalizeExact(bomRow.mpn2) === s) {
    return { matchedField: "mpn2", matchedMake: bomRow.make2 ?? null };
  }

  if (normalizeExact(bomRow.mpn3) === s) {
    return { matchedField: "mpn3", matchedMake: bomRow.make3 ?? null };
  }

  if (normalizeExact(bomRow.mpn4) === s) {
    return { matchedField: "mpn4", matchedMake: bomRow.make4 ?? null };
  }

  if (normalizeExact(bomRow.mpn5) === s) {
    return { matchedField: "mpn5", matchedMake: bomRow.make5 ?? null };
  }

  if (normalizeExact(bomRow.mpn6) === s) {
    return { matchedField: "mpn6", matchedMake: bomRow.make6 ?? null };
  }

  if (normalizeExact(bomRow.mpn7) === s) {
    return { matchedField: "mpn7", matchedMake: bomRow.make7 ?? null };
  }

  if (normalizeExact(bomRow.mpn8) === s) {
    return { matchedField: "mpn8", matchedMake: bomRow.make8 ?? null };
  }

  return null;
}

function verifySpliceMpn(scanned: string, bomRow: BomRowForMPN): SpliceMatch | null {
  const s = normalizeExact(scanned);

  const mpn1 = normalizeExact(bomRow.mpn1);
  if (mpn1 && mpn1 === s) {
    return {
      matchedField: "mpn1",
      matchedAs: `MPN 1${bomRow.make1 ? ` (${bomRow.make1})` : ""}`,
      matchedMake: bomRow.make1 ?? "",
      status: "verified",
    };
  }

  const mpn2 = normalizeExact(bomRow.mpn2);
  if (mpn2 && mpn2 === s) {
    return {
      matchedField: "mpn2",
      matchedAs: `MPN 2${bomRow.make2 ? ` (${bomRow.make2})` : ""}`,
      matchedMake: bomRow.make2 ?? "",
      status: "alternate",
    };
  }

  const mpn3 = normalizeExact(bomRow.mpn3);
  if (mpn3 && mpn3 === s) {
    return {
      matchedField: "mpn3",
      matchedAs: `MPN 3${bomRow.make3 ? ` (${bomRow.make3})` : ""}`,
      matchedMake: bomRow.make3 ?? "",
      status: "alternate",
    };
  }

  const mpn4 = normalizeExact(bomRow.mpn4);
  if (mpn4 && mpn4 === s) {
    return {
      matchedField: "mpn4",
      matchedAs: `MPN 4${bomRow.make4 ? ` (${bomRow.make4})` : ""}`,
      matchedMake: bomRow.make4 ?? "",
      status: "alternate",
    };
  }

  const mpn5 = normalizeExact(bomRow.mpn5);
  if (mpn5 && mpn5 === s) {
    return {
      matchedField: "mpn5",
      matchedAs: `MPN 5${bomRow.make5 ? ` (${bomRow.make5})` : ""}`,
      matchedMake: bomRow.make5 ?? "",
      status: "alternate",
    };
  }

  const mpn6 = normalizeExact(bomRow.mpn6);
  if (mpn6 && mpn6 === s) {
    return {
      matchedField: "mpn6",
      matchedAs: `MPN 6${bomRow.make6 ? ` (${bomRow.make6})` : ""}`,
      matchedMake: bomRow.make6 ?? "",
      status: "alternate",
    };
  }

  const mpn7 = normalizeExact(bomRow.mpn7);
  if (mpn7 && mpn7 === s) {
    return {
      matchedField: "mpn7",
      matchedAs: `MPN 7${bomRow.make7 ? ` (${bomRow.make7})` : ""}`,
      matchedMake: bomRow.make7 ?? "",
      status: "alternate",
    };
  }

  const mpn8 = normalizeExact(bomRow.mpn8);
  if (mpn8 && mpn8 === s) {
    return {
      matchedField: "mpn8",
      matchedAs: `MPN 8${bomRow.make8 ? ` (${bomRow.make8})` : ""}`,
      matchedMake: bomRow.make8 ?? "",
      status: "alternate",
    };
  }

  const tokens = tokenizeInternalPartNumber(bomRow.internalPartNumber);
  if (tokens.includes(s)) {
    return {
      matchedField: "internalPartNumber",
      matchedAs: "Internal ID",
      matchedMake: "",
      status: "alternate",
    };
  }

  // Also accept the full normalized internalPartNumber string itself
  // (in addition to the individual tokens) so scanning the entire
  // multi-word value (e.g. "RDSCAP0353 RDSCAP0312 YAGEO") matches.
  const fullInternalId = normalizeExact(bomRow.internalPartNumber);
  if (fullInternalId && fullInternalId === s) {
    return {
      matchedField: "internalPartNumber",
      matchedAs: "Internal ID",
      matchedMake: "",
      status: "alternate",
    };
  }

  return null;
}

function buildExpectedMpnValues(bomRow: BomRowForMPN): string[] {
  const values = [
    ...tokenizeInternalPartNumber(bomRow.internalPartNumber),
    normalizeExact(bomRow.mpn1),
    normalizeExact(bomRow.mpn2),
    normalizeExact(bomRow.mpn3),
    normalizeExact(bomRow.mpn4),
    normalizeExact(bomRow.mpn5),
    normalizeExact(bomRow.mpn6),
    normalizeExact(bomRow.mpn7),
    normalizeExact(bomRow.mpn8),
  ].filter(Boolean);

  return Array.from(new Set(values));
}

function parseSpliceAuditPayload(value: string | null | undefined): SpliceAuditPayload | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<SpliceAuditPayload>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return {
      feederNumber: String(parsed.feederNumber ?? ""),
      scannedValue: String(parsed.scannedValue ?? ""),
      matchedAs: String(parsed.matchedAs ?? ""),
      matchedField: String(parsed.matchedField ?? ""),
      lotCode: parsed.lotCode != null ? String(parsed.lotCode) : null,
      status: parsed.status === "verified" || parsed.status === "alternate" ? parsed.status : "failed",
      verificationMode: String(parsed.verificationMode ?? "AUTO"),
      operatorId: parsed.operatorId ?? "",
      splicedAt: String(parsed.splicedAt ?? ""),
    };
  } catch {
    return null;
  }
}

async function safeListSpliceRecords(changeoverId: string) {
  try {
    return await db.select().from(spliceRecordsTable).where(eq(spliceRecordsTable.changeoverId, changeoverId)).orderBy(spliceRecordsTable.splicedAt);
  } catch (error) {
    console.error({ error, changeoverId }, "Failed to query splice records");
    return []; // Return empty array on schema/query errors
  }
}

function buildSpliceResponse(
  splice: any,
  bomItem: any,
  payload: SpliceAuditPayload | null,
) {
    const matchedField = payload?.matchedField ?? normalizeExact(splice.oldSpoolBarcode) ?? null;
  const matchedAs = payload?.matchedAs ?? splice.oldSpoolBarcode ?? "";
  const scannedValue = payload?.scannedValue ?? splice.newSpoolBarcode ?? "";
  const lotCode = payload?.lotCode ?? null;
  const status = payload?.status ?? (matchedField === "mpn1" ? "verified" : matchedField ? "alternate" : "failed");
  const verificationMode = payload?.verificationMode ?? "AUTO";

  return {
    ...splice,
    bomItem,
    expectedMpns: bomItem
      ? [bomItem.mpn1, bomItem.mpn2, bomItem.mpn3, bomItem.mpn4, bomItem.mpn5, bomItem.mpn6, bomItem.mpn7, bomItem.mpn8].map((value: string | null | undefined) => normalizeExact(value)).filter(Boolean)
      : [],
    scannedValue,
    matchedAs,
    matchedField,
    lotCode,
    status,
    verificationMode,
  };
}

function formatMatchedAs(matchedField: string | null | undefined, matchedMake: string | null | undefined): string {
  const field = String(matchedField ?? "").toLowerCase();
  if (field === "mpn1") return `MPN 1${matchedMake ? ` (${matchedMake})` : ""}`;
  if (field === "mpn2") return `MPN 2${matchedMake ? ` (${matchedMake})` : ""}`;
  if (field === "mpn3") return `MPN 3${matchedMake ? ` (${matchedMake})` : ""}`;
  if (field === "mpn4") return `MPN 4${matchedMake ? ` (${matchedMake})` : ""}`;
  if (field === "mpn5") return `MPN 5${matchedMake ? ` (${matchedMake})` : ""}`;
  if (field === "mpn6") return `MPN 6${matchedMake ? ` (${matchedMake})` : ""}`;
  if (field === "mpn7") return `MPN 7${matchedMake ? ` (${matchedMake})` : ""}`;
  if (field === "mpn8") return `MPN 8${matchedMake ? ` (${matchedMake})` : ""}`;
  if (field === "internalpartnumber") return "Internal P/N";
  return "—";
}

type SessionReportPayload = {
  session: {
    id: number;
    startedAt: string | Date | null;
    completedAt: string | Date | null;
    status: string | null;
    verificationMode: string | null;
    panelId: string | null;
    shift: string | null;
    customer: string | null;
    machine: string | null;
    pcbPartNumber: string | null;
    line: string | null;
    bomVersion: string | null;
    operatorName: string | null;
    qaName: string | null;
    supervisorName: string | null;
    qaVerificationMethod: string | null;
    durationMinutes: number;
  };
  summary: {
    sessionId: number;
    totalBomItems: number;
    scannedCount: number;
    okCount: number;
    rejectCount: number;
    warningCount: number;
    missingCount: number;
    completionPercent: number;
    durationMinutes: number;
  };
  reportRows: any[];
};

async function buildSessionReportPayload(sessionId: number): Promise<SessionReportPayload | null> {
  const changeoverJoinResult = await db.execute(sql`
      SELECT
        cs.id,
        cs.started_at AS "startedAt",
        cs.completed_at AS "completedAt",
        cs.status,
        COALESCE(to_jsonb(cs)->>'verification_mode', 'manual') AS "verificationMode",
        COALESCE(to_jsonb(cs)->>'qa_verification_method', '—') AS "qaVerificationMethod",
        COALESCE(to_jsonb(bh)->>'panel_id', bh.name) AS "panelId",
        to_jsonb(bh)->>'shift' AS shift,
        to_jsonb(bh)->>'customer' AS customer,
        to_jsonb(bh)->>'machine' AS machine,
        COALESCE(to_jsonb(bh)->>'pcb_part_number', to_jsonb(bh)->>'pcbPartNumber') AS "pcbPartNumber",
        to_jsonb(bh)->>'line' AS line,
        COALESCE(to_jsonb(bh)->>'bom_version', bh.name) AS "bomVersion",
        operator_user.name AS "operatorName",
        qa_user.name AS "qaName",
        supervisor_user.name AS "supervisorName",
        fs.feeder_number AS "feederNumber",
        fs.scanned_value AS "scannedValue",
        fs.matched_field AS "matchedField",
        fs.matched_make AS "matchedMake",
        fs.lot_code AS "lotCode",
        fs.status::text AS "scanStatus",
        fs.scanned_at AS "scannedAt",
        bi.reference_location AS "referenceLocation",
        bi.description,
        bi.values AS "value",
        bi.package_description AS "packageDescription",
        bi.package_description AS "packageType",
        bi.internal_part_number AS "internalPartNumber",
        bi.make_1 AS make1,
        bi.mpn_1 AS mpn1,
        bi.make_2 AS make2,
        bi.mpn_2 AS mpn2,
        bi.make_3 AS make3,
        bi.mpn_3 AS mpn3,
        bi.make_4 AS make4,
        bi.mpn_4 AS mpn4,
        bi.make_5 AS make5,
        bi.mpn_5 AS mpn5,
        bi.make_6 AS make6,
        bi.mpn_6 AS mpn6,
        bi.make_7 AS make7,
        bi.mpn_7 AS mpn7,
        bi.make_8 AS make8,
        bi.mpn_8 AS mpn8,
        bi.quantity
      FROM changeover_sessions cs
      LEFT JOIN boms bh ON cs.bom_id = bh.id
      LEFT JOIN users operator_user ON operator_user.id = (cs.operator_id::text)::uuid
      LEFT JOIN users qa_user ON qa_user.id = NULLIF(to_jsonb(cs)->>'qa_id', '')::uuid
      LEFT JOIN users supervisor_user ON supervisor_user.id = NULLIF(to_jsonb(cs)->>'supervisor_id', '')::uuid
      LEFT JOIN feeder_scans fs ON fs.session_id = cs.id
      LEFT JOIN bom_items bi ON bi.feeder_number = fs.feeder_number AND bi.bom_id = cs.bom_id
      WHERE cs.id = ${sessionId}
      ORDER BY fs.scanned_at ASC NULLS LAST
    `);

  const joinedRows: any[] = Array.isArray(changeoverJoinResult?.rows)
    ? changeoverJoinResult.rows
    : (Array.isArray(changeoverJoinResult) ? changeoverJoinResult : []);

  if (joinedRows.length > 0) {
    const first = joinedRows[0];
    const scansOnly = joinedRows
      .filter((r) => r.feederNumber != null)
      .map((r) => {
        const normalizedScanStatus = String(r.scanStatus ?? "").toLowerCase();
        const status = normalizedScanStatus === "verified"
          ? "verified"
          : normalizedScanStatus === "failed"
            ? "failed"
            : "missing";

        return {
          ...r,
          status,
          matchedAs: formatMatchedAs(r.matchedField, r.matchedMake),
          verificationMode: r.verificationMode,
          packageType: r.packageType ?? r.packageDescription ?? null,
        };
      });
    const passCount = scansOnly.filter((r) => String(r.scanStatus).toLowerCase() === "verified").length;
    const failCount = scansOnly.filter((r) => String(r.scanStatus).toLowerCase() === "failed").length;
    const warnCount = scansOnly.filter((r) => String(r.scanStatus).toLowerCase() === "duplicate").length;
    const durationMinutes = first.completedAt
      ? Math.round((new Date(first.completedAt).getTime() - new Date(first.startedAt).getTime()) / 60000)
      : 0;

    const payload: SessionReportPayload = {
      session: {
        id: first.id,
        startedAt: first.startedAt,
        completedAt: first.completedAt,
        status: first.status,
        verificationMode: first.verificationMode,
        panelId: first.panelId,
        shift: first.shift,
        customer: first.customer,
        machine: first.machine,
        pcbPartNumber: first.pcbPartNumber,
        line: first.line,
        bomVersion: first.bomVersion,
        operatorName: first.operatorName,
        qaName: first.qaName,
        supervisorName: first.supervisorName,
        qaVerificationMethod: first.qaVerificationMethod ?? null,
        durationMinutes,
      },
      summary: {
        sessionId,
        totalBomItems: scansOnly.length,
        scannedCount: scansOnly.length,
        okCount: passCount,
        rejectCount: failCount,
        warningCount: warnCount,
        missingCount: 0,
        completionPercent: scansOnly.length > 0 ? Math.round((passCount / scansOnly.length) * 100) : 0,
        durationMinutes,
      },
      reportRows: scansOnly,
    };

    // Enrich with machine/line from sessions table if missing
    if (!first.machine || !first.line) {
      const [sessionEnrich] = await db
        .select({ machineName: sessionsTable.machineName, lineName: sessionsTable.lineName })
        .from(sessionsTable)
        .where(eq(sessionsTable.id, sessionId));
      if (sessionEnrich) {
        payload.session.machine ??= sessionEnrich.machineName;
        payload.session.line ??= sessionEnrich.lineName;
      }
    }
    return payload;
  }

  const sessions = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  const [session] = sessions;
  if (!session) return null;

  const scans = await db
    .select()
    .from(scanRecordsTable)
    .where(eq(scanRecordsTable.sessionId, sessionId))
    .orderBy(scanRecordsTable.scannedAt);
  const bomItems = session.bomId
    ? await db
        .select()
        .from(bomItemsTable)
        .where(
          and(
            eq(bomItemsTable.bomId, session.bomId),
            isNull(bomItemsTable.deletedAt),
            sql`COALESCE(${bomItemsTable.isDeleted}, FALSE) = FALSE`,
          ),
        )
    : [];
  const [bom] = session.bomId
    ? await db.select().from(bomsTable).where(eq(bomsTable.id, session.bomId))
    : [null];

  const totalBomItems = bomItems.length;
  const okCount = scans.filter((s) => s.status === "ok").length;
  const rejectCount = scans.filter((s) => s.status === "reject").length;
  const scannedFeederNumbers = new Set(scans.filter((s) => s.status === "ok").map((s) => s.feederNumber.trim().toLowerCase()));
  const missingCount = bomItems.filter((item) => !scannedFeederNumbers.has(item.feederNumber.trim().toLowerCase())).length;
  const completionPercent = totalBomItems > 0 ? Math.round((okCount / totalBomItems) * 100) : 0;
  const start = new Date(session.startTime);
  const end = session.endTime ? new Date(session.endTime) : new Date();
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

  const reportRows = bomItems.map((item: any) => {
    const feederScan = scans.find((s: any) => s.feederNumber?.trim()?.toUpperCase() === item.feederNumber?.trim()?.toUpperCase());
    
    // Determine scanned value and matched field
    const scannedVal = feederScan?.spoolBarcode ?? feederScan?.internalIdScanned ?? feederScan?.scannedMpn ?? null;
    
    // Match the scanned value against BOM MPNs to determine matched field and make
    let matchedField: "internalPartNumber" | "mpn1" | "mpn2" | "mpn3" | "mpn4" | "mpn5" | "mpn6" | "mpn7" | "mpn8" | null = null;
    let matchedMake: string | null = null;
    
    if (scannedVal && feederScan?.status === "ok") {
      const normalizedScanned = String(scannedVal).trim().toUpperCase();
      
      // Check internal part number
      if (item.internalPartNumber) {
        const internalTokens = String(item.internalPartNumber)
          .split(/\s+/)
          .map((t: string) => t.trim().toUpperCase())
          .filter(Boolean);
        if (internalTokens.includes(normalizedScanned)) {
          matchedField = "internalPartNumber";
          matchedMake = null;
        }
      }
      
      // Check MPN1 (primary)
      if (!matchedField && item.mpn1 && String(item.mpn1).trim().toUpperCase() === normalizedScanned) {
        matchedField = "mpn1";
        matchedMake = item.make1 ?? null;
      }
      
      // Check MPN2 (alternate)
      if (!matchedField && item.mpn2 && String(item.mpn2).trim().toUpperCase() === normalizedScanned) {
        matchedField = "mpn2";
        matchedMake = item.make2 ?? null;
      }
      
      // Check MPN3 (alternate)
      if (!matchedField && item.mpn3 && String(item.mpn3).trim().toUpperCase() === normalizedScanned) {
        matchedField = "mpn3";
        matchedMake = item.make3 ?? null;
      }

      // Check MPN4 (alternate)
      if (!matchedField && item.mpn4 && String(item.mpn4).trim().toUpperCase() === normalizedScanned) {
        matchedField = "mpn4";
        matchedMake = item.make4 ?? null;
      }

      // Check MPN5 (alternate)
      if (!matchedField && item.mpn5 && String(item.mpn5).trim().toUpperCase() === normalizedScanned) {
        matchedField = "mpn5";
        matchedMake = item.make5 ?? null;
      }

      // Check MPN6 (alternate)
      if (!matchedField && item.mpn6 && String(item.mpn6).trim().toUpperCase() === normalizedScanned) {
        matchedField = "mpn6";
        matchedMake = item.make6 ?? null;
      }

      // Check MPN7 (alternate)
      if (!matchedField && item.mpn7 && String(item.mpn7).trim().toUpperCase() === normalizedScanned) {
        matchedField = "mpn7";
        matchedMake = item.make7 ?? null;
      }

      // Check MPN8 (alternate)
      if (!matchedField && item.mpn8 && String(item.mpn8).trim().toUpperCase() === normalizedScanned) {
        matchedField = "mpn8";
        matchedMake = item.make8 ?? null;
      }
    }
    
    return {
      id: sessionId,
      startedAt: session.startTime,
      completedAt: session.endTime,
      status: feederScan?.status === "ok" ? "verified" : feederScan?.status === "reject" ? "failed" : "missing",
      verificationMode: session.verificationMode ?? "manual",
      panelId: session.panelName,
      shift: session.shiftName,
      customer: session.customerName,
      machine: session.machineName ?? null,
      pcbPartNumber: session.panelName,
      line: session.lineName ?? null,
      bomVersion: bom?.name ?? null,
      operatorName: session.operatorName,
      qaName: session.qaName ?? null,
      supervisorName: session.supervisorName,
      feederNumber: item.feederNumber,
      scannedValue: scannedVal,
      matchedField: matchedField,
      matchedMake: matchedMake,
      matchedAs: formatMatchedAs(matchedField, matchedMake),
      lotCode: feederScan?.lotNumber ?? null,
      scanStatus: feederScan?.status === "ok" ? "verified" : feederScan?.status === "reject" ? "failed" : null,
      scannedAt: feederScan?.scannedAt ?? null,
      quantity: item.quantity,
      referenceLocation: item.referenceLocation,
      description: item.description ?? item.itemName,
      value: item.values ?? item.value ?? null,
      packageDescription: item.packageDescription,
      packageType: item.packageDescription,
      internalPartNumber: item.internalPartNumber,
      make1: item.make1,
      mpn1: item.mpn1,
      make2: item.make2,
      mpn2: item.mpn2,
      make3: item.make3,
      mpn3: item.mpn3,
      make4: item.make4,
      mpn4: item.mpn4,
      make5: item.make5,
      mpn5: item.mpn5,
      make6: item.make6,
      mpn6: item.mpn6,
      make7: item.make7,
      mpn7: item.mpn7,
      make8: item.make8,
      mpn8: item.mpn8,
    };
  });

  return {
    session: {
      id: session.id,
      startedAt: session.startTime,
      completedAt: session.endTime,
      status: session.status,
      verificationMode: session.verificationMode ?? "manual",
      panelId: session.panelName,
      shift: session.shiftName,
      customer: session.customerName,
      machine: session.machineName ?? null,
      pcbPartNumber: session.panelName,
      line: session.lineName ?? null,
      bomVersion: bom?.name ?? null,
      operatorName: session.operatorName,
      qaName: session.qaName ?? null,
      supervisorName: session.supervisorName,
      qaVerificationMethod: null,
      durationMinutes,
    },
    summary: {
      sessionId,
      totalBomItems,
      scannedCount: scans.length,
      okCount,
      rejectCount,
      warningCount: 0,
      missingCount,
      completionPercent,
      durationMinutes,
    },
    reportRows,
  };
}

// Static routes
router.get("/sessions", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    // Only show non-deleted sessions (where deletedAt is null)
    const sessions = await db
      .select()
      .from(sessionsTable)
      .where(isNull(sessionsTable.deletedAt))
      .orderBy(sessionsTable.createdAt);

    const bomIds = [...new Set(sessions.map((s) => s.bomId).filter((id): id is number => id !== null))];
    let bomMap = new Map<number, string>();
    if (bomIds.length > 0) {
      const boms = await db.select().from(bomsTable);
      bomMap = new Map(boms.map((b) => [b.id, b.name]));
    }
    const result = sessions.map((s) => ({
      ...s,
      bomName: s.bomId ? (bomMap.get(s.bomId) ?? "") : "",
    }));
    res.json(result);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    req.log.error({ error: err, message: errorMessage });
    res.status(500).json({
      error: "Failed to list sessions",
      details: errorMessage,
      type: err instanceof Error ? err.constructor.name : typeof err,
      isDrizzle: errorMessage.includes("Failed query")
    });
  }
});

router.get("/sessions/latest", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const [latest] = await db
      .select()
      .from(sessionsTable)
      .where(isNull(sessionsTable.deletedAt))
      .orderBy(desc(sessionsTable.startTime), desc(sessionsTable.id))
      .limit(1);

    if (!latest) {
      res.json({ session: null });
      return;
    }

    let bomName = "";
    if (latest.bomId) {
      const [bom] = await db.select().from(bomsTable).where(eq(bomsTable.id, latest.bomId));
      bomName = bom?.name ?? "";
    }

    res.json({
      session: {
        ...latest,
        startedAt: latest.startTime,
        bomName,
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    req.log.error({ error: err, message: errorMessage });
    res.status(500).json({
      error: "Failed to fetch latest session",
      details: errorMessage,
    });
  }
});

router.post("/sessions", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const {
      bomId, companyName, customerName, panelName, supervisorName,
      operatorName, qaName, shiftName, shiftDate, logoUrl, productionCount,
      machineName, lineName,
    } = req.body;

    // Allow bomId to be 0 (free scan) or a valid BOM ID, but not null/undefined
    if (bomId == null || !companyName || !panelName || !supervisorName || !operatorName || !shiftName || !shiftDate) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    // Convert bomId = 0 (free scan mode) to null for database storage
    const finalBomId = bomId === 0 ? null : bomId;

    // Revision lifecycle: a locked/held BOM cannot start a new verification session.
    if (finalBomId !== null) {
      const [bom] = await db
        .select({ status: bomsTable.status })
        .from(bomsTable)
        .where(eq(bomsTable.id, finalBomId));
      if (!bom) {
        res.status(404).json({ error: "BOM not found" });
        return;
      }
      if ((bom.status ?? "active") !== "active") {
        res.status(409).json({ error: "This BOM revision is locked or on hold and cannot be used for a new session." });
        return;
      }
    }

    // Use server timestamp for session creation
    const timestamps = TimestampService.createSessionTimestamps();

    const [session] = await db
      .insert(sessionsTable)
      .values({
        bomId: finalBomId, companyName, customerName, panelName, supervisorName,
        operatorName, qaName, shiftName, shiftDate, logoUrl,
        productionCount: productionCount ?? 0,
        machineName: machineName ?? null,
        lineName: lineName ?? null,
        status: "active",
        startTime: timestamps.startTime,
        createdAt: timestamps.createdAt,
      })
      .returning();

    let bomName = "";
    if (finalBomId !== null) {
      const [bom] = await db.select().from(bomsTable).where(eq(bomsTable.id, finalBomId));
      bomName = bom?.name ?? "";
    }
    res.status(201).json({ ...session, bomName });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create session" });
  }
});

// Deleted sessions route (must be before parametric routes to avoid :sessionId shadowing)
router.get("/sessions/deleted", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const deleted = await db
      .select()
      .from(sessionsTable)
      .where(isNotNull(sessionsTable.deletedAt))
      .orderBy(desc(sessionsTable.deletedAt));

    return res.json(deleted);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to fetch deleted sessions" });
  }
});

// Trash bin routes (must be before parametric routes to avoid :sessionId shadowing)
router.get("/sessions/trash/all", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const deletedSessions = await db
      .select()
      .from(sessionsTable)
      .where((sess) => sql`${sess.deletedAt} IS NOT NULL`)
      .orderBy(sessionsTable.deletedAt);

    const bomIds = [...new Set(deletedSessions.map((s) => s.bomId).filter(Boolean))];
    let bomMap = new Map<number, string>();
    if (bomIds.length > 0) {
      const boms = await db.select().from(bomsTable);
      bomMap = new Map(boms.map((b) => [b.id, b.name]));
    }

    const result = deletedSessions.map((s) => ({
      ...s,
      bomName: bomMap.get(s.bomId ?? 0) ?? "",
    }));
    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list deleted sessions" });
  }
});

router.patch("/sessions/:sessionId/recover", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = Number(req.params.sessionId);

    // Check if session exists and is deleted
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (!session.deletedAt) {
      res.status(400).json({ error: "Session is not deleted" });
      return;
    }

    // Restore: set deletedAt to null
    const [restored] = await db
      .update(sessionsTable)
      .set({ deletedAt: null })
      .where(eq(sessionsTable.id, sessionId))
      .returning();

    let bomName = "";
    if (restored && restored.bomId) {
      const [bom] = await db.select().from(bomsTable).where(eq(bomsTable.id, restored.bomId));
      bomName = bom?.name ?? "";
    }
    res.json({ ...restored, bomName });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to recover session" });
  }
});

// Catch `/active` before it falls through to parametric `:sessionId` (NaN → 500)
router.get("/sessions/active", requireAuth, async (_req: AuthRequest, res) => {
  res.json({ session: null });
});

// Parametric routes
router.get("/sessions/:sessionId", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const scans = await db.select().from(scanRecordsTable).where(eq(scanRecordsTable.sessionId, sessionId)).orderBy(scanRecordsTable.scannedAt);
    
    // Only query BOM if not in free scan mode (bomId is not NULL)
    let bomName = "";
    let bomItemCount = 0;
    if (session.bomId !== null) {
      const [bom] = await db.select().from(bomsTable).where(eq(bomsTable.id, session.bomId));
      bomName = bom?.name ?? "";
      
      const [{ count: itemCount }] = await db
        .select({ count: count() })
        .from(bomItemsTable)
        .where(and(eq(bomItemsTable.bomId, session.bomId), isNull(bomItemsTable.deletedAt)));
      bomItemCount = Number(itemCount ?? 0);
    }
    
    res.json({ ...session, bomName, bomItemCount, scans });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get session" });
  }
});

router.get("/sessions/:sessionId/scans", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    if (!Number.isFinite(sessionId)) {
      res.status(400).json({ error: "Invalid sessionId" });
      return;
    }

    const [session] = await db
      .select({ id: sessionsTable.id, bomId: sessionsTable.bomId })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId));

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const scans = await db
      .select({
        id: scanRecordsTable.id,
        feederNumber: scanRecordsTable.feederNumber,
        scannedValue: scanRecordsTable.spoolBarcode,
        internalIdScanned: scanRecordsTable.internalIdScanned,
        scannedMpn: scanRecordsTable.scannedMpn,
        matchedField: scanRecordsTable.validationResult,
        matchedMake: scanRecordsTable.description,
        lotCode: scanRecordsTable.lotNumber,
        status: scanRecordsTable.status,
        verificationMode: scanRecordsTable.verificationMode,
        scannedAt: scanRecordsTable.scannedAt,
        refDes: bomItemsTable.referenceLocation,
        componentDesc: bomItemsTable.description,
        packageSize: bomItemsTable.packageDescription,
        internalPartNumber: bomItemsTable.internalPartNumber,
        mpn1: bomItemsTable.mpn1,
        make1: bomItemsTable.make1,
        mpn2: bomItemsTable.mpn2,
        make2: bomItemsTable.make2,
        mpn3: bomItemsTable.mpn3,
        make3: bomItemsTable.make3,
        mpn4: bomItemsTable.mpn4,
        make4: bomItemsTable.make4,
        mpn5: bomItemsTable.mpn5,
        make5: bomItemsTable.make5,
        mpn6: bomItemsTable.mpn6,
        make6: bomItemsTable.make6,
        mpn7: bomItemsTable.mpn7,
        make7: bomItemsTable.make7,
        mpn8: bomItemsTable.mpn8,
        make8: bomItemsTable.make8,
      })
      .from(scanRecordsTable)
      .leftJoin(
        bomItemsTable,
        session.bomId === null
          ? sql`1 = 0`
          : and(
              eq(bomItemsTable.feederNumber, scanRecordsTable.feederNumber),
              eq(bomItemsTable.bomId, session.bomId),
              isNull(bomItemsTable.deletedAt),
              sql`COALESCE(${bomItemsTable.isDeleted}, FALSE) = FALSE`,
            ),
      )
      .where(eq(scanRecordsTable.sessionId, sessionId))
      .orderBy(desc(scanRecordsTable.scannedAt));

    res.json({
      sessionId,
      scans: scans.map((row) => ({
        id: row.id,
        feederNumber: row.feederNumber,
        scannedValue: row.scannedValue ?? row.internalIdScanned ?? row.scannedMpn ?? "—",
        matchedField: row.matchedField,
        matchedMake: row.matchedMake,
        lotCode: row.lotCode,
        status: row.status,
        verificationMode: row.verificationMode,
        scannedAt: new Date(row.scannedAt).toISOString(),
        bom: {
          refDes: row.refDes ?? null,
          componentDesc: row.componentDesc ?? null,
          packageSize: row.packageSize ?? null,
          internalPartNumber: row.internalPartNumber ?? null,
          expectedMpns: [row.internalPartNumber, row.mpn1, row.mpn2, row.mpn3, row.mpn4, row.mpn5, row.mpn6, row.mpn7, row.mpn8].filter(
            (value): value is string => Boolean(value && value.trim()),
          ),
          makes: [row.make1, row.make2, row.make3, row.make4, row.make5, row.make6, row.make7, row.make8].filter(
            (value): value is string => Boolean(value && value.trim()),
          ),
        },
      })),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list session scans" });
  }
});

router.patch("/sessions/:sessionId", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const { endTime, productionCount, status, logoUrl, verificationMode } = req.body;
    const updates: Record<string, unknown> = {};
    if (endTime !== undefined) updates.endTime = new Date(endTime);
    if (productionCount !== undefined) updates.productionCount = productionCount;
    if (status !== undefined) updates.status = status;
    if (logoUrl !== undefined) updates.logoUrl = logoUrl;
    if (verificationMode !== undefined) {
      const normalizedMode = String(verificationMode).trim().toUpperCase();
      if (!['AUTO', 'MANUAL'].includes(normalizedMode)) {
        res.status(400).json({ error: "verificationMode must be 'AUTO' or 'MANUAL'" });
        return;
      }
      updates.verificationMode = normalizedMode;
    }

    const updated = await db
      .update(sessionsTable)
      .set(updates)
      .where(eq(sessionsTable.id, sessionId))
      .returning();

    if (!updated || updated.length === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const session = updated[0];
    let bomName = "";
    if (session.bomId) {
      const [bom] = await db.select().from(bomsTable).where(eq(bomsTable.id, session.bomId));
      bomName = bom?.name ?? "";
    }
    res.json({ ...session, bomName });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update session" });
  }
});

router.patch("/sessions/:sessionId/mode", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const mode = String(req.body?.mode ?? req.body?.verificationMode ?? "").trim().toUpperCase();

    if (!Number.isFinite(sessionId)) {
      res.status(400).json({ error: "Invalid sessionId" });
      return;
    }

    if (!['AUTO', 'MANUAL'].includes(mode)) {
      res.status(400).json({ error: "mode must be 'AUTO' or 'MANUAL'" });
      return;
    }

    const [updated] = await db
      .update(sessionsTable)
      .set({ verificationMode: mode })
      .where(eq(sessionsTable.id, sessionId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json({ sessionId, mode, session: updated });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update verification mode" });
  }
});

// Utility function for case normalization
function normalizeInput(input?: string | null): string | undefined {
  return input ? input.trim().toUpperCase() : undefined;
}

function formatSmtSessionId(sourceDate: Date | string | null | undefined, sequence: number): string {
  const date = sourceDate ? new Date(sourceDate) : new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const seq = String(sequence).padStart(6, "0");
  return `SMT_${y}${m}${d}_${seq}`;
}

// TRD §5.4 — validate the scan body at route entry. Mirrors the real client
// contract (ScanFeederRequest): only feederNumber is required, the rest are
// optional. verificationMode stays a loose string because the handler
// normalizes it (upper-cases, defaults to AUTO) — an enum here would 400
// values the handler already tolerates. selectedItemId accepts number|string
// to preserve today's lenient match against the numeric bom_item id.
const ScanBodySchema = z.object({
  feederNumber: z.string().min(1, "feederNumber is required"),
  mpnOrInternalId: z.string().optional(),
  lotCode: z.string().optional(),
  internalIdType: z.string().optional(),
  verificationMode: z.string().optional(),
  spoolBarcode: z.string().optional(),
  selectedItemId: z.union([z.number(), z.string()]).optional(),
});

router.post("/sessions/:sessionId/scans", scanLimiter, requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    // === PERFORMANCE: Track validation time ===
    const validationStartTime = Date.now();
    
    const sessionId = Number(req.params.sessionId);

    const parsed = ScanBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid scan payload", details: parsed.error.flatten() });
      return;
    }
    const {
      feederNumber,
      mpnOrInternalId,
      lotCode,
      internalIdType = "mpn",
      verificationMode: requestedVerificationMode,
      spoolBarcode,
      selectedItemId,
    } = parsed.data;

    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // Auto-transition to pending_qa if all BOM feeders are scanned
    if (session.status === "active" && session.bomId) {
      try {
        const [{ count: totalItems }] = await db
          .select({ count: sql<number>`count(distinct ${bomItemsTable.feederNumber})` })
          .from(bomItemsTable)
          .where(and(eq(bomItemsTable.bomId, session.bomId), isNull(bomItemsTable.deletedAt)));
        const [{ count: scannedItems }] = await db
          .select({ count: sql<number>`count(distinct ${scanRecordsTable.feederNumber})` })
          .from(scanRecordsTable)
          .where(and(eq(scanRecordsTable.sessionId, sessionId), eq(scanRecordsTable.status, "ok")));
        const total = Number(totalItems ?? 0);
        const scanned = Number(scannedItems ?? 0);
        if (total > 0 && scanned >= total) {
          await db.update(sessionsTable).set({ status: "pending_qa" }).where(eq(sessionsTable.id, sessionId));
          session.status = "pending_qa";
          req.log.info({ sessionId }, "Legacy session auto-transitioned to pending_qa");
        }
      } catch (_e) {
        req.log.warn({ sessionId }, "Auto-transition check failed");
      }
    }

    const verificationMode = String(session.verificationMode ?? requestedVerificationMode ?? "AUTO").trim().toUpperCase() === "MANUAL"
      ? "MANUAL"
      : "AUTO";

    // === STEP 1: CASE NORMALIZATION ===
    const normalizedFeeder = normalizeInput(feederNumber);
    const normalizedMpnId = normalizeInput(mpnOrInternalId);
    const normalizedLotCode = normalizeInput(lotCode);
    const normalizedSpool = normalizeInput(spoolBarcode);

    // Track if case was converted for UI feedback
    const caseConverted = 
      (feederNumber !== normalizedFeeder) || 
      (mpnOrInternalId && mpnOrInternalId !== normalizedMpnId);

    // === STEP 2: DUPLICATE DETECTION ===
    const existingScan = await db
      .select()
      .from(scanRecordsTable)
      .where(
        and(
          eq(scanRecordsTable.sessionId, sessionId),
          eq(scanRecordsTable.feederNumber, normalizedFeeder!),
          eq(scanRecordsTable.status, "ok")
        )
      );

    if (existingScan.length > 0) {
      return res.status(400).json({
        status: "reject",
        isDuplicate: true,
        message: `⚠️ Feeder ${normalizedFeeder} already scanned`,
        validationDetails: {
          isDuplicate: true,
          feederNumberMatched: true,
          mpnMatched: false,
          internalIdMatched: false,
          caseConverted: false,
        },
      });
    }

    // === STEP 3: BOM VALIDATION ===
    const isFreeScanMode = session.bomId === null;
    let scanStatus = "ok";
    let selectedItem: BomItem | null = null;
    let primaryItems: BomItem[] = [];
    let alternateItems: BomItem[] = [];
    let message = "";
    let mpnMatched = false;
    let internalIdMatched = false;
    let verificationMatch: MatchResult = null;
    let expectedMpnValues: string[] = [];

    if (isFreeScanMode) {
      // Free Scan Mode: Accept any feeder, no BOM validation
      scanStatus = "ok";
      message = `Feeder ${normalizedFeeder} scanned (Free Scan Mode — no BOM validation)`;
    } else {
      // BOM Validation Mode: Check against BOM
      const bomItems = await db
        .select()
        .from(bomItemsTable)
        .where(
          and(
            eq(bomItemsTable.bomId, session.bomId),
            isNull(bomItemsTable.deletedAt),
            sql`COALESCE(${bomItemsTable.isDeleted}, FALSE) = FALSE`,
          ),
        );

      // Find primary item and alternates
      primaryItems = bomItems.filter(
        (item) =>
          item.feederNumber.trim().toUpperCase() === normalizedFeeder &&
          !item.isAlternate
      );

      alternateItems = bomItems.filter(
        (item) =>
          item.feederNumber.trim().toUpperCase() === normalizedFeeder &&
          item.isAlternate
      );

      // Determine which item was selected
      selectedItem = primaryItems[0];
      let usedAlternate = false;

      if (selectedItemId) {
        const specified = bomItems.find((item) => item.id === selectedItemId);
        if (specified && specified.feederNumber.trim().toUpperCase() === normalizedFeeder) {
          selectedItem = specified;
          usedAlternate = specified.isAlternate ?? false;
        }
      }

      // Step 1: Check if feeder exists in BOM
      if (!selectedItem) {
        scanStatus = "reject";
        message = `❌ FEEDER NOT FOUND: ${normalizedFeeder} NOT in BOM — REJECTED`;
      } else {
        expectedMpnValues = buildExpectedMpnValues(selectedItem);
        const hasExpectedMpn = expectedMpnValues.length > 0;
        verificationMatch = normalizedMpnId ? verifyMPN(normalizedMpnId, selectedItem) : null;

        // Step 2: Validate MPN/Internal ID using strict exact matching only
        if (normalizedMpnId) {
          mpnMatched = verificationMatch !== null;
          internalIdMatched = verificationMatch?.matchedField === "internalPartNumber";

          // Determine scan status based on mode
          if (verificationMode === "AUTO") {
            // AUTO mode: MUST match if BOM has expected value
            if (hasExpectedMpn) {
              if (!verificationMatch) {
                scanStatus = "reject";
                message = `❌ MPN mismatch for feeder ${normalizedFeeder}.\nScanned: ${normalizedMpnId}\nExpected one of: ${expectedMpnValues.join(" | ")}`;
              } else {
                scanStatus = "ok";
                message = `✅ VERIFIED (EXACT): Feeder ${normalizedFeeder} with ${internalIdType} ${normalizedMpnId} PASSED validation`;
              }
            } else {
              // BOM doesn't require validation, but user provided value - accept it
              scanStatus = "ok";
              message = `✅ Feeder ${normalizedFeeder} with ${internalIdType} ${normalizedMpnId} ACCEPTED`;
            }
          } else if (verificationMode === "MANUAL") {
            // MANUAL mode: Strict exact validation
            if (verificationMatch) {
              scanStatus = "ok";
              message = `✅ VERIFIED (EXACT): Feeder ${normalizedFeeder} with ${internalIdType} ${normalizedMpnId} PASSED`;
            } else {
              // STRICT: Reject if user provided insufficient/incorrect MPN/ID but BOM requires validation
              if (hasExpectedMpn) {
                scanStatus = "reject";
                message = `❌ MPN mismatch for feeder ${normalizedFeeder}.\nScanned: ${normalizedMpnId}\nExpected one of: ${expectedMpnValues.join(" | ")}`;
              } else {
                // BOM doesn't require validation, so accept the provided value
                scanStatus = "ok";
                message = `✅ Feeder ${normalizedFeeder} with provided ${internalIdType} '${normalizedMpnId}' ACCEPTED (no validation required in BOM)`;
              }
            }
          }
        } else {
          // No MPN/Internal ID provided - check if validation was required
          if (hasExpectedMpn) {
            // BOM requires validation but user didn't provide it
            if (verificationMode === "AUTO" || verificationMode === "MANUAL") {
              scanStatus = "reject";
              message = `❌ MPN mismatch for feeder ${normalizedFeeder}.\nScanned: ${normalizedMpnId ?? ""}\nExpected one of: ${expectedMpnValues.join(" | ")}`;
            }
          } else {
            // No expected validation in BOM for this feeder - accept as is
            scanStatus = "ok";
            message = `✅ Feeder ${normalizedFeeder} VERIFIED${usedAlternate ? " (ALTERNATE)" : ""} — No validation required`;
          }
        }
      }
    }

    // === STEP 4: SAVE TO DATABASE ===
    let scan: any;
    let idempotentRetry = false;
    try {
      // @ts-ignore - Drizzle returning type inference issue
      const inserted = await db
        .insert(scanRecordsTable)
        .values({
          sessionId,
          feederNumber: normalizedFeeder!,
          spoolBarcode: normalizedSpool ?? null,
          internalIdScanned: normalizedMpnId ?? null,
          lotNumber: normalizedLotCode ?? null,
          status: scanStatus,
          partNumber: selectedItem?.partNumber ?? null,
          description: selectedItem?.description ?? null,
          location: selectedItem?.location ?? null,
          verificationMode,
          matchScore: verificationMatch ? 100 : null,
          matchingAlgorithm: verificationMatch ? "exact" : null,
          expectedValue: expectedMpnValues.length > 0 ? expectedMpnValues.join(" | ") : null,
          suggestions: null,
          scannedAt: TimestampService.createScanTimestamp(),
        })
        .returning();
      scan = inserted[0];
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      idempotentRetry = true;
      req.log.warn(
        { sessionId, feederNumber: normalizedFeeder, spool: normalizedSpool },
        "/sessions/:id/scans idempotent retry: unique violation absorbed",
      );
      const [existing] = await db
        .select()
        .from(scanRecordsTable)
        .where(
          and(
            eq(scanRecordsTable.sessionId, sessionId),
            eq(scanRecordsTable.feederNumber, normalizedFeeder!),
          ),
        )
        .orderBy(desc(scanRecordsTable.scannedAt))
        .limit(1);
      scan = existing;
    }

    // === NEW: AUDIT LOGGING (skipped on idempotent retry) ===
    if (idempotentRetry) {
      const validationTimeMs = Date.now() - validationStartTime;
      return res.json({
        scan,
        status: scanStatus,
        isDuplicate: true,
        idempotent: true,
        caseConverted,
        message,
        validationTimeMs,
        performanceOk: validationTimeMs < 200,
        validationDetails: {
          isDuplicate: true,
          feederNumberMatched: !!selectedItem,
          mpnMatched,
          internalIdMatched,
          verificationMode,
          internalIdType,
          caseConverted,
          normalizedFeeder,
          normalizedMpnId: normalizedMpnId || null,
        },
      });
    }

    // U6 / COMMON-ERRORS Error 13 — route the scan audit row through the
    // HMAC-chained auditLog() instead of a raw insert, so it joins the
    // tamper-evident chain. The structured payload (previously stored in
    // newValue) is preserved in `detail`; changedBy is now the authenticated
    // actor's id rather than the session's free-text operator name.
    await auditLog({
      event: scanStatus === "ok" ? "SCAN_VERIFIED" : "SCAN_REJECTED",
      operatorId: req.actor?.id,
      sessionId: String(sessionId),
      ip: req.ip,
      detail: `${verificationMode} mode scan: Feeder ${normalizedFeeder} - Status: ${scanStatus === "ok" ? "PASSED" : "REJECTED"}${normalizedMpnId ? ` - ${internalIdType}: ${normalizedMpnId}` : ""} | ${JSON.stringify({
        sessionId,
        feederNumber: normalizedFeeder,
        mpnOrInternalId: normalizedMpnId || null,
        internalIdType,
        status: scanStatus,
        verificationMode,
        isDuplicate: existingScan.length > 0,
        caseConverted,
        operatorName: session.operatorName || "UNKNOWN",
      })}`,
    });

    // After-save auto-transition (catches the last scan just saved)
    if (session.bomId && session.status === "active") {
      try {
        const [{ count: totalItems }] = await db
          .select({ count: sql<number>`count(distinct ${bomItemsTable.feederNumber})` })
          .from(bomItemsTable)
          .where(and(eq(bomItemsTable.bomId, session.bomId), isNull(bomItemsTable.deletedAt)));
        const [{ count: scannedItems }] = await db
          .select({ count: sql<number>`count(distinct ${scanRecordsTable.feederNumber})` })
          .from(scanRecordsTable)
          .where(and(eq(scanRecordsTable.sessionId, sessionId), eq(scanRecordsTable.status, "ok")));
        const total = Number(totalItems ?? 0);
        const scanned = Number(scannedItems ?? 0);
        if (total > 0 && scanned >= total) {
          await db.update(sessionsTable).set({ status: "pending_qa" }).where(eq(sessionsTable.id, sessionId));
          session.status = "pending_qa";
          req.log.info({ sessionId }, "Legacy session auto-transitioned to pending_qa (after-save)");
        }
      } catch (_e) {
        req.log.warn({ sessionId }, "After-save auto-transition check failed");
      }
    }

    // === STEP 6: PREPARE RESPONSE ===
    const validationTimeMs = Date.now() - validationStartTime;
    
    res.json({
      // @ts-ignore - scan object properties
      scan,
      status: scanStatus,
      isDuplicate: existingScan.length > 0,
      caseConverted,
      message,
      validationTimeMs,
      performanceOk: validationTimeMs < 200, // Track if under 200ms threshold
      validationDetails: {
        isDuplicate: existingScan.length > 0,
        feederNumberMatched: !!selectedItem,
        mpnMatched,
        internalIdMatched,
        verificationMode,
        internalIdType,
        caseConverted,
        normalizedFeeder,
        normalizedMpnId: normalizedMpnId || null,
      },
      availableOptions: {
        primary: primaryItems.map((item) => ({
          id: item.id,
          mpn: item.mpn,
          partNumber: item.partNumber,
          manufacturer: item.manufacturer,
          packageSize: item.packageSize,
          cost: item.cost,
          leadTime: item.leadTime,
          description: item.description,
        })),
        alternates: alternateItems.map((item) => ({
          id: item.id,
          mpn: item.mpn,
          partNumber: item.partNumber,
          manufacturer: item.manufacturer,
          packageSize: item.packageSize,
          cost: item.cost,
          leadTime: item.leadTime,
          description: item.description,
          isAlternate: true,
        })),
      },
      selectedId: selectedItem?.id,
      selectedIsAlternate: selectedItem?.isAlternate ?? false,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to scan feeder" });
  }
});

router.get("/sessions/:sessionId/splices", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    if (!Number.isFinite(sessionId)) {
      res.status(400).json({ error: "Invalid sessionId" });
      return;
    }

    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const changeoverId = formatSmtSessionId(session.startTime ?? session.createdAt ?? null, session.id);
    const splices = await safeListSpliceRecords(changeoverId);

    const spliceEntityIds = splices.map((splice) => `splice_${splice.id}`);
    const auditLogs = spliceEntityIds.length > 0
      ? await db
          .select()
          .from(auditLogsTable)
          .where(
            and(
              eq(auditLogsTable.entityType, "feeder_splice"),
              inArray(auditLogsTable.entityId, spliceEntityIds),
            ),
          )
      : [];

    const auditPayloadMap = new Map<string, SpliceAuditPayload>();
    for (const auditLog of auditLogs) {
      const payload = parseSpliceAuditPayload(auditLog.newValue ?? auditLog.oldValue ?? null);
      if (payload) {
        auditPayloadMap.set(auditLog.entityId, payload);
      }
    }

    const bomItems = session.bomId
      ? await db
          .select()
          .from(bomItemsTable)
          .where(and(eq(bomItemsTable.bomId, session.bomId), isNull(bomItemsTable.deletedAt)))
      : [];

    const bomItemMap = new Map<string, (typeof bomItems)[number]>();
    for (const item of bomItems) {
      bomItemMap.set(item.id.toString(), item); // Map by ID for lineItemId lookup
      bomItemMap.set(normalizeExact(item.feederNumber), item); // Also map by feeder number
    }

    res.json(
      splices.map((splice) => {
        // Extract session ID from changeover ID (SMT_YYYYMMDD_NNNNNN)
        const sessionIdMatch = splice.changeoverId.match(/SMT_\d{8}_(\d{6})$/);
        const extractedSessionId = sessionIdMatch ? parseInt(sessionIdMatch[1], 10) : sessionId;

        // Look up BOM item by lineItemId, or fall back to feeder number from splice record
        const bomItem = splice.lineItemId ? bomItemMap.get(splice.lineItemId) ?? null : null;
        const feederNumber = bomItem?.feederNumber ?? splice.feederNumber ?? "UNKNOWN";

        // Map database fields to API fields
        const apiSplice = {
          id: splice.id, // This is now a string (UUID), but API expects number - may need to convert
          sessionId: extractedSessionId,
          feederNumber,
          operatorId: splice.splicedBy ?? "",
          oldSpoolBarcode: splice.oldSpoolMpn ?? "",
          newSpoolBarcode: splice.newSpoolMpn ?? "",
          splicedAt: splice.splicedAt.toISOString(),
          durationSeconds: splice.durationSeconds ?? null,
        };

        const payload = auditPayloadMap.get(`splice_${splice.id}`) ?? null;

        return buildSpliceResponse(apiSplice, bomItem, payload);
      })
    );
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list splices" });
  }
});

// Part C4: PATCH /sessions/:sessionId/splices/:spliceId/verify
// QA/Supervisor marks a single splice pass/fail. Mirrors the approve/reject
// endpoints under /verification but on the session-scoped path.
router.patch(
  "/sessions/:sessionId/splices/:spliceId/verify",
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const spliceId = String(req.params.spliceId ?? "").trim();
      const actor = req.actor!;
      const rawResult = String(req.body?.result ?? "").trim().toLowerCase();
      const notes = String(req.body?.notes ?? "").trim();

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(spliceId)) {
        res.status(400).json({ error: "Invalid splice ID" });
        return;
      }

      if (rawResult !== "pass" && rawResult !== "fail") {
        res.status(400).json({ error: "result must be 'pass' or 'fail'" });
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

      await db
        .update(spliceRecordsTable)
        .set({
          qaResult: rawResult as "pass" | "fail",
          qaVerifiedById: actor.id,
          qaVerifiedAt: new Date(),
        })
        .where(eq(spliceRecordsTable.id, spliceId));

      await db.insert(auditLogsTable).values({
        entityType: "feeder_splice",
        entityId: `splice_${spliceId}`,
        action: rawResult === "pass" ? "splice_approved" : "splice_rejected",
        changedBy: actor.id,
        oldValue: JSON.stringify({ qaResult: splice.qaResult }),
        newValue: JSON.stringify({ qaResult: rawResult, verifiedBy: actor.id, notes }),
        description: `Splice ${spliceId} for feeder ${splice.feederNumber} marked ${rawResult} by ${actor.name}${notes ? `: ${notes}` : ""}`,
      });

      res.json({ success: true, qaResult: rawResult });
    } catch (err) {
      req.log.error(err);
      res.status(500).json({ error: "Failed to verify splice" });
    }
  },
);

router.post("/sessions/:sessionId/splices", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const {
      feederNumber,
      operatorId,
      newSpoolBarcode,
      scannedValue,
      lotCode,
      verificationMode,
      oldSpoolBarcode,
      durationSeconds,
      matchedAs,
      matchedField,
      status,
      newLotCode,
      oldSpool: oldSpoolPayload,
      newSpool: newSpoolPayload,
    } = req.body;

    // === Normalize spool shapes (new structured payload, with backward-compat fallbacks) ===
    const newSpoolObj = (newSpoolPayload && typeof newSpoolPayload === "object")
      ? {
          barcode: String(newSpoolPayload.barcode ?? newSpoolBarcode ?? scannedValue ?? "").trim(),
          label: newSpoolPayload.label ?? null,
          lotCode: newSpoolPayload.lotCode ?? null,
        }
      : {
          barcode: String(scannedValue ?? newSpoolBarcode ?? "").trim(),
          label: null,
          lotCode: lotCode ?? null,
        };

    const oldSpoolObj = (oldSpoolPayload && typeof oldSpoolPayload === "object")
      ? {
          barcode: String(oldSpoolPayload.barcode ?? oldSpoolBarcode ?? "").trim(),
          label: oldSpoolPayload.label ?? null,
          lotCode: oldSpoolPayload.lotCode ?? null,
        }
      : (oldSpoolBarcode
        ? { barcode: String(oldSpoolBarcode).trim(), label: null, lotCode: lotCode ?? null }
        : null);

    if (!feederNumber || !operatorId || !newSpoolObj.barcode) {
      res.status(400).json({ error: "feederNumber, operatorId, and newSpool.barcode are required" });
      return;
    }

    // === STEP 1: Validate Session Exists ===
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // === STEP 2: Verify Feeder Was Scanned & Verified ===
    const normalizedFeeder = String(feederNumber).trim().toUpperCase();
    const normalizedOperatorId = String(operatorId).trim();
    const feederScans = await db
      .select()
      .from(scanRecordsTable)
      .where(
        and(
          eq(scanRecordsTable.sessionId, sessionId),
          eq(scanRecordsTable.feederNumber, normalizedFeeder),
          eq(scanRecordsTable.status, "ok")
        )
      );

    const [bomItem] = await db
      .select()
      .from(bomItemsTable)
      .where(and(eq(bomItemsTable.bomId, session.bomId), eq(bomItemsTable.feederNumber, normalizedFeeder), isNull(bomItemsTable.deletedAt)));

    if (!bomItem) {
      return res.status(404).json({ error: `Feeder ${normalizedFeeder} not found in BOM` });
    }

    const bomRowForMatch = {
      internalPartNumber: bomItem.internalPartNumber,
      mpn1: bomItem.mpn1,
      mpn2: bomItem.mpn2,
      mpn3: bomItem.mpn3,
      mpn4: bomItem.mpn4,
      mpn5: bomItem.mpn5,
      mpn6: bomItem.mpn6,
      mpn7: bomItem.mpn7,
      mpn8: bomItem.mpn8,
      make1: bomItem.make1,
      make2: bomItem.make2,
      make3: bomItem.make3,
      make4: bomItem.make4,
      make5: bomItem.make5,
      make6: bomItem.make6,
      make7: bomItem.make7,
      make8: bomItem.make8,
    };

    // === STEP 3: Old spool - check it matches the BOM (allocated to feeder) ===
    let oldMatch: SpliceMatch | null = null;
    if (oldSpoolObj && oldSpoolObj.barcode) {
      oldMatch = verifySpliceMpn(oldSpoolObj.barcode, bomRowForMatch);
      if (!oldMatch) {
        return res.status(400).json({
          error: `Old spool does not match BOM for feeder ${normalizedFeeder}.`,
          code: "OLD_SPOOL_BOM_MISMATCH",
          status: "failed",
        });
      }
    }

    // === STEP 4: New spool - check it matches the BOM AND is allocated to the same feeder ===
    const newMatch = verifySpliceMpn(newSpoolObj.barcode, bomRowForMatch);

    if (!newMatch) {
      return res.status(400).json({
        error: `New spool is not allocated to feeder ${normalizedFeeder}. Expected: ${[bomItem.mpn1, bomItem.mpn2, bomItem.mpn3, bomItem.mpn4, bomItem.mpn5, bomItem.mpn6, bomItem.mpn7, bomItem.mpn8].filter(Boolean).join(" / ") || bomItem.internalPartNumber || "No part configured"}`,
        code: "WRONG_FEEDER_ALLOCATION",
        status: "failed",
        expectedMpns: [bomItem.mpn1, bomItem.mpn2, bomItem.mpn3, bomItem.mpn4, bomItem.mpn5, bomItem.mpn6, bomItem.mpn7, bomItem.mpn8].filter(Boolean),
        expectedInternalPartNumber: bomItem.internalPartNumber ?? null,
        expectedFeeder: normalizedFeeder,
      });
    }

    // === STEP 5: LOT code gate - new spool MUST have a lot code ===
    // Preference order: 1) explicit newLotCode from the separate step-4 scan,
    //                   2) newSpoolObj.lotCode from the parsed label,
    //                   3) legacy lotCode body field.
    const effectiveNewLotCode = String(newLotCode ?? newSpoolObj.lotCode ?? lotCode ?? "").trim() || null;

    const validationWarnings: string[] = [];
    if (oldSpoolObj && !oldSpoolObj.lotCode) {
      validationWarnings.push("OLD_SPOOL_LOT_CODE_MISSING");
    }
    if (!effectiveNewLotCode) {
      return res.status(400).json({
        error: "New spool lot code is required. Scan a label that contains lot_no or pass newLotCode/lotCode in the request body.",
        code: "MISSING_LOT_CODE",
        missingFrom: "new",
        status: "failed",
      });
    }

    const feederWasVerified = feederScans.length > 0;
    const verificationModeValue = String(verificationMode ?? session.verificationMode ?? "AUTO").toUpperCase() === "MANUAL" ? "MANUAL" : "AUTO";
    const splicedAt = TimestampService.createOperationTimestamp();
    const spliceOperatorId = randomUUID();

    // === STEP 6: Record Splice with Audit Log ===
    const changeoverId = formatSmtSessionId(session.startTime ?? session.createdAt ?? null, session.id);
    const normalizedNewSpoolMpn = String(newSpoolObj.barcode).trim();
    let splice: any;
    let idempotentSpliceRetry = false;
    try {
      const inserted = await db
        .insert(spliceRecordsTable)
        .values({
          changeoverId,
          feederNumber: normalizedFeeder,
          lineItemId: null,
          oldSpoolMpn: oldSpoolObj?.barcode
            ? String(oldMatch?.matchedAs ?? oldSpoolObj.barcode).trim()
            : String(matchedAs ?? newMatch.matchedAs).trim(),
          oldSpoolLot: oldSpoolObj?.lotCode ?? null,
          newSpoolMpn: normalizedNewSpoolMpn,
          newSpoolLot: effectiveNewLotCode,
          splicedBy: spliceOperatorId,
          splicedAt,
          oldSpoolLotCode: oldSpoolObj?.lotCode ?? null,
          newSpoolLotCode: effectiveNewLotCode,
          oldSpoolMatchedField: oldMatch?.matchedField ?? null,
          newSpoolMatchedField: newMatch.matchedField,
          allocationVerified: true,
          oldSpoolPayload: oldSpoolObj?.label ?? oldSpoolObj ?? null,
          newSpoolPayload: newSpoolObj.label ?? newSpoolObj,
          validationWarnings: validationWarnings.length > 0 ? validationWarnings : [],
          durationSeconds: durationSeconds != null ? Number(durationSeconds) : null,
          qaResult: "pending",
        })
        .returning();
      splice = inserted[0];
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      idempotentSpliceRetry = true;
      req.log.warn(
        { changeoverId, feederNumber: normalizedFeeder, newSpoolMpn: normalizedNewSpoolMpn },
        "/sessions/:id/splices idempotent retry: unique violation absorbed",
      );
      const [existing] = await db
        .select()
        .from(spliceRecordsTable)
        .where(
          and(
            eq(spliceRecordsTable.changeoverId, changeoverId),
            eq(spliceRecordsTable.newSpoolMpn, normalizedNewSpoolMpn),
          ),
        )
        .orderBy(desc(spliceRecordsTable.splicedAt))
        .limit(1);
      splice = existing;
    }

    // === STEP 7: Create Comprehensive Audit Log for Splice ===
    const operatorName = session.operatorName || "UNKNOWN";
    const auditPayload: SpliceAuditPayload = {
      feederNumber: normalizedFeeder,
      scannedValue: newSpoolObj.barcode,
      matchedAs: newMatch.matchedAs,
      matchedField: newMatch.matchedField,
      lotCode: effectiveNewLotCode,
      status: newMatch.status,
      verificationMode: verificationModeValue,
      operatorId: normalizedOperatorId,
      splicedAt: new Date(splicedAt).toISOString(),
    };

    if (!idempotentSpliceRetry) {
      await db.insert(auditLogsTable).values({
        entityType: "feeder_splice",
        entityId: `splice_${splice.id}`,
        action: "splice_recorded",
        oldValue: JSON.stringify({
          feederNumber: normalizedFeeder,
          scannedValue: newSpoolObj.barcode,
          oldSpool: oldSpoolObj,
        }),
        newValue: JSON.stringify(auditPayload),
        changedBy: operatorName,
        description: `Feeder ${normalizedFeeder} splice recorded: ${newMatch.matchedAs} (${newMatch.status.toUpperCase()})${feederWasVerified ? "" : " [before feeder verification]"}${durationSeconds ? ` (Duration: ${durationSeconds}s)` : ""} [LOT: ${effectiveNewLotCode}]`,
        createdAt: TimestampService.createAuditTimestamp(),
      });
    }

    // === STEP 8: Return Response ===
    res.status(idempotentSpliceRetry ? 200 : 201).json({
      ...buildSpliceResponse(splice, bomItem, auditPayload),
      message: feederWasVerified
        ? `✅ Splice Approved — ${newMatch.matchedAs} (LOT: ${effectiveNewLotCode})`
        : `⚠ Splice Approved — ${newMatch.matchedAs} (feeder not previously verified) [LOT: ${effectiveNewLotCode}]`,
      feederVerified: feederWasVerified,
      auditLogged: !idempotentSpliceRetry,
      ...(idempotentSpliceRetry ? { idempotent: true } : {}),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to record splice" });
  }
});

router.get("/sessions/:sessionId/summary", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const bomItems = await db
      .select()
      .from(bomItemsTable)
      .where(
        and(
          eq(bomItemsTable.bomId, session.bomId),
          isNull(bomItemsTable.deletedAt),
          sql`COALESCE(${bomItemsTable.isDeleted}, FALSE) = FALSE`,
        ),
      );
    const scans = await db.select().from(scanRecordsTable).where(eq(scanRecordsTable.sessionId, sessionId));

    const totalBomItems = bomItems.length;
    const scannedCount = scans.length;
    const okCount = scans.filter((s) => s.status === "ok").length;
    const rejectCount = scans.filter((s) => s.status === "reject").length;

    const scannedFeederNumbers = new Set(
      scans.filter((s) => s.status === "ok").map((s) => s.feederNumber.trim().toLowerCase())
    );
    const missingCount = bomItems.filter(
      (item) => !scannedFeederNumbers.has(item.feederNumber.trim().toLowerCase())
    ).length;

    const completionPercent = totalBomItems > 0 ? Math.round((okCount / totalBomItems) * 100) : 0;

    const now = new Date();
    const start = new Date(session.startTime);
    const end = session.endTime ? new Date(session.endTime) : now;
    const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

    res.json({
      sessionId,
      totalBomItems,
      scannedCount,
      okCount,
      rejectCount,
      missingCount,
      completionPercent,
      durationMinutes,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get session summary" });
  }
});

router.get("/sessions/:sessionId/report", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    if (!Number.isFinite(sessionId)) {
      res.status(400).json({ error: "Invalid sessionId" });
      return;
    }

    const reportPayload = await buildSessionReportPayload(sessionId);
    if (!reportPayload) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json(reportPayload);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get session report" });
  }
});

router.get("/sessions/:sessionId/report/pdf", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    if (!Number.isFinite(sessionId)) {
      res.status(400).json({ error: "Invalid sessionId" });
      return;
    }

    const reportPayload = await buildSessionReportPayload(sessionId);
    if (!reportPayload) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const { session: reportSession, summary, reportRows } = reportPayload;

    const [baseSession] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    const [bom] = baseSession?.bomId
      ? await db.select().from(bomsTable).where(eq(bomsTable.id, baseSession.bomId))
      : [null];

    // Determine the changeover identifier to query splice records.
    // Legacy sessions derive their SMT changeover code from date + numeric id.
    let rawSplices: any[] = [];
    try {
      const changeoverId = formatSmtSessionId(reportSession.startedAt ?? null, sessionId);
      rawSplices = await safeListSpliceRecords(changeoverId);
    } catch (e) {
      req.log.warn({ err: e }, "Unable to list splice_records for session; continuing without splice rows");
      rawSplices = [];
    }

    const safeText = (value: any): string => String(value ?? "").trim() || "—";

    const formatPDFDuration = (start: any, end: any): string => {
      if (!start) return "N/A";
      const s = new Date(start).getTime();
      const e = end ? new Date(end).getTime() : Date.now();
      if (Number.isNaN(s) || Number.isNaN(e)) return "N/A";
      const totalSec = Math.max(0, Math.round((e - s) / 1000));
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const sec = totalSec % 60;
      if (h >= 24) {
        const d = Math.floor(h / 24);
        return `${d}d ${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
      }
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    };

    const rows = reportRows.map((row: any, rowIndex: number) => {
      const scanStatus = String(row.scanStatus ?? row.status ?? "").toLowerCase();
      const status = scanStatus === "verified" || scanStatus === "pass" || scanStatus === "ok"
        ? "verified"
        : scanStatus === "failed" || scanStatus === "reject"
          ? "failed"
          : scanStatus === "duplicate"
            ? "duplicate"
            : "missing";

      const matchedField = String(row.matchedField ?? "").toLowerCase();
      const matchedLabel = matchedField === "mpn1"
        ? `MPN 1 (${row.make1 ?? ""})`
        : matchedField === "mpn2"
          ? `MPN 2 (${row.make2 ?? ""})`
          : matchedField === "mpn3"
            ? `MPN 3 (${row.make3 ?? ""})`
            : matchedField === "mpn4"
              ? `MPN 4 (${row.make4 ?? ""})`
              : matchedField === "mpn5"
                ? `MPN 5 (${row.make5 ?? ""})`
                : matchedField === "mpn6"
                  ? `MPN 6 (${row.make6 ?? ""})`
                  : matchedField === "mpn7"
                    ? `MPN 7 (${row.make7 ?? ""})`
                    : matchedField === "mpn8"
                      ? `MPN 8 (${row.make8 ?? ""})`
                      : matchedField === "internalpartnumber"
                        ? "Internal P/N"
                        : "—";

      const expectedParts = [row.mpn1, row.mpn2, row.mpn3, row.mpn4, row.mpn5, row.mpn6, row.mpn7, row.mpn8]
        .filter((val: any) => val && String(val).trim())
        .map((val: any) => String(val).trim());
      const expectedMpns = expectedParts.length > 0 ? expectedParts.join("\n") : "—";

      const scannedValue = safeText(row.scannedValue);
      const isAlternate = matchedField === "mpn2" || matchedField === "mpn3" || matchedField === "mpn4" || matchedField === "mpn5" || matchedField === "mpn6" || matchedField === "mpn7" || matchedField === "mpn8";
      const isFailed = status === "failed";

      const scannedText = isFailed
        ? `${scannedValue} ✗`
        : isAlternate
          ? `${scannedValue} ▲`
          : scannedValue;

      return {
        rowIndex,
        feederNumber: safeText(row.feederNumber),
        refDes: safeText(row.referenceLocation),
        component: safeText(row.description),
        value: safeText(row.value),
        pkgSize: safeText(row.packageDescription ?? row.packageType),
        internalPartNo: safeText(row.internalPartNumber),
        expectedMpns,
        scannedText,
        matchedLabel,
        lotCode: safeText(row.lotCode),
        modeText: String(row.verificationMode ?? reportSession.verificationMode ?? "AUTO").toUpperCase() === "MANUAL" ? "MAN" : "AUTO",
        status: status === "verified" ? "PASS" : status === "failed" ? "FAIL" : status === "duplicate" ? "DUP" : "MISS",
        scannedAt: row.scannedAt ? new Date(row.scannedAt).toLocaleTimeString("en-US", { hour12: true }) : "—",
        isAlternate,
        isFailed,
      };
    });

    const spliceRows = rawSplices.map((splice: any, rowIndex: number) => ({
      rowIndex,
      splicedAt: splice?.splicedAt
        ? new Date(splice.splicedAt).toLocaleTimeString("en-US", { hour12: true })
        : "—",
      feederNumber: safeText(splice?.feederNumber),
      oldSpoolBarcode: safeText(splice?.oldSpoolMpn ?? splice?.oldSpoolBarcode),
      newSpoolBarcode: safeText(splice?.newSpoolMpn ?? splice?.newSpoolBarcode),
      newSpoolLot: safeText(splice?.newSpoolLot ?? splice?.newSpoolLotCode),
      matchedField: splice?.newSpoolMatchedField ?? "—",
      durationText: splice?.durationSeconds != null ? `${Number(splice.durationSeconds)}s` : "—",
    }));

    const reportSessionId = formatSmtSessionId(
      reportSession.startedAt ? new Date(reportSession.startedAt) : new Date(),
      reportSession.id,
    );

    const CO_NAME = process.env.COMPANY_NAME ?? process.env.VITE_COMPANY_NAME ?? baseSession?.companyName ?? "Your Company";
    const CO_SHORT = process.env.COMPANY_SHORT ?? process.env.VITE_COMPANY_SHORT ?? "CO";
    const CO_LOGO = process.env.COMPANY_LOGO_PATH ?? process.env.VITE_LOGO_URL ?? null;
    const SYS_TITLE = process.env.SYSTEM_TITLE ?? process.env.VITE_SYSTEM_TITLE ?? "SMT Verification";

    const getLogoPath = () => {
      const candidates = [
        CO_LOGO,
        CO_LOGO ? path.resolve(process.cwd(), CO_LOGO) : null,
        path.resolve(process.cwd(), "artifacts/api-server/assets/ucal-logo.png"),
        path.resolve(process.cwd(), "artifacts/feeder-scanner/public/assets/ucal-logo.png"),
      ].filter((candidate): candidate is string => Boolean(candidate));

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }

      return null;
    };

    const C = {
      // Industrial professional palette - slate / steel tones with muted accents
      SLATE_900: "#0F172A",
      SLATE_800: "#1E293B",
      SLATE_700: "#334155",
      SLATE_600: "#475569",
      SLATE_500: "#64748B",
      SLATE_400: "#94A3B8",
      SLATE_300: "#CBD5E1",
      SLATE_200: "#E2E8F0",
      SLATE_100: "#F1F5F9",
      SLATE_50:  "#F8FAFC",
      WHITE: "#FFFFFF",
      // Muted semantic accents
      STEEL: "#475569",
      STEEL_DARK: "#1E293B",
      EMERALD_700: "#047857",
      EMERALD_800: "#065F46",
      EMERALD_50:  "#ECFDF5",
      RUBY_700:    "#B91C1C",
      RUBY_800:    "#991B1B",
      RUBY_50:     "#FEF2F2",
      AMBER_700:   "#B45309",
      AMBER_800:   "#92400E",
      AMBER_50:    "#FFFBEB",
      INDIGO_700:  "#4338CA",
      INDIGO_50:   "#EEF2FF",
      // Legacy aliases (used by other code paths)
      NAVY: "#1E293B",
      BLUE: "#4338CA",
      BLUE_DARK: "#3730A3",
      BLUE_LIGHT: "#EEF2FF",
      BLACK: "#0F172A",
      GREY_DARK: "#334155",
      GREY_MID: "#64748B",
      GREY_MUTED: "#94A3B8",
      GREY_LIGHT: "#F1F5F9",
      CARD_LIGHT: "#F8FAFC",
      GREY_BORDER: "#CBD5E1",
      GREEN: "#047857",
      GREEN_BG: "#ECFDF5",
      RED: "#B91C1C",
      RED_BG: "#FEF2F2",
      AMBER: "#B45309",
      AMBER_BG: "#FFFBEB",
      BLUE_ACCENT: "#4338CA",
    } as const;

    const toRgb = (hex: string): [number, number, number] => {
      const value = hex.replace("#", "");
      return [
        Number.parseInt(value.slice(0, 2), 16),
        Number.parseInt(value.slice(2, 4), 16),
        Number.parseInt(value.slice(4, 6), 16),
      ];
    };

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="SMT_Report_${reportSessionId}.pdf"`);

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 20, bottom: 20, left: 20, right: 20 },
    });
    doc.pipe(res);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const left = 20;
    const right = pageW - 20;
    const usable = right - left;
    let y = 20;

    // Subtle page frame — thin slate border around the content area
    const drawPageFrame = () => {
      doc.strokeColor(C.SLATE_300).lineWidth(0.5)
        .moveTo(left, 20).lineTo(right, 20).stroke();
      doc.strokeColor(C.SLATE_300).lineWidth(0.5)
        .moveTo(left, pageH - 20).lineTo(right, pageH - 20).stroke();
      // Amber corner ticks (4 corners) — industrial accent
      const tickLen = 12;
      const tickW = 1.4;
      // Top-left
      doc.fillColor(C.AMBER_700).rect(left, 20, tickLen, tickW).fill();
      doc.fillColor(C.AMBER_700).rect(left, 20, tickW, tickLen).fill();
      // Top-right
      doc.fillColor(C.AMBER_700).rect(right - tickLen, 20, tickLen, tickW).fill();
      doc.fillColor(C.AMBER_700).rect(right - tickW, 20, tickW, tickLen).fill();
      // Bottom-left
      doc.fillColor(C.AMBER_700).rect(left, pageH - 20 - tickW, tickLen, tickW).fill();
      doc.fillColor(C.AMBER_700).rect(left, pageH - 20 - tickLen, tickW, tickLen).fill();
      // Bottom-right
      doc.fillColor(C.AMBER_700).rect(right - tickLen, pageH - 20 - tickW, tickLen, tickW).fill();
      doc.fillColor(C.AMBER_700).rect(right - tickW, pageH - 20 - tickLen, tickW, tickLen).fill();
    };

    const getModeLabel = () => `Mode: ${String(reportSession.verificationMode ?? baseSession?.verificationMode ?? "AUTO").toUpperCase()} — STRICT`;

    let _pageNum = 1;
    const drawHeader = () => {
      _pageNum = 1;
      const bandH = 64;
      const logoPath = getLogoPath();
      drawPageFrame();

      // Subtle slate header — professional, not loud
      doc.fillColor(C.SLATE_800).rect(left, y, right - left, bandH).fill();
      // 1px hairline top accent (steel)
      doc.fillColor(C.SLATE_600).rect(left, y, right - left, 0.6).fill();
      // Bottom thin accent bar
      doc.fillColor(C.SLATE_600).rect(left, y + bandH, right - left, 1.5).fill();
      // Brand accent on the left
      doc.fillColor(C.AMBER_700).rect(left, y, 4, bandH).fill();

      if (logoPath) {
        // White backing for logo
        doc.fillColor(C.WHITE).rect(left + 12, y + 10, 48, 44).fill();
        doc.strokeColor(C.SLATE_300).lineWidth(0.4).rect(left + 12, y + 10, 48, 44).stroke();
        doc.image(logoPath, left + 14, y + 12, { fit: [44, 40] });
      } else {
        doc.fillColor(C.WHITE).font("Helvetica-Bold").fontSize(18).text(CO_SHORT, left + 14, y + 12, { width: 60 });
        doc.fillColor(C.SLATE_300).font("Helvetica").fontSize(6).text(CO_NAME, left + 14, y + 33, { width: 60 });
      }

      const logoRight = left + 70;
      const titleX = logoRight;
      const titleW = usable - (logoRight - left) - 175;

      doc.fillColor(C.WHITE).font("Helvetica-Bold").fontSize(13).text("SMT CHANGEOVER VERIFICATION REPORT", titleX, y + 10, {
        width: titleW, align: "left",
      });
      doc.fillColor(C.SLATE_300).font("Helvetica").fontSize(7.5).text(`${CO_NAME}  •  SMT Manufacturing Quality System`, titleX, y + 26, {
        width: titleW, align: "left",
      });

      const panelStr = String(reportSession.panelId ?? baseSession?.panelName ?? "—");
      const custStr = String(reportSession.customer ?? baseSession?.customerName ?? "—");
      const bomStr = safeText(reportSession.bomVersion ?? bom?.name);
      doc.fillColor(C.SLATE_400).font("Helvetica").fontSize(6.5).text(
        `Panel  ${panelStr}    |    Customer  ${custStr}    |    BOM  ${bomStr}`,
        titleX, y + 38, { width: titleW, align: "left" }
      );

      const nowLabel = new Date().toLocaleDateString("en-GB");
      doc.fillColor(C.SLATE_400).font("Helvetica").fontSize(6).text(
        `Generated  ${nowLabel}`,
        titleX, y + 49, { width: titleW, align: "left" }
      );

      // ─── Changeover ID box (top-right) — industrial, monospace, steel/amber accent
      const idBoxX = right - 168;
      const idBoxW = 162;
      const idBoxH = 50;
      const idBoxY = y + 7;
      doc.fillColor(C.SLATE_900).rect(idBoxX, idBoxY, idBoxW, idBoxH).fill();
      doc.strokeColor(C.SLATE_600).lineWidth(0.6).rect(idBoxX, idBoxY, idBoxW, idBoxH).stroke();
      // Left amber stripe inside the ID box
      doc.fillColor(C.AMBER_700).rect(idBoxX, idBoxY, 3, idBoxH).fill();

      doc.fillColor(C.SLATE_400).font("Helvetica-Bold").fontSize(6).text("CHANGEOVER ID", idBoxX + 9, idBoxY + 6, {
        width: idBoxW - 14,
      });
      const idSz = doc.font("Courier-Bold").fontSize(11).widthOfString(reportSessionId) > idBoxW - 18 ? 9 : 11;
      doc.fillColor(C.WHITE).font("Courier-Bold").fontSize(idSz).text(reportSessionId, idBoxX + 9, idBoxY + 16, {
        width: idBoxW - 18,
      });
      doc.fillColor(C.SLATE_300).font("Helvetica").fontSize(6).text(getModeLabel(), idBoxX + 9, idBoxY + 33, {
        width: idBoxW - 14,
      });
      doc.fillColor(C.AMBER_700).font("Helvetica-Bold").fontSize(5.5).text(`PAGE 1 OF 1`, idBoxX + 9, idBoxY + 42, {
        width: idBoxW - 14,
      });

      y += bandH + 10;
    };

    const drawSimpleHeader = () => {
      const sh = 18;
      drawPageFrame();
      doc.fillColor(C.SLATE_800).rect(left, y, right - left, sh).fill();
      doc.fillColor(C.AMBER_700).rect(left, y, 3, sh).fill();
      doc.fillColor(C.WHITE).font("Helvetica-Bold").fontSize(8).text("SMT CHANGEOVER VERIFICATION REPORT", left + 10, y + 5, {
        width: usable * 0.5, align: "left",
      });
      doc.fillColor(C.SLATE_300).font("Helvetica").fontSize(7).text(
        `${reportSessionId}    |    Page ${_pageNum}`,
        left, y + 5, { width: usable - 10, align: "right" }
      );
      y += sh + 6;
    };

    const drawInfoGrid = () => {
      const formatTime = (t: any) => t ? new Date(t).toLocaleTimeString("en-US", { hour12: true }) : "—";
      const infoCards = [
        { label: "Changeover ID", value: reportSessionId, category: "id" },
        { label: "Panel ID", value: String(reportSession.panelId ?? baseSession?.panelName ?? "—"), category: "id" },
        { label: "PCB / Part No.", value: String(reportSession.pcbPartNumber ?? reportSession.panelId ?? baseSession?.panelName ?? "—"), category: "id" },
        { label: "Customer", value: String(reportSession.customer ?? baseSession?.customerName ?? "—"), category: "id" },
        { label: "BOM Version", value: String(reportSession.bomVersion ?? bom?.name ?? "—"), category: "id" },
        { label: "Shift", value: String(reportSession.shift ?? baseSession?.shiftName ?? "—"), category: "schedule" },
        { label: "Shift Date", value: String(baseSession?.shiftDate ?? "—"), category: "schedule" },
        { label: "Start Time", value: formatTime(reportSession.startedAt ?? baseSession?.startTime), category: "schedule" },
        { label: "End Time", value: formatTime(reportSession.completedAt ?? baseSession?.endTime), category: "schedule" },
        { label: "Duration", value: formatPDFDuration(reportSession.startedAt ?? baseSession?.startTime, reportSession.completedAt ?? baseSession?.endTime), category: "schedule" },
        { label: "Operator", value: String(reportSession.operatorName ?? baseSession?.operatorName ?? "—"), category: "people" },
        { label: "Supervisor", value: String(reportSession.supervisorName ?? baseSession?.supervisorName ?? "—"), category: "people" },
        { label: "QA Engineer", value: String(reportSession.qaName ?? baseSession?.qaName ?? "—"), category: "people" },
        { label: "QA Method", value: String(reportSession.qaVerificationMethod ?? "—").replace(/_/g, " "), category: "people" },
        { label: "Machine", value: String(reportSession.machine ?? "—"), category: "equip" },
        { label: "Line", value: String(reportSession.line ?? "—"), category: "equip" },
        { label: "Mode", value: `${String(reportSession.verificationMode ?? baseSession?.verificationMode ?? "AUTO").toUpperCase()} — STRICT`, category: "equip" },
        { label: "Feeders", value: `${reportRows.length} total`, category: "equip" },
        { label: "Splices", value: `${rawSplices.length} recorded`, category: "equip" },
      ];

      const cols = 6;
      const rows = 4;
      const gap = 4;
      const cardW = (usable - gap * (cols - 1)) / cols;
      const cardH = 26;

      const catAccents: Record<string, string> = {
        id: C.SLATE_700,
        schedule: C.INDIGO_700,
        people: C.EMERALD_700,
        equip: C.AMBER_700,
      };

      for (let index = 0; index < infoCards.length; index += 1) {
        const card = infoCards[index];
        const col = index % cols;
        const row = Math.floor(index / cols);
        const x = left + col * (cardW + gap);
        const yy = y + row * (cardH + gap);

        // Slate-50 card with border
        doc.fillColor(C.SLATE_50).rect(x, yy, cardW, cardH).fill();
        doc.strokeColor(C.SLATE_300).lineWidth(0.4).rect(x, yy, cardW, cardH).stroke();

        // Left accent stripe (3px)
        const accent = catAccents[card.category] ?? C.SLATE_500;
        doc.fillColor(accent).rect(x, yy, 2.4, cardH).fill();

        doc.fillColor(C.SLATE_500).font("Helvetica-Bold").fontSize(5.8).text(card.label.toUpperCase(), x + 6, yy + 4, { width: cardW - 10 });
        const valueText = safeText(card.value);
        const valueFontSize = doc.font("Helvetica-Bold").fontSize(8.5).widthOfString(valueText) > cardW - 10 ? 7 : 8.5;
        doc.fillColor(C.SLATE_900).font("Helvetica-Bold").fontSize(valueFontSize).text(valueText, x + 6, yy + 13, {
          width: cardW - 10,
          align: "left",
        });
      }

      y += rows * cardH + (rows - 1) * gap + 8;
    };

    const colWeights = [5.5, 4.5, 9.5, 8.0, 4.0, 9.0, 14.0, 13.0, 9.0, 7.5, 3.5, 4.5, 7.5];
    const getColWidths = (usableWidth: number) => {
      const sum = colWeights.reduce((a, b) => a + b, 0);
      return colWeights.map((p) => usableWidth * (p / sum));
    };

    const widths = getColWidths(usable);
    const drawTableHeaderRow = () => {
      const headers = [
        "Feeder No.",
        "Ref/Des",
        "Description",
        "Value",
        "Pkg",
        "Internal P/N",
        "Expected MPN",
        "Scanned Spool",
        "Matched As",
        "Lot Code",
        "Mode",
        "Status",
        "Time",
      ];
      const headerHeight = 22;
      let x = left;

      headers.forEach((header, index) => {
        const bg = index === 6 ? C.SLATE_500 : index === 7 ? C.SLATE_700 : C.SLATE_800;
        doc.fillColor(bg).rect(x, y, widths[index], headerHeight).fill();
        doc.strokeColor(C.SLATE_800).lineWidth(0.45).rect(x, y, widths[index], headerHeight).stroke();
        doc.fillColor(C.WHITE).font("Helvetica-Bold").fontSize(6.5).text(header.toUpperCase(), x + 2, y + 3, {
          width: widths[index] - 4,
          align: "center",
        });
        x += widths[index];
      });

      y += headerHeight;
    };

    const drawTableSectionHeader = () => {
      doc.fillColor(C.AMBER_700).rect(left, y + 2, 10, 1.4).fill();
      doc.fillColor(C.SLATE_900).font("Helvetica-Bold").fontSize(10.5).text("Component Verification Details", left + 14, y, { width: usable - 14, align: "left" });
      y += 14;
      doc.strokeColor(C.SLATE_200).lineWidth(0.5).moveTo(left, y).lineTo(right, y).stroke();
      y += 6;
      drawTableHeaderRow();
    };

    const measureCellHeight = (text: string, width: number, fontSize: number, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
      return doc.heightOfString(text, { width: width - 4 });
    };

    const drawTable = () => {
      drawTableSectionHeader();

      rows.forEach((row) => {
        const values = [
          row.feederNumber,
          row.refDes,
          row.component,
          row.value,
          row.pkgSize,
          row.internalPartNo,
          row.expectedMpns,
          row.scannedText,
          row.matchedLabel,
          row.lotCode,
          row.modeText,
          row.status,
          row.scannedAt,
        ];

        const rowHeights = values.map((value, index) => {
          const text = String(value ?? "—");
          if (index === 6) return measureCellHeight(text, widths[index], 6, false);
          if (index === 7) return measureCellHeight(text, widths[index], 6.5, true);
          return measureCellHeight(text, widths[index], 7, index === 10 || index === 11);
        });
        const rowH = Math.max(16, Math.ceil(Math.max(...rowHeights) + 6));

        if (y + rowH > pageH - 80) {
          doc.addPage({ size: "A4", layout: "landscape", margins: { top: 20, bottom: 20, left: 20, right: 20 } });
          y = 20;
          _pageNum += 1;
          drawSimpleHeader();
          drawTableSectionHeader();
        }

        const rowBg = row.isFailed ? C.RUBY_50 : row.isAlternate ? C.AMBER_50 : row.rowIndex % 2 === 0 ? C.WHITE : C.SLATE_50;
        let x = left;

        values.forEach((value, idx) => {
          const cellBg = idx === 6 ? C.INDIGO_50 : rowBg;
          doc.fillColor(cellBg).rect(x, y, widths[idx], rowH).fill();

          const textColor = idx === 7
            ? row.isFailed ? C.RUBY_700 : row.isAlternate ? C.AMBER_800 : C.EMERALD_800
            : idx === 6 ? C.INDIGO_700
              : idx === 11 ? (row.status === "PASS" ? C.EMERALD_700 : row.status === "FAIL" ? C.RUBY_700 : C.AMBER_700)
                : idx === 10 ? (row.modeText === "MAN" ? C.AMBER_700 : C.SLATE_700)
                  : C.SLATE_900;

          const cellFontSize = idx === 6 ? 6 : idx === 7 ? 6.5 : 7;
          doc.fillColor(textColor).font(idx === 7 || idx === 10 || idx === 11 ? "Helvetica-Bold" : "Helvetica").fontSize(cellFontSize).text(String(value ?? "—"), x + 2, y + 3, {
            width: widths[idx] - 4,
            align: idx >= 10 ? "center" : "left",
          });

          doc.strokeColor(C.SLATE_200).lineWidth(0.35).rect(x, y, widths[idx], rowH).stroke();
          x += widths[idx];
        });

        y += rowH;
      });

      y += 8;
      // ─── Color-coded legend chips — professional, scannable ───
      const drawLegendChip = (xPos: number, yPos: number, color: string, label: string, width: number) => {
        doc.fillColor(color).rect(xPos, yPos + 3, 8, 4).fill();
        doc.fillColor(C.SLATE_700).font("Helvetica").fontSize(6).text(label, xPos + 11, yPos, { width: width - 12 });
      };
      const chipY = y;
      const chipW = usable / 5;
      const chipGap = 0;
      drawLegendChip(left + 0 * chipW,        chipY, C.EMERALD_700, "Verified — Primary MPN matched",  chipW);
      drawLegendChip(left + 1 * chipW,        chipY, C.AMBER_700,   "Alternate — BOM-approved MPN2/MPN3", chipW);
      drawLegendChip(left + 2 * chipW,        chipY, C.RUBY_700,    "Mismatch — rejected (no BOM match)",  chipW);
      drawLegendChip(left + 3 * chipW,        chipY, C.INDIGO_700,  "Expected BOM options (reference)",   chipW);
      doc.fillColor(C.SLATE_700).font("Helvetica-Bold").fontSize(6).text("Mode: AUTO STRICT — exact match only", left + 4 * chipW, chipY, { width: chipW - 4 });
      y += 11;
    };

    const drawSectionHeader = (title: string, subtitle?: string) => {
      const bandH = subtitle ? 30 : 22;
      doc.fillColor(C.SLATE_800).rect(left, y, usable, bandH).fill();
      doc.fillColor(C.AMBER_700).rect(left, y, 4, bandH).fill();
      doc.fillColor(C.WHITE).font("Helvetica-Bold").fontSize(10).text(title, left + 12, y + 4, { width: usable - 20, align: "left" });
      if (subtitle) {
        doc.fillColor(C.SLATE_300).font("Helvetica").fontSize(6.5).text(subtitle, left + 12, y + 17, { width: usable - 20, align: "left" });
        y += bandH + 4;
      } else {
        y += bandH + 4;
      }
      doc.strokeColor(C.SLATE_300).lineWidth(0.5).moveTo(left, y).lineTo(right, y).stroke();
      y += 5;
    };

    const drawSpliceTable = () => {
      if (spliceRows.length === 0) return;

      drawSectionHeader("Splicing Records", `${spliceRows.length} material continuity event(s) recorded during this changeover`);

      const sCols = [
        { label: "Time", width: usable * 0.09 },
        { label: "Feeder", width: usable * 0.09 },
        { label: "Old Spool", width: usable * 0.20 },
        { label: "New Spool", width: usable * 0.20 },
        { label: "Lot Code", width: usable * 0.15 },
        { label: "Match Field", width: usable * 0.14 },
        { label: "Duration", width: usable * 0.13 },
      ];

      const sHeaderH = 18;
      const drawSpliceHeader = () => {
        let xh = left;
        sCols.forEach((col) => {
          doc.fillColor(C.SLATE_800).rect(xh, y, col.width, sHeaderH).fill();
          doc.strokeColor(C.SLATE_800).lineWidth(0.4).rect(xh, y, col.width, sHeaderH).stroke();
          doc.fillColor(C.WHITE).font("Helvetica-Bold").fontSize(7).text(col.label.toUpperCase(), xh + 2, y + 5, {
            width: col.width - 4, align: "center",
          });
          xh += col.width;
        });
        doc.fillColor(C.AMBER_700).rect(left, y + sHeaderH, usable, 1).fill();
        y += sHeaderH + 1;
      };

      drawSpliceHeader();

      spliceRows.forEach((row, idx) => {
        const rowH = 20;
        // Need room for the row + footer (~30pt). If not, start a new page and redraw the table header.
        if (y + rowH > pageH - 30) {
          doc.addPage({ size: "A4", layout: "landscape", margins: { top: 20, bottom: 20, left: 20, right: 20 } });
          y = 20;
          _pageNum += 1;
          drawSimpleHeader();
          drawSpliceHeader();
        }

        // Zebra striping
        const bg = idx % 2 === 0 ? C.WHITE : C.SLATE_50;
        doc.fillColor(bg).rect(left, y, usable, rowH).fill();

        const values = [row.splicedAt, row.feederNumber, row.oldSpoolBarcode, row.newSpoolBarcode, row.newSpoolLot, row.matchedField, row.durationText];
        let xc = left;
        values.forEach((value, colIdx) => {
          doc.strokeColor(C.SLATE_200).lineWidth(0.3).rect(xc, y, sCols[colIdx].width, rowH).stroke();
          // Duration column gets amber accent; bold for Feeder
          const isDur = colIdx === 6;
          const isFeeder = colIdx === 1;
          doc.fillColor(isDur ? C.AMBER_800 : C.SLATE_900)
            .font(isDur || isFeeder ? "Helvetica-Bold" : "Helvetica")
            .fontSize(7.5)
            .text(String(value ?? "—"), xc + 3, y + 6, {
              width: sCols[colIdx].width - 6,
              align: colIdx === 6 ? "center" : "left",
            });
          xc += sCols[colIdx].width;
        });
        y += rowH;
      });

      y += 10;
    };

    const drawApprovals = () => {
      drawSectionHeader("Approvals & Sign-off", "Acknowledged by the listed roles under standard changeover protocol");

      const roles = ["SUPERVISOR", "OPERATOR", "QA ENGINEER", "PRODUCTION MANAGER"];
      const names = [
        reportSession.supervisorName ?? baseSession?.supervisorName ?? "",
        reportSession.operatorName ?? baseSession?.operatorName ?? "",
        reportSession.qaName ?? baseSession?.qaName ?? "",
        "________________________",
      ];
      const cellW = usable / 4;
      const cellH = 52;
      const gap = 3;

      for (let i = 0; i < 4; i += 1) {
        const x = left + i * cellW;

        // Slate-50 card with border
        doc.fillColor(C.SLATE_50).rect(x, y, cellW - gap, cellH).fill();
        doc.strokeColor(C.SLATE_300).lineWidth(0.4).rect(x, y, cellW - gap, cellH).stroke();

        // Top accent (slate)
        doc.fillColor(C.SLATE_700).rect(x, y, cellW - gap, 2.2).fill();

        // Role label (uppercase)
        doc.fillColor(C.SLATE_700).font("Helvetica-Bold").fontSize(7.5).text(roles[i], x, y + 7, { width: cellW - gap, align: "center" });

        // Signature line
        doc.strokeColor(C.SLATE_400).lineWidth(0.6)
          .moveTo(x + cellW * 0.12, y + 32)
          .lineTo(x + cellW * 0.88, y + 32)
          .stroke();
        doc.fillColor(C.SLATE_900).font("Helvetica-Bold").fontSize(8.5).text(names[i] || "—", x, y + 34, { width: cellW - gap, align: "center" });

        doc.fillColor(C.SLATE_500).font("Helvetica").fontSize(5.5).text("Name / Signature / Date", x, y + 44, { width: cellW - gap, align: "center" });
      }

      y += 60;
    };

    const drawFooter = () => {
      const now = new Date();
      const genDate = `${now.toLocaleDateString("en-GB")} ${now.toLocaleTimeString("en-US", { hour12: true })}`;
      const footY = pageH - 24;

      // Slate divider
      doc.strokeColor(C.SLATE_300).lineWidth(0.5).moveTo(left, footY).lineTo(right, footY).stroke();
      // Tiny amber tick on the left
      doc.fillColor(C.AMBER_700).rect(left, footY, 18, 1.5).fill();

      doc.fillColor(C.SLATE_700).font("Helvetica-Bold").fontSize(6).text(
        `${SYS_TITLE}  •  Electronically Generated Report`,
        left, footY + 3, { width: usable, align: "left" }
      );
      doc.fillColor(C.SLATE_500).font("Helvetica").fontSize(5.5).text(
        `Changeover ${reportSessionId}  •  Generated ${genDate}  •  Operator ${reportSession.operatorName ?? baseSession?.operatorName ?? "—"}  •  Page ${_pageNum}`,
        left, footY + 12, { width: usable, align: "right" }
      );
    };

    drawHeader();
    drawInfoGrid();
    drawTable();
    drawSpliceTable();
    drawApprovals();
    drawFooter();

    doc.end();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to generate session report PDF" });
  }
});

router.delete("/sessions/:sessionId", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const actorId = req.actor?.userId;
    let deletedByName = "unknown";

    if (actorId) {
      const [user] = await db
        .select({ name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, actorId));
      if (user?.name) {
        deletedByName = user.name;
      }
    }

    // Check if session exists
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // Soft delete: set deletedAt timestamp and deletedBy instead of hard deleting
    await db
      .update(sessionsTable)
      .set({ deletedAt: new Date(), deletedBy: deletedByName })
      .where(eq(sessionsTable.id, sessionId));

    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete session" });
  }
});

router.delete("/sessions/:sessionId/scans", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const userId = req.actor?.username || "unknown";

    // Check if session exists
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // Hard delete all scan records for this session
    const result = await db
      .delete(scanRecordsTable)
      .where(eq(scanRecordsTable.sessionId, sessionId));

    // Log the action
    req.log.info({ sessionId, deletedBy: userId }, "Session scans cleared");

    res.json({ deletedCount: result.rowCount || 0 });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to clear session scans" });
  }
});

export default router;
