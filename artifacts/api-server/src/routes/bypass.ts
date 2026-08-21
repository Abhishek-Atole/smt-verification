import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import { bypassLogTable } from "@workspace/db/schema";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { attachActor, requireAuth, requireRole, type AuthRequest } from "../middleware/auth";

const router: IRouter = Router();

// Module 8: manual per-stage bypass log (AOI / SPI). The stage column gives the
// AOI-vs-SPI split that the changeover-level BOM-skip metric (/analytics/bypass)
// cannot. Any authenticated user may read; only qa/supervisor/admin may enter.
router.post(
  "/bypass-log",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res: Response) => {
    const actor = req.actor!;
    const entryDate = String(req.body?.entryDate ?? "").trim();
    const stage = String(req.body?.stage ?? "").trim().toUpperCase();
    const quantity = Number(req.body?.quantity);

    if (!entryDate) {
      res.status(400).json({ error: "entryDate is required" });
      return;
    }
    if (stage !== "AOI" && stage !== "SPI") {
      res.status(400).json({ error: "stage must be 'AOI' or 'SPI'" });
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      res.status(400).json({ error: "quantity must be a non-negative integer" });
      return;
    }

    const opt = (v: unknown) => {
      const s = typeof v === "string" ? v.trim() : "";
      return s || null;
    };

    const [row] = await db
      .insert(bypassLogTable)
      .values({
        entryDate,
        stage,
        quantity,
        shift: opt(req.body?.shift),
        lineNumber: opt(req.body?.lineNumber),
        enteredBy: actor.id,
        enteredByName: actor.name,
      })
      .returning();

    res.status(201).json({ entry: row });
  }
);

// Datewise or shiftwise AOI + SPI series, filtered by range/line/shift.
router.get("/bypass-log", attachActor, requireAuth, async (req: AuthRequest, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const line = typeof req.query.line === "string" && req.query.line ? req.query.line : null;
  const shift = typeof req.query.shift === "string" && req.query.shift ? req.query.shift : null;
  const by = req.query.by === "shift" ? "shift" : "date";

  const conditions: SQL[] = [];
  if (from) conditions.push(sql`${bypassLogTable.entryDate} >= ${from}`);
  if (to) conditions.push(sql`${bypassLogTable.entryDate} <= ${to}`);
  if (line) conditions.push(eq(bypassLogTable.lineNumber, line));
  if (shift) conditions.push(eq(bypassLogTable.shift, shift));

  const rows = await db
    .select()
    .from(bypassLogTable)
    .where(conditions.length ? and(...conditions) : sql`true`)
    .orderBy(desc(bypassLogTable.entryDate));

  // Bucket per stage by date or shift, summing quantity.
  const build = (stage: string) => {
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.stage !== stage) continue;
      const key = by === "shift" ? (r.shift ?? "Unassigned") : r.entryDate;
      map.set(key, (map.get(key) ?? 0) + r.quantity);
    }
    return [...map.entries()].map(([key, quantity]) => ({ key, quantity })).sort((a, b) => a.key.localeCompare(b.key));
  };

  res.json({ by, aoi: build("AOI"), spi: build("SPI") });
});

export default router;
