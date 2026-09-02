import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import { reelsTable, auditLogsTable, approversTable } from "@workspace/db/schema";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { attachActor, requireRole, type AuthRequest } from "../middleware/auth";

const router: IRouter = Router();

// Module 11.4 Reel/Lot Master + 11.7 store issue-to-line. Store receives a
// physical reel (one row per reel) and later issues it to a line. Deliberately
// NOT wired into the changeover scan (11.5): the table starts empty, so gating
// scans on it would reject every scan until store has received every reel in
// use. That enforcement is a separate, explicit change.
//
// storekeeper writes (receive/issue); supervisor/admin read too so they can see
// stock without a store login. Bin/batch/lot/DC differing between reels of the
// same part is expected (11.4) and is never treated as a mismatch.

const STATUSES = ["in_stock", "issued", "in_use", "consumed", "expired"] as const;
type ReelStatus = (typeof STATUSES)[number];

function isStatus(value: unknown): value is ReelStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

// Trimmed, null when blank — same helper shape as qa-rejections.ts.
function opt(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
}

// YYYY-MM-DD or null. Rejects anything else so a typo can't land as an invalid
// date literal and blow up at insert time.
function optDate(v: unknown): string | null | undefined {
  const s = opt(v);
  if (s === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

const readRoles = requireRole("storekeeper", "supervisor", "admin");
const writeRoles = requireRole("storekeeper", "admin");

router.get("/reels", attachActor, readRoles, async (req: AuthRequest, res: Response) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const part = typeof req.query.part === "string" ? req.query.part.trim() : "";
  const line = typeof req.query.line === "string" ? req.query.line : null;

  const conditions: SQL[] = [];
  if (status) {
    if (!isStatus(status)) {
      res.status(400).json({ error: `status must be one of ${STATUSES.join(", ")}` });
      return;
    }
    conditions.push(eq(reelsTable.status, status));
  }
  if (part) conditions.push(eq(reelsTable.partNumber, part.toUpperCase()));
  if (line) conditions.push(eq(reelsTable.currentLineName, line));

  const rows = await db
    .select()
    .from(reelsTable)
    .where(conditions.length ? and(...conditions) : sql`true`)
    .orderBy(desc(reelsTable.id));

  res.json({ reels: rows, total: rows.length });
});

// Stock counts per status, for the store dashboard header.
router.get("/reels/summary", attachActor, readRoles, async (_req: AuthRequest, res: Response) => {
  const rows = await db
    .select({
      status: reelsTable.status,
      count: sql<number>`COUNT(*)::int`,
      qty: sql<number>`COALESCE(SUM(${reelsTable.qtyReceived}), 0)::int`,
    })
    .from(reelsTable)
    .groupBy(reelsTable.status);

  const byStatus = Object.fromEntries(
    STATUSES.map((s) => {
      const hit = rows.find((r) => r.status === s);
      return [s, { count: Number(hit?.count ?? 0), qty: Number(hit?.qty ?? 0) }];
    }),
  );
  const total = rows.reduce((sum, r) => sum + Number(r.count), 0);

  res.json({ total, byStatus });
});

// 11.4 — receive a reel into store.
router.post("/reels", attachActor, writeRoles, async (req: AuthRequest, res: Response) => {
  const actor = req.actor!;
  const partNumber = String(req.body?.partNumber ?? "").trim().toUpperCase();

  if (!partNumber) {
    res.status(400).json({ error: "partNumber is required" });
    return;
  }

  const qtyRaw = req.body?.qtyReceived;
  let qtyReceived: number | null = null;
  if (qtyRaw != null && qtyRaw !== "") {
    const n = Number(qtyRaw);
    if (!Number.isInteger(n) || n <= 0) {
      res.status(400).json({ error: "qtyReceived must be a positive integer" });
      return;
    }
    qtyReceived = n;
  }

  const mfgDate = optDate(req.body?.mfgDate);
  const expDate = optDate(req.body?.expDate);
  const receivedDate = optDate(req.body?.receivedDate);
  if (mfgDate === undefined || expDate === undefined || receivedDate === undefined) {
    res.status(400).json({ error: "dates must be YYYY-MM-DD" });
    return;
  }

  const [row] = await db
    .insert(reelsTable)
    .values({
      partNumber,
      description: opt(req.body?.description),
      binNo: opt(req.body?.binNo),
      batchNo: opt(req.body?.batchNo),
      lotNo: opt(req.body?.lotNo),
      dcCode: opt(req.body?.dcCode),
      mfgDate,
      expDate,
      receivedDate: receivedDate ?? new Date().toISOString().split("T")[0],
      qtyReceived,
      status: "in_stock",
      receivedBy: actor.id,
      receivedByName: actor.name,
    })
    .returning();

  await db.insert(auditLogsTable).values({
    entityType: "reel",
    entityId: String(row.id),
    action: "reel_received",
    changedBy: actor.id,
    actorRole: actor.role,
    newValue: JSON.stringify({ partNumber, lotNo: row.lotNo, binNo: row.binNo, qtyReceived }),
    description: `Store received reel #${row.id} (${partNumber}${row.lotNo ? ` lot ${row.lotNo}` : ""}) by ${actor.name}`,
  });

  res.status(201).json({ reel: row });
});

// 11.7 — issue a reel from store to a line. Sets status = issued and records
// which line it went to; this is the event a future 11.5 loading check reads.
router.post("/reels/:id/issue", attachActor, writeRoles, async (req: AuthRequest, res: Response) => {
  const actor = req.actor!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }

  const lineName = String(req.body?.lineName ?? "").trim();
  if (!lineName) {
    res.status(400).json({ error: "lineName is required" });
    return;
  }

  // Line must be a configured line (approvers category 'line') — the same
  // roster the New Changeover form offers, so store can't invent a line name
  // that no changeover will ever match.
  const [knownLine] = await db
    .select({ name: approversTable.name })
    .from(approversTable)
    .where(and(eq(approversTable.category, "line"), eq(approversTable.name, lineName)));
  if (!knownLine) {
    res.status(400).json({ error: "unknown line — configure it under Manage Approvers first" });
    return;
  }

  const [reel] = await db.select().from(reelsTable).where(eq(reelsTable.id, id));
  if (!reel) {
    res.status(404).json({ error: "Reel not found" });
    return;
  }
  if (reel.status !== "in_stock") {
    res.status(409).json({ error: `reel is ${reel.status}, only in_stock reels can be issued` });
    return;
  }

  const [row] = await db
    .update(reelsTable)
    .set({
      status: "issued",
      currentLineName: lineName,
      issuedAt: new Date(),
      issuedBy: actor.id,
      issuedByName: actor.name,
    })
    .where(eq(reelsTable.id, id))
    .returning();

  await db.insert(auditLogsTable).values({
    entityType: "reel",
    entityId: String(id),
    action: "reel_issued",
    changedBy: actor.id,
    actorRole: actor.role,
    oldValue: JSON.stringify({ status: reel.status, currentLineName: reel.currentLineName }),
    newValue: JSON.stringify({ status: "issued", currentLineName: lineName }),
    description: `Store issued reel #${id} (${reel.partNumber}) to ${lineName} by ${actor.name}`,
  });

  res.json({ reel: row });
});

