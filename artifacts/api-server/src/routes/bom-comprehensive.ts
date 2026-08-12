// artifacts/api-server/src/routes/bom-comprehensive.ts
// Comprehensive BOM management endpoints with revisions, trash, and full 12-field support

import express, { Router } from "express";
import { db } from "@workspace/db";
import { bomsTable, bomItemsTable } from "@workspace/db/schema";
import { eq, and, not, isNull, count, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { logger } from "../lib/logger";
import { attachActor, requireRole, requireAuth, type AuthRequest } from "../middleware/auth";
import { bomCache, invalidatePrefix } from "../lib/cache";

const router = Router();

router.use(attachActor);

// PRD §2.7 / TRD §8 — drop every BOM cache key after any write.
function invalidateBomCache(): void {
  invalidatePrefix(bomCache, "bom:");
}

// ============================================================================
// 1. BOM ENDPOINTS
// ============================================================================

// GET /api/boms/:id - Fetch BOM with revision info
router.get("/boms/:id", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const bomId = Number(id);

    // Fetch BOM with all fields including revision tracking
    const bom = await db
      .select()
      .from(bomsTable)
      .where(eq(bomsTable.id, bomId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!bom) {
      return res.status(404).json({ error: "BOM not found" });
    }

    // Get item count
    const itemCountResult = await db
      .select({ count: count() })
      .from(bomItemsTable)
      .where(and(eq(bomItemsTable.bomId, bomId), not(eq(bomItemsTable.isDeleted, true))))
      .then((rows) => rows[0]?.count || 0);

    // Get makes count
    const makesResult = await db
      .select({
        makes: sql<string>`COUNT(DISTINCT make_1) FILTER (WHERE make_1 IS NOT NULL)
                           + COUNT(DISTINCT make_2) FILTER (WHERE make_2 IS NOT NULL)
                           + COUNT(DISTINCT make_3) FILTER (WHERE make_3 IS NOT NULL)`,
      })
      .from(bomItemsTable)
      .where(and(eq(bomItemsTable.bomId, bomId), not(eq(bomItemsTable.isDeleted, true))))
      .then((rows) => Number(rows[0]?.makes || 0));

    res.json({
      ...bom,
      itemCount: itemCountResult,
      makesCount: makesResult,
    });
  } catch (error) {
    logger.error({ err: error }, "Error fetching BOM");
    res.status(500).json({ error: "Failed to fetch BOM" });
  }
});

// GET /api/boms/:id/revisions - List all revisions in lineage
router.get("/boms/:id/revisions", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const bomId = Number(id);

    // Get the current BOM first
    const currentBom = await db
      .select()
      .from(bomsTable)
      .where(eq(bomsTable.id, bomId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!currentBom) {
      return res.status(404).json({ error: "BOM not found" });
    }

    // Build the chain of revisions (parents and children)
    const chain: any[] = [];
    let current = currentBom;

    // Go up to find root
    while (current.parentBomId) {
      const parent = await db
        .select()
        .from(bomsTable)
        .where(eq(bomsTable.id, current.parentBomId))
        .limit(1)
        .then((rows) => rows[0]);
      if (!parent) break;
      current = parent;
    }

    // Now traverse down collecting all revisions
    const collectRevisions = async (bom: any) => {
      chain.push(bom);
      const children = await db
        .select()
        .from(bomsTable)
        .where(eq(bomsTable.parentBomId, bom.id));
      for (const child of children) {
        await collectRevisions(child);
      }
    };

    await collectRevisions(current);

    res.json(chain);
  } catch (error) {
    logger.error({ err: error }, "Error fetching revisions");
    res.status(500).json({ error: "Failed to fetch revisions" });
  }
});

