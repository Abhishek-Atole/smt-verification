import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import {
  qaInhouseRejectionsTable,
  sessionsTable,
  auditLogsTable,
  dailyInspectionLogTable,
  masterListsTable,
} from "@workspace/db/schema";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { attachActor, requireAuth, requireRole, type AuthRequest } from "../middleware/auth";

const router: IRouter = Router();

// Module 7: QA in-house rejections. Any authenticated user may read; only
// qa/supervisor/admin may log/edit/delete a rejection. The original
// session-keyed logger still works unchanged; the 7.5 Defect Details form adds
// the richer (nullable) fields, and the dashboard reads daily_inspection_log
// for Block 1 + PPM independent of a changeover's total_output_units.

type ReportLevel = "daily" | "monthly" | "yearly";

// Effective date for a rejection = its entered date, falling back to when the
// row was created (legacy rows have no entry_date).
const effectiveDateSql = sql<string>`COALESCE(${qaInhouseRejectionsTable.entryDate}, ${qaInhouseRejectionsTable.createdAt}::date)`;

function parseLevel(value: unknown): ReportLevel {
  return value === "monthly" || value === "yearly" ? value : "daily";
}

// Bucket key for a YYYY-MM-DD date string at the requested granularity.
function bucketKey(date: string, level: ReportLevel): string {
  if (level === "yearly") return date.slice(0, 4);
  if (level === "monthly") return date.slice(0, 7);
  return date;
}