// Lifecycle beyond issue (in_use / consumed / expired), so a reel doesn't get
// stuck at "issued" forever. Deliberately no path back to in_stock: un-issuing
// would rewrite the traceability event 11.7 depends on.
router.patch("/reels/:id/status", attachActor, writeRoles, async (req: AuthRequest, res: Response) => {
  const actor = req.actor!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }

  const status = req.body?.status;
  const ALLOWED_TARGETS = ["in_use", "consumed", "expired"] as const;
  if (typeof status !== "string" || !(ALLOWED_TARGETS as readonly string[]).includes(status)) {
    res.status(400).json({ error: `status must be one of ${ALLOWED_TARGETS.join(", ")}` });
    return;
  }

  const [reel] = await db.select().from(reelsTable).where(eq(reelsTable.id, id));
  if (!reel) {
    res.status(404).json({ error: "Reel not found" });
    return;
  }

  const [row] = await db
    .update(reelsTable)
    .set({ status })
    .where(eq(reelsTable.id, id))
    .returning();

  await db.insert(auditLogsTable).values({
    entityType: "reel",
    entityId: String(id),
    action: "reel_status_changed",
    changedBy: actor.id,
    actorRole: actor.role,
    oldValue: JSON.stringify({ status: reel.status }),
    newValue: JSON.stringify({ status }),
    description: `Reel #${id} (${reel.partNumber}) marked ${status} by ${actor.name}`,
  });

  res.json({ reel: row });
});

export default router;
