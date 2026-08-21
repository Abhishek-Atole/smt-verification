import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import { documentControlTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { attachActor, requireAuth, requireRole, type AuthRequest } from "../middleware/auth";

const router: IRouter = Router();

// Module 7: configurable document-control header strip (Document No / Rev No /
// Rev Date / Page No) for the QA report, keyed by docKey (e.g. QF-OP-03). Any
// authenticated user may read; only qa/supervisor/admin may edit.
router.get("/document-control/:docKey", attachActor, requireAuth, async (req: AuthRequest, res: Response) => {
  const docKey = String(req.params.docKey);
  const [row] = await db.select().from(documentControlTable).where(eq(documentControlTable.docKey, docKey));
  // Absent key returns an empty shell so the header still renders.
  res.json({
    documentControl:
      row ?? { docKey, documentNo: docKey, revNo: "", revDate: "", pageNo: "", updatedBy: null, updatedAt: null },
  });
});

router.put(
  "/document-control/:docKey",
  attachActor,
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res: Response) => {
    const actor = req.actor!;
    const docKey = String(req.params.docKey);
    const opt = (v: unknown) => {
      const s = typeof v === "string" ? v.trim() : "";
      return s || null;
    };
    const values = {
      documentNo: opt(req.body?.documentNo),
      revNo: opt(req.body?.revNo),
      revDate: opt(req.body?.revDate),
      pageNo: opt(req.body?.pageNo),
      updatedBy: actor.id,
    };

    const [row] = await db
      .insert(documentControlTable)
      .values({ docKey, ...values })
      .onConflictDoUpdate({ target: documentControlTable.docKey, set: values })
      .returning();

    res.json({ documentControl: row });
  }
);

export default router;