// Every bucket key from `from`..`to` inclusive, so Block 4 zero-fills gaps.
function buildDateSpine(from: string, to: string, level: ReportLevel): string[] {
  const keys: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return keys;

  if (level === "yearly") {
    for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) keys.push(String(y));
  } else if (level === "monthly") {
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth();
    while (y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth())) {
      keys.push(`${y}-${String(m + 1).padStart(2, "0")}`);
      m++;
      if (m > 11) {
        m = 0;
        y++;
      }
    }
  } else {
    const d = new Date(start);
    while (d <= end) {
      keys.push(d.toISOString().split("T")[0]);
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  return keys;
}

router.get("/qa-rejections", attachActor, requireAuth, async (req: AuthRequest, res: Response) => {
  const sessionId = req.query.sessionId != null ? Number(req.query.sessionId) : null;
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const stage = typeof req.query.stage === "string" ? req.query.stage : null;
  const line = typeof req.query.line === "string" ? req.query.line : null;

  const conditions: SQL[] = [];
  if (sessionId != null && Number.isInteger(sessionId)) conditions.push(eq(qaInhouseRejectionsTable.sessionId, sessionId));
  if (from) conditions.push(sql`${effectiveDateSql} >= ${from}`);
  if (to) conditions.push(sql`${effectiveDateSql} <= ${to}`);
  if (stage) conditions.push(eq(qaInhouseRejectionsTable.stage, stage));
  if (line) conditions.push(eq(qaInhouseRejectionsTable.lineNumber, line));

  const rows = await db
    .select()
    .from(qaInhouseRejectionsTable)
    .where(conditions.length ? and(...conditions) : sql`true`)
    .orderBy(desc(qaInhouseRejectionsTable.createdAt));
  res.json({ rejections: rows, total: rows.length });
});

// Aggregate view: totals, breakdown by defect type, and PPM. When sessionId is
// supplied the PPM uses that changeover's output units; otherwise it sums
// output units across all closed changeovers that have a value.
router.get("/qa-rejections/summary", attachActor, requireAuth, async (req: AuthRequest, res: Response) => {
  const sessionId = req.query.sessionId != null ? Number(req.query.sessionId) : null;
  const scope = sessionId != null ? eq(qaInhouseRejectionsTable.sessionId, sessionId) : sql`true`;

  const byDefect = await db
    .select({
      defectType: qaInhouseRejectionsTable.defectType,
      quantity: sql<number>`COALESCE(SUM(${qaInhouseRejectionsTable.quantity}), 0)::int`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(qaInhouseRejectionsTable)
    .where(scope)
    .groupBy(qaInhouseRejectionsTable.defectType)
    .orderBy(desc(sql`SUM(${qaInhouseRejectionsTable.quantity})`));

  const totalRejected = byDefect.reduce((sum, d) => sum + Number(d.quantity), 0);

  const [outputRow] = await db
    .select({ units: sql<number>`COALESCE(SUM(${sessionsTable.totalOutputUnits}), 0)::int` })
    .from(sessionsTable)
    .where(sessionId != null ? eq(sessionsTable.id, sessionId) : sql`${sessionsTable.totalOutputUnits} IS NOT NULL`);
  const totalOutputUnits = Number(outputRow?.units ?? 0);

  const ppm = totalOutputUnits > 0 ? Math.round((totalRejected / totalOutputUnits) * 1_000_000) : 0;

  res.json({ totalRejected, totalOutputUnits, ppm, byDefect });
});

// Module 7 Summary Graph: the 4-block QF-OP-03 dashboard for a date range at a
// daily/monthly/yearly granularity, optionally filtered by line and part.
router.get("/qa-rejections/dashboard", attachActor, requireAuth, async (req: AuthRequest, res: Response) => {
  const level = parseLevel(req.query.level);
  const line = typeof req.query.line === "string" && req.query.line ? req.query.line : null;
  const part = typeof req.query.part === "string" && req.query.part ? req.query.part : null;

  // Default window = current month, so Block 4's spine is always bounded.
  const now = new Date();
  const defaultFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const defaultTo = now.toISOString().split("T")[0];
  const from = typeof req.query.from === "string" && req.query.from ? req.query.from : defaultFrom;
  const to = typeof req.query.to === "string" && req.query.to ? req.query.to : defaultTo;

  // --- Block 1 + Block 3: manual inspection counts (daily_inspection_log) ---
  const inspConditions = [
    sql`${dailyInspectionLogTable.entryDate} >= ${from}`,
    sql`${dailyInspectionLogTable.entryDate} <= ${to}`,
  ];
  if (line) inspConditions.push(eq(dailyInspectionLogTable.lineNumber, line));
  if (part) inspConditions.push(eq(dailyInspectionLogTable.partNumber, part));

  const [insp] = await db
    .select({
      totalQtyChecked: sql<number>`COALESCE(SUM(${dailyInspectionLogTable.totalQtyChecked}), 0)::int`,
      firstShotQty: sql<number>`COALESCE(SUM(${dailyInspectionLogTable.firstShotQty}), 0)::int`,
      okQty: sql<number>`COALESCE(SUM(${dailyInspectionLogTable.okQty}), 0)::int`,
      notOkQty: sql<number>`COALESCE(SUM(${dailyInspectionLogTable.notOkQty}), 0)::int`,
    })
    .from(dailyInspectionLogTable)
    .where(and(...inspConditions));

  const totalQtyChecked = Number(insp?.totalQtyChecked ?? 0);
  const notOkQty = Number(insp?.notOkQty ?? 0);
  const ppm = totalQtyChecked > 0 ? Math.round((notOkQty / totalQtyChecked) * 1_000_000) : 0;

  // --- Block 2 (Pareto) + Block 4 (datewise series): rejection rows in range ---
  const rejConditions = [sql`${effectiveDateSql} >= ${from}`, sql`${effectiveDateSql} <= ${to}`];
  if (line) rejConditions.push(eq(qaInhouseRejectionsTable.lineNumber, line));
  if (part) rejConditions.push(eq(qaInhouseRejectionsTable.partNumber, part));

  const rejections = await db
    .select({
      quantity: qaInhouseRejectionsTable.quantity,
      defectType: qaInhouseRejectionsTable.defectType,
      effDate: effectiveDateSql,
    })
    .from(qaInhouseRejectionsTable)
    .where(and(...rejConditions));

  // Block 2: sum quantity per defect type, merge the defect master so
  // configured-but-unused defects still render (count 0 at the tail).
  const defectMaster = await db
    .select({ value: masterListsTable.value })
    .from(masterListsTable)
    .where(eq(masterListsTable.category, "defect_type"));

  const defectMap = new Map<string, { defectType: string; quantity: number; count: number }>();
  for (const m of defectMaster) defectMap.set(m.value, { defectType: m.value, quantity: 0, count: 0 });
  for (const r of rejections) {
    const key = r.defectType;
    if (!defectMap.has(key)) defectMap.set(key, { defectType: key, quantity: 0, count: 0 });
    const entry = defectMap.get(key)!;
    entry.quantity += Number(r.quantity);
    entry.count += 1;
  }
  const sortedDefects = [...defectMap.values()].sort((a, b) => b.quantity - a.quantity);
  const totalRejectedQty = sortedDefects.reduce((sum, d) => sum + d.quantity, 0);
  let cumulative = 0;
  const block2Items = sortedDefects.map((d) => {
    cumulative += d.quantity;
    return {
      defectType: d.defectType,
      quantity: d.quantity,
      count: d.count,
      cumulativePercent: totalRejectedQty > 0 ? Math.round((cumulative / totalRejectedQty) * 100 * 10) / 10 : 0,
    };
  });

  // Block 4: zero-filled datewise (bucketed) total-rejection series.
  const bucketSums = new Map<string, number>();
  for (const r of rejections) {
    const key = bucketKey(r.effDate, level);
    bucketSums.set(key, (bucketSums.get(key) ?? 0) + Number(r.quantity));
  }
  const spine = buildDateSpine(from, to, level);
  const block4Series = spine.map((key) => ({ key, quantity: bucketSums.get(key) ?? 0 }));

  res.json({
    from,
    to,
    level,
    block1: {
      totalQtyChecked,
      firstShotQty: Number(insp?.firstShotQty ?? 0),
      okQty: Number(insp?.okQty ?? 0),
      notOkQty,
    },
    block2: { items: block2Items, total: totalRejectedQty },
    block3: { ppm, notOk: notOkQty, totalQtyChecked },
    block4: { series: block4Series },
  });
});

router.post(
  "/qa-rejections",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res: Response) => {
    const actor = req.actor!;
    const sessionId = Number(req.body?.sessionId);
    const defectType = String(req.body?.defectType ?? "").trim();
    const quantity = Number(req.body?.quantity);
    const remarks = String(req.body?.remarks ?? "").trim();

    if (!Number.isInteger(sessionId)) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }
    if (!defectType) {
      res.status(400).json({ error: "defectType is required" });
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      res.status(400).json({ error: "quantity must be a positive integer" });
      return;
    }

    const [session] = await db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId));
    if (!session) {
      res.status(404).json({ error: "Changeover not found" });
      return;
    }

    // Module 7.5 optional detail fields — trimmed, null when blank.
    const opt = (v: unknown) => {
      const s = typeof v === "string" ? v.trim() : "";
      return s || null;
    };

    const [row] = await db
      .insert(qaInhouseRejectionsTable)
      .values({
        sessionId,
        defectType,
        quantity,
        remarks: remarks || null,
        recordedBy: actor.id,
        recordedByName: actor.name,
        entryDate: opt(req.body?.entryDate),
        lineNumber: opt(req.body?.lineNumber),
        bomName: opt(req.body?.bomName),
        partNumber: opt(req.body?.partNumber),
        stage: opt(req.body?.stage),
        component: opt(req.body?.component),
        location: opt(req.body?.location),
        machine: opt(req.body?.machine),
        shift: opt(req.body?.shift),
      })
      .returning();

    await db.insert(auditLogsTable).values({
      entityType: "session",
      entityId: String(sessionId),
      action: "qa_rejection_logged",
      changedBy: actor.id,
      actorRole: actor.role,
      newValue: JSON.stringify({ sessionId, defectType, quantity }),
      description: `QA logged ${quantity} × "${defectType}" rejection on changeover #${sessionId} by ${actor.name}`,
    });

    res.status(201).json({ rejection: row });
  }
);

