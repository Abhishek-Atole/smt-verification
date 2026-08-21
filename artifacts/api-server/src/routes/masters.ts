import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import { masterListsTable } from "@workspace/db/schema";
import { asc, eq } from "drizzle-orm";
import { attachActor, requireAuth, requireRole, type AuthRequest } from "../middleware/auth";

const router: IRouter = Router();

// Module 7: editable QA master lists (defect types, machines) for the Ref.Sheet
// tab, the Pareto defect axis and the 7.5 Defect Details dropdowns. Mirrors the
// approvers triad: any authenticated user may read; only qa/supervisor/admin may
// add or remove values.
const CATEGORIES = ["defect_type", "machine"] as const;
type Category = (typeof CATEGORIES)[number];

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

router.get("/masters", attachActor, requireAuth, async (_req: AuthRequest, res: Response) => {
  const rows = await db
    .select({ id: masterListsTable.id, category: masterListsTable.category, value: masterListsTable.value })
    .from(masterListsTable)
    .orderBy(asc(masterListsTable.value));

  res.json({
    defectTypes: rows.filter((r) => r.category === "defect_type").map((r) => ({ id: r.id, value: r.value })),
    machines: rows.filter((r) => r.category === "machine").map((r) => ({ id: r.id, value: r.value })),
  });
});

router.post(
  "/masters",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res: Response) => {
    const category = (req.body as { category?: unknown }).category;
    const rawValue = (req.body as { value?: unknown }).value;
    const value = typeof rawValue === "string" ? rawValue.trim() : "";

    if (!isCategory(category)) {
      res.status(400).json({ error: "category must be 'defect_type' or 'machine'" });
      return;
    }
    if (!value) {
      res.status(400).json({ error: "value is required" });
      return;
    }

    const [row] = await db
      .insert(masterListsTable)
      .values({ category, value })
      .onConflictDoNothing()
      .returning();

    // onConflictDoNothing returns nothing when (category, value) already exists
    // — treat that as success (idempotent add).
    res.status(row ? 201 : 200).json({ master: row ?? { category, value } });
  }
);

router.delete(
  "/masters/:id",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }

    await db.delete(masterListsTable).where(eq(masterListsTable.id, id));
    res.status(204).end();
  }
);

export default router;