// POST /api/boms/:id/revisions - Create new revision
router.post("/boms/:id/revisions", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const bomId = Number(id);
    const { revisionLabel, revisionNotes, sourceBomId } = req.body;

    if (!revisionLabel) {
      return res.status(400).json({ error: "Revision label is required" });
    }

    // Validate label uniqueness within lineage
    const currentBom = await db
      .select()
      .from(bomsTable)
      .where(eq(bomsTable.id, bomId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!currentBom) {
      return res.status(404).json({ error: "BOM not found" });
    }

    // Check for duplicate label in full lineage (root + all descendants)
    let root = currentBom;
    while (root.parentBomId) {
      const parent = await db
        .select()
        .from(bomsTable)
        .where(eq(bomsTable.id, root.parentBomId))
        .limit(1)
        .then((rows) => rows[0]);
      if (!parent) break;
      root = parent;
    }

    const lineage: typeof currentBom[] = [];
    const collectLineage = async (bom: typeof currentBom) => {
      lineage.push(bom);
      const children = await db
        .select()
        .from(bomsTable)
        .where(eq(bomsTable.parentBomId, bom.id));

      for (const child of children) {
        await collectLineage(child as typeof currentBom);
      }
    };

    await collectLineage(root);

    // Resolve source BOM for item copy (defaults to current BOM)
    const parsedSourceBomId = Number(sourceBomId);
    const effectiveSourceBomId = Number.isFinite(parsedSourceBomId) && parsedSourceBomId > 0
      ? parsedSourceBomId
      : bomId;

    const sourceBom = lineage.find((bom) => bom.id === effectiveSourceBomId);
    if (!sourceBom) {
      return res.status(400).json({ error: "Selected source revision is not in this BOM lineage" });
    }

    const normalizedLabel = String(revisionLabel).trim().toLowerCase();
    const hasDuplicate = lineage.some(
      (bom) => String(bom.revisionLabel ?? "").trim().toLowerCase() === normalizedLabel,
    );

    if (hasDuplicate) {
      return res.status(400).json({ error: "Revision label already exists in this BOM's lineage" });
    }

    // Create new BOM as child revision
    const newBom = await db
      .insert(bomsTable)
      .values({
        name: currentBom.name,
        description: currentBom.description,
        revisionLabel,
        revisionNotes,
        parentBomId: sourceBom.id,
        isLatest: true,
        createdBy: req.actor?.id || "system",
      })
      .returning();

    // Mark lineage as not latest so only the new revision is latest
    await Promise.all(
      lineage.map((bom) =>
        db
          .update(bomsTable)
          .set({ isLatest: false })
          .where(eq(bomsTable.id, bom.id)),
      ),
    );

    // Copy all active items from selected source BOM to new BOM
    const items = await db
      .select()
      .from(bomItemsTable)
      .where(and(eq(bomItemsTable.bomId, sourceBom.id), not(eq(bomItemsTable.isDeleted, true))));

    if (items.length > 0) {
      const itemsToInsert = items.map((item) => {
        const { id: _oldId, ...rest } = item;
        return {
        ...rest,
        bomId: newBom[0].id,
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        };
      });
      await db.insert(bomItemsTable).values(itemsToInsert as any);
    }

    invalidateBomCache();
    res.json(newBom[0]);
  } catch (error) {
    logger.error({ err: error }, "Error creating revision");
    res.status(500).json({ error: "Failed to create revision" });
  }
});

// ============================================================================
// 2. BOM ITEMS ENDPOINTS (12-field support)
// ============================================================================

// GET /api/bom-items?bom_id=:id - Fetch active items
router.get("/bom-items", requireAuth, async (req, res) => {
  try {
    const bomId = Number(req.query.bom_id);
    if (!bomId) {
      return res.status(400).json({ error: "bom_id query parameter required" });
    }

    const items = await db
      .select()
      .from(bomItemsTable)
      .where(and(eq(bomItemsTable.bomId, bomId), not(eq(bomItemsTable.isDeleted, true))))
      .orderBy(bomItemsTable.srNo);

    res.json(items);
  } catch (error) {
    logger.error({ err: error }, "Error fetching items");
    res.status(500).json({ error: "Failed to fetch items" });
  }
});

// GET /api/bom-items/trash?bom_id=:id - Fetch deleted items
router.get("/bom-items/trash", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const bomId = Number(req.query.bom_id);
    if (!bomId) {
      return res.status(400).json({ error: "bom_id query parameter required" });
    }

    const items = await db
      .select()
      .from(bomItemsTable)
      .where(and(eq(bomItemsTable.bomId, bomId), eq(bomItemsTable.isDeleted, true)))
      .orderBy(bomItemsTable.deletedAt);

    res.json(items);
  } catch (error) {
    logger.error({ err: error }, "Error fetching trash");
    res.status(500).json({ error: "Failed to fetch trash" });
  }
});

