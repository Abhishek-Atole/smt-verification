import { db } from "@workspace/db";
import { bomItemsTable, changeoverSessionsTable, feederScansTable } from "@workspace/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

export type VerifyMatchedField = "internalPartNumber" | "mpn1" | "mpn2" | "mpn3" | "mpn4" | "mpn5" | "mpn6" | "mpn7" | "mpn8";
export type VerifyErrorCode = "FEEDER_NOT_FOUND" | "COMPONENT_MISMATCH" | "ALREADY_SCANNED";

export interface VerifyResult {
  valid: boolean;
  feederNumber: string;
  matchedField: VerifyMatchedField | null;
  matchedMake: string | null;
  isPrimary: boolean;
  hasAlternates: boolean;
  alternateCount: number;
  errorCode: VerifyErrorCode | null;
}

interface BomItemForVerification {
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

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function isNonEmpty(value: string | null | undefined): value is string {
  return Boolean(value && value.trim());
}

function tokenizeInternalPartNumber(value: string | null): string[] {
  if (!isNonEmpty(value)) return [];
  return value
    .replace(/[\r\n]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function buildBaseResult(feederNumber: string, item: BomItemForVerification): Omit<VerifyResult, "valid" | "errorCode"> {
  return {
    feederNumber,
    matchedField: null,
    matchedMake: null,
    isPrimary: false,
    hasAlternates: isNonEmpty(item.mpn2) || isNonEmpty(item.mpn3) || isNonEmpty(item.mpn4) || isNonEmpty(item.mpn5) || isNonEmpty(item.mpn6) || isNonEmpty(item.mpn7) || isNonEmpty(item.mpn8),
    alternateCount: [item.mpn2, item.mpn3, item.mpn4, item.mpn5, item.mpn6, item.mpn7, item.mpn8].filter(isNonEmpty).length,
  };
}

export function verifyMPN(scanned: string, bomRow: BomItemForVerification): VerifyResult {
  const normalizedScannedValue = normalize(scanned);
  const base = buildBaseResult(bomRow.feederNumber, bomRow);

  if (isNonEmpty(bomRow.mpn1) && normalize(bomRow.mpn1) === normalizedScannedValue) {
    return {
      ...base,
      valid: true,
      matchedField: "mpn1",
      matchedMake: isNonEmpty(bomRow.make1) ? bomRow.make1.trim() : null,
      isPrimary: true,
      errorCode: null,
    };
  }

  if (isNonEmpty(bomRow.mpn2) && normalize(bomRow.mpn2) === normalizedScannedValue) {
    return {
      ...base,
      valid: true,
      matchedField: "mpn2",
      matchedMake: isNonEmpty(bomRow.make2) ? bomRow.make2.trim() : null,
      isPrimary: false,
      errorCode: null,
    };
  }

  if (isNonEmpty(bomRow.mpn3) && normalize(bomRow.mpn3) === normalizedScannedValue) {
    return {
      ...base,
      valid: true,
      matchedField: "mpn3",
      matchedMake: isNonEmpty(bomRow.make3) ? bomRow.make3.trim() : null,
      isPrimary: false,
      errorCode: null,
    };
  }

  if (isNonEmpty(bomRow.mpn4) && normalize(bomRow.mpn4) === normalizedScannedValue) {
    return {
      ...base,
      valid: true,
      matchedField: "mpn4",
      matchedMake: isNonEmpty(bomRow.make4) ? bomRow.make4.trim() : null,
      isPrimary: false,
      errorCode: null,
    };
  }

  if (isNonEmpty(bomRow.mpn5) && normalize(bomRow.mpn5) === normalizedScannedValue) {
    return {
      ...base,
      valid: true,
      matchedField: "mpn5",
      matchedMake: isNonEmpty(bomRow.make5) ? bomRow.make5.trim() : null,
      isPrimary: false,
      errorCode: null,
    };
  }

  if (isNonEmpty(bomRow.mpn6) && normalize(bomRow.mpn6) === normalizedScannedValue) {
    return {
      ...base,
      valid: true,
      matchedField: "mpn6",
      matchedMake: isNonEmpty(bomRow.make6) ? bomRow.make6.trim() : null,
      isPrimary: false,
      errorCode: null,
    };
  }

  if (isNonEmpty(bomRow.mpn7) && normalize(bomRow.mpn7) === normalizedScannedValue) {
    return {
      ...base,
      valid: true,
      matchedField: "mpn7",
      matchedMake: isNonEmpty(bomRow.make7) ? bomRow.make7.trim() : null,
      isPrimary: false,
      errorCode: null,
    };
  }

  if (isNonEmpty(bomRow.mpn8) && normalize(bomRow.mpn8) === normalizedScannedValue) {
    return {
      ...base,
      valid: true,
      matchedField: "mpn8",
      matchedMake: isNonEmpty(bomRow.make8) ? bomRow.make8.trim() : null,
      isPrimary: false,
      errorCode: null,
    };
  }

  const internalTokens = tokenizeInternalPartNumber(bomRow.internalPartNumber).map(normalize);
  if (internalTokens.includes(normalizedScannedValue)) {
    return {
      ...base,
      valid: true,
      matchedField: "internalPartNumber",
      matchedMake: null,
      isPrimary: false,
      errorCode: null,
    };
  }

  return {
    ...base,
    valid: false,
    errorCode: normalizedScannedValue ? "COMPONENT_MISMATCH" : "COMPONENT_MISMATCH",
  };
}

export async function verifyFeederScan(
  feederNumber: string,
  scannedValue: string,
  sessionId: string,
): Promise<VerifyResult> {
  const normalizedFeederNumber = feederNumber.trim();
  const normalizedScannedValue = normalize(scannedValue);

  const [session] = await db
    .select({ bomId: changeoverSessionsTable.bomId })
    .from(changeoverSessionsTable)
    .where(eq(changeoverSessionsTable.id, sessionId));

  if (!session) {
    return {
      valid: false,
      feederNumber: normalizedFeederNumber,
      matchedField: null,
      matchedMake: null,
      isPrimary: false,
      hasAlternates: false,
      alternateCount: 0,
      errorCode: "FEEDER_NOT_FOUND",
    };
  }

  const [item] = await db
    .select({
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
        eq(bomItemsTable.bomId, session.bomId),
        eq(bomItemsTable.feederNumber, normalizedFeederNumber),
      ),
    );

  if (!item) {
    return {
      valid: false,
      feederNumber: normalizedFeederNumber,
      matchedField: null,
      matchedMake: null,
      isPrimary: false,
      hasAlternates: false,
      alternateCount: 0,
      errorCode: "FEEDER_NOT_FOUND",
    };
  }

  const base = buildBaseResult(normalizedFeederNumber, item);

  const [existingVerifiedScan] = await db
    .select({ id: feederScansTable.id })
    .from(feederScansTable)
    .where(
      and(
        eq(feederScansTable.sessionId, sessionId),
        eq(feederScansTable.feederNumber, normalizedFeederNumber),
        eq(feederScansTable.status, "verified"),
      ),
    )
    .limit(1);

  if (existingVerifiedScan) {
    return {
      ...base,
      valid: false,
      isPrimary: false,
      errorCode: "ALREADY_SCANNED",
    };
  }

  return verifyMPN(scannedValue, {
    feederNumber: normalizedFeederNumber,
    internalPartNumber: item.internalPartNumber,
    mpn1: item.mpn1,
    mpn2: item.mpn2,
    mpn3: item.mpn3,
    mpn4: item.mpn4,
    mpn5: item.mpn5,
    mpn6: item.mpn6,
    mpn7: item.mpn7,
    mpn8: item.mpn8,
    make1: item.make1,
    make2: item.make2,
    make3: item.make3,
    make4: item.make4,
    make5: item.make5,
    make6: item.make6,
    make7: item.make7,
    make8: item.make8,
  });
}

export async function getSessionProgress(
  sessionId: string,
): Promise<{ verified: number; total: number; percent: number }> {
  const [session] = await db
    .select({ bomId: changeoverSessionsTable.bomId })
    .from(changeoverSessionsTable)
    .where(eq(changeoverSessionsTable.id, sessionId));

  if (!session) {
    return { verified: 0, total: 0, percent: 0 };
  }

  const [totalRow] = await db
    .select({ count: sql<number>`count(distinct ${bomItemsTable.feederNumber})` })
    .from(bomItemsTable)
    .where(
      and(
        eq(bomItemsTable.bomId, session.bomId),
        isNull(bomItemsTable.deletedAt),
      ),
    );

  const [verifiedRow] = await db
    .select({ count: sql<number>`count(distinct ${feederScansTable.feederNumber})` })
    .from(feederScansTable)
    .where(
      and(
        eq(feederScansTable.sessionId, sessionId),
        eq(feederScansTable.status, "verified"),
      ),
    );

  const total = Number(totalRow?.count ?? 0);
  const verified = Number(verifiedRow?.count ?? 0);
  const percent = total > 0 ? Math.round((verified / total) * 100) : 0;

  return { verified, total, percent };
}
