import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import { approversTable } from "@workspace/db/schema";
import { asc, eq } from "drizzle-orm";
import { attachActor, requireAuth, requireRole, type AuthRequest } from "../middleware/auth";

const router: IRouter = Router();

const CATEGORIES = ["supervisor", "qa", "line"] as const;
type Category = (typeof CATEGORIES)[number];

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

// Editable approver rosters for the New Changeover form. Any authenticated user
// may read the lists (operators need the dropdown); only qa/supervisor/admin
// may add or remove names. Rows carry their id so the Manage screen can delete.
router.get("/approvers", attachActor, requireAuth, async (_req: AuthRequest, res: Response) => {
  const rows = await db
    .select({ id: approversTable.id, category: approversTable.category, name: approversTable.name })
    .from(approversTable)
    .orderBy(asc(approversTable.name));

  res.json({
    supervisors: rows.filter((r) => r.category === "supervisor").map((r) => ({ id: r.id, name: r.name })),
    qa: rows.filter((r) => r.category === "qa").map((r) => ({ id: r.id, name: r.name })),
    lines: rows.filter((r) => r.category === "line").map((r) => ({ id: r.id, name: r.name })),
  });
});

router.post(
  "/approvers",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res: Response) => {
    const category = (req.body as { category?: unknown }).category;
    const rawName = (req.body as { name?: unknown }).name;
    const name = typeof rawName === "string" ? rawName.trim() : "";

    if (!isCategory(category)) {
      res.status(400).json({ error: "category must be 'supervisor', 'qa', or 'line'" });
      return;
    }
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const [row] = await db
      .insert(approversTable)
      .values({ category, name })
      .onConflictDoNothing()
      .returning();

    // onConflictDoNothing returns nothing when the (category, name) already
    // exists — treat that as success (idempotent add).
    res.status(row ? 201 : 200).json({ approver: row ?? { category, name } });
  }
);

router.delete(
  "/approvers/:id",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }

    await db.delete(approversTable).where(eq(approversTable.id, id));
    res.status(204).end();
  }
);

export default router;