// Module 9 gap-closer: edit a rejection with a before/after audit trail.
router.patch(
  "/qa-rejections/:id",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res: Response) => {
    const actor = req.actor!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }

    const [old] = await db.select().from(qaInhouseRejectionsTable).where(eq(qaInhouseRejectionsTable.id, id));
    if (!old) {
      res.status(404).json({ error: "Rejection not found" });
      return;
    }

    const updates: Partial<typeof qaInhouseRejectionsTable.$inferInsert> = {};

    if (req.body?.defectType != null) {
      const defectType = String(req.body.defectType).trim();
      if (!defectType) {
        res.status(400).json({ error: "defectType cannot be empty" });
        return;
      }
      updates.defectType = defectType;
    }
    if (req.body?.quantity != null) {
      const quantity = Number(req.body.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        res.status(400).json({ error: "quantity must be a positive integer" });
        return;
      }
      updates.quantity = quantity;
    }

    const optFields = [
      "remarks",
      "entryDate",
      "lineNumber",
      "bomName",
      "partNumber",
      "stage",
      "component",
      "location",
      "machine",
      "shift",
    ] as const;
    for (const f of optFields) {
      if (req.body?.[f] != null) {
        const s = String(req.body[f]).trim();
        updates[f] = s || null;
      }
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "no editable fields provided" });
      return;
    }

    const [row] = await db
      .update(qaInhouseRejectionsTable)
      .set(updates)
      .where(eq(qaInhouseRejectionsTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      entityType: "session",
      entityId: String(old.sessionId),
      action: "qa_rejection_edited",
      changedBy: actor.id,
      actorRole: actor.role,
      oldValue: JSON.stringify(old),
      newValue: JSON.stringify(row),
      description: `QA edited rejection #${id} on changeover #${old.sessionId} by ${actor.name}`,
    });

    res.json({ rejection: row });
  }
);

router.delete(
  "/qa-rejections/:id",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res: Response) => {
    const actor = req.actor!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }

    const [old] = await db.select().from(qaInhouseRejectionsTable).where(eq(qaInhouseRejectionsTable.id, id));
    if (!old) {
      res.status(204).end();
      return;
    }

    await db.delete(qaInhouseRejectionsTable).where(eq(qaInhouseRejectionsTable.id, id));

    await db.insert(auditLogsTable).values({
      entityType: "session",
      entityId: String(old.sessionId),
      action: "qa_rejection_deleted",
      changedBy: actor.id,
      actorRole: actor.role,
      oldValue: JSON.stringify(old),
      description: `QA deleted rejection #${id} on changeover #${old.sessionId} by ${actor.name}`,
    });

    res.status(204).end();
  }
);

export default router;
