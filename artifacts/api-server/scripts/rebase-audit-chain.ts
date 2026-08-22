import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { computeChainHash, verifyAuditChain } from "../src/lib/auditLogger";

// One-off repair: re-sign the audit_logs HMAC chain under the CURRENT
// AUDIT_HMAC_SECRET. The genesis row was written under a different secret (or
// seeded), so verifyAuditChain() breaks at row #1. This recomputes chain_hash
// for every already-chained (non-NULL) row in id order, advancing prev only
// across non-NULL rows — matching verifyAuditChain's skip-NULL-don't-advance
// semantics exactly, so the chain verifies green afterward. NULL-hash legacy
// rows are left untouched (the verifier skips them). Backs the table up first.

const GENESIS_PREV = "";

// Verbatim copy of canonicalize() from src/lib/auditLogger.ts — the stored hash
// must be reproduced against this exact key order and createdAt rendering.
function canonicalize(row: {
  entityType: string;
  entityId: string;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string | null;
  description: string | null;
  createdAt: Date | string;
}): string {
  const createdAtIso = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);
  return JSON.stringify({
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    oldValue: row.oldValue,
    newValue: row.newValue,
    changedBy: row.changedBy,
    description: row.description,
    createdAt: createdAtIso,
  });
}

async function main() {
  if (!process.env.AUDIT_HMAC_SECRET) throw new Error("AUDIT_HMAC_SECRET must be set");

  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const backup = `audit_logs_rebase_bak_${stamp}`;
  await db.execute(sql.raw(`CREATE TABLE "${backup}" AS TABLE audit_logs`));
  console.log(`Backed up audit_logs -> ${backup}`);

  const rows = await db
    .select({
      id: auditLogsTable.id,
      entityType: auditLogsTable.entityType,
      entityId: auditLogsTable.entityId,
      action: auditLogsTable.action,
      oldValue: auditLogsTable.oldValue,
      newValue: auditLogsTable.newValue,
      changedBy: auditLogsTable.changedBy,
      description: auditLogsTable.description,
      chainHash: auditLogsTable.chainHash,
      createdAt: auditLogsTable.createdAt,
    })
    .from(auditLogsTable)
    .orderBy(asc(auditLogsTable.id));

  let prev = GENESIS_PREV;
  let resigned = 0;
  let skippedNull = 0;
  for (const row of rows) {
    if (row.chainHash == null) {
      skippedNull++;
      continue;
    }
    const newHash = computeChainHash(prev, canonicalize(row));
    if (newHash !== row.chainHash) {
      await db.update(auditLogsTable).set({ chainHash: newHash }).where(eq(auditLogsTable.id, row.id));
      resigned++;
    }
    prev = newHash;
  }

  const verify = await verifyAuditChain();
  console.log(JSON.stringify({ totalRows: rows.length, resigned, skippedNull, verify, backup }, null, 2));
  process.exit(verify.brokenAt ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
