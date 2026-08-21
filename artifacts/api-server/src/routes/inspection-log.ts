import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import { dailyInspectionLogTable } from "@workspace/db/schema";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { attachActor, requireAuth, requireRole, type AuthRequest } from "../middleware/auth";

const router: IRouter = Router();

// Module 7: manual daily inspection counts (QF-OP-03). Drives the Summary Daily
// Inspection Status block and PPM. Any authenticated user may read; only
// qa/supervisor/admin may enter a row.
router.get("/inspection-log", attachActor, requireAuth, async (req: AuthRequest, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const line = typeof req.query.line === "string" && req.query.line ? req.query.line : null;
  const part = typeof req.query.part === "string" && req.query.part ? req.query.part : null;

  const conditions: SQL[] = [];
  if (from) conditions.push(sql`${dailyInspectionLogTable.entryDate} >= ${from}`);
  if (to) conditions.push(sql`${dailyInspectionLogTable.entryDate} <= ${to}`);
  if (line) conditions.push(eq(dailyInspectionLogTable.lineNumber, line));
  if (part) conditions.push(eq(dailyInspectionLogTable.partNumber, part));

  const rows = await db
    .select()
    .from(dailyInspectionLogTable)
    .where(conditions.length ? and(...conditions) : sql`true`)
    .orderBy(desc(dailyInspectionLogTable.entryDate), desc(dailyInspectionLogTable.id));

  res.json({ entries: rows, total: rows.length });
});

router.post(
  "/inspection-log",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res: Response) => {
    const actor = req.actor!;
    const entryDate = String(req.body?.entryDate ?? "").trim();
    const partNumber = String(req.body?.partNumber ?? "").trim();

    if (!entryDate) {
      res.status(400).json({ error: "entryDate is required" });
      return;
    }
    if (!partNumber) {
      res.status(400).json({ error: "partNumber is required" });
      return;
    }

    const int = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
    };
    const opt = (v: unknown) => {
      const s = typeof v === "string" ? v.trim() : "";
      return s || null;
    };

    const [row] = await db
      .insert(dailyInspectionLogTable)
      .values({
        entryDate,
        partNumber,
        lineNumber: opt(req.body?.lineNumber),
        shift: opt(req.body?.shift),
        totalQtyChecked: int(req.body?.totalQtyChecked),
        firstShotQty: int(req.body?.firstShotQty),
        okQty: int(req.body?.okQty),
        notOkQty: int(req.body?.notOkQty),
        enteredBy: actor.id,
        enteredByName: actor.name,
      })
      .returning();

    res.status(201).json({ entry: row });
  }
);

export default router;