// POST /api/bom-items - Create new item (all 12 fields)
router.post("/bom-items", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const {
      bomId,
      srNo,
      feederNumber,
      ucalIntPn,
      quantity,
      reference,
      description,
      package: pkg,
      make1, mpn1,
      make2, mpn2,
      make3, mpn3,
      remarks,
      action,
    } = req.body;

    if (!bomId || !feederNumber || !quantity) {
      return res.status(400).json({ error: "Missing required fields: bomId, feederNumber, quantity" });
    }

    // Auto-generate srNo if not provided
    let finalSrNo = srNo;
    if (!finalSrNo) {
      const lastItem = await db
        .select()
        .from(bomItemsTable)
        .where(eq(bomItemsTable.bomId, bomId))
        .orderBy(sql`CAST(${bomItemsTable.srNo} AS INTEGER) DESC`)
        .limit(1)
        .then((rows) => rows[0]);
      
      const lastNum = lastItem?.srNo ? parseInt(lastItem.srNo) : 0;
      finalSrNo = String(lastNum + 1);
    }

    const newItem = await db
      .insert(bomItemsTable)
      .values({
        bomId,
        srNo: finalSrNo,
        feederNumber,
        ucalIntPn,
        quantity,
        reference,
        description,
        package: pkg,
        make_1: make1,
        mpn_1: mpn1,
        make_2: make2,
        mpn_2: mpn2,
        make_3: make3,
        mpn_3: mpn3,
        remarks,
        action,
        // Defaults
        partNumber: feederNumber, // Legacy field
      })
      .returning();

    invalidateBomCache();
    res.status(201).json(newItem[0]);
  } catch (error) {
    logger.error({ err: error }, "Error creating item");
    res.status(500).json({ error: "Failed to create item" });
  }
});

// PATCH /api/bom-items/:id - Update existing item (inline edit)
router.patch("/bom-items/:id", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const itemId = Number(id);

    const {
      srNo,
      feederNumber,
      ucalIntPn,
      quantity,
      reference,
      description,
      package: pkg,
      make1, mpn1,
      make2, mpn2,
      make3, mpn3,
      remarks,
      action,
    } = req.body;

    const updateData: any = {};
    if (srNo !== undefined) updateData.srNo = srNo;
    if (feederNumber !== undefined) updateData.feederNumber = feederNumber;
    if (ucalIntPn !== undefined) updateData.ucalIntPn = ucalIntPn;
    if (quantity !== undefined) updateData.quantity = quantity;
    if (reference !== undefined) updateData.reference = reference;
    if (description !== undefined) updateData.description = description;
    if (pkg !== undefined) updateData.package = pkg;
    if (make1 !== undefined) updateData.make_1 = make1;
    if (mpn1 !== undefined) updateData.mpn_1 = mpn1;
    if (make2 !== undefined) updateData.make_2 = make2;
    if (mpn2 !== undefined) updateData.mpn_2 = mpn2;
    if (make3 !== undefined) updateData.make_3 = make3;
    if (mpn3 !== undefined) updateData.mpn_3 = mpn3;
    if (remarks !== undefined) updateData.remarks = remarks;
    if (action !== undefined) updateData.action = action;

    const updated = await db
      .update(bomItemsTable)
      .set(updateData)
      .where(eq(bomItemsTable.id, itemId))
      .returning();

    if (updated.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    invalidateBomCache();
    res.json(updated[0]);
  } catch (error) {
    logger.error({ err: error }, "Error updating item");
    res.status(500).json({ error: "Failed to update item" });
  }
});

// DELETE /api/bom-items/:id - Soft delete (move to trash)
router.delete("/bom-items/:id", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const itemId = Number(id);

    const updated = await db
      .update(bomItemsTable)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: req.actor?.id || "system",
      })
      .where(eq(bomItemsTable.id, itemId))
      .returning();

    if (updated.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    invalidateBomCache();
    res.json({ success: true, deleted: updated[0] });
  } catch (error) {
    logger.error({ err: error }, "Error deleting item");
    res.status(500).json({ error: "Failed to delete item" });
  }
});

// PATCH /api/bom-items/:id/restore - Restore from trash
router.patch("/bom-items/:id/restore", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const itemId = Number(id);

    const updated = await db
      .update(bomItemsTable)
      .set({
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
      })
      .where(eq(bomItemsTable.id, itemId))
      .returning();

    if (updated.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    invalidateBomCache();
    res.json(updated[0]);
  } catch (error) {
    logger.error({ err: error }, "Error restoring item");
    res.status(500).json({ error: "Failed to restore item" });
  }
});

// DELETE /api/bom-items/:id/permanent - Hard delete (irreversible)
router.delete("/bom-items/:id/permanent", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const itemId = Number(id);

    const deleted = await db
      .delete(bomItemsTable)
      .where(eq(bomItemsTable.id, itemId))
      .returning();

    if ((deleted as any[]).length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    invalidateBomCache();
    res.json({ success: true, message: "Item permanently deleted" });
  } catch (error) {
    logger.error({ err: error }, "Error permanently deleting item");
    res.status(500).json({ error: "Failed to permanently delete item" });
  }
});

export default router;
