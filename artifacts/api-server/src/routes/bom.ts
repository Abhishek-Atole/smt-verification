import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { bomsTable, bomItemsTable, changeoverSessionsTable, sessionsTable } from "@workspace/db/schema";
import { eq, and, sql, isNull, isNotNull } from "drizzle-orm";
import { attachActor, requireRole, requireAuth, type AuthRequest } from "../middleware/auth";
import { bomCache, buildKey, getCached, invalidatePrefix, setCached } from "../lib/cache";

const router: IRouter = Router();

router.use(attachActor);

// PRD §2.7 / TRD §8 — drop every BOM cache key after any write.
function invalidateBomCache(): void {
  invalidatePrefix(bomCache, "bom:");
}

type CsvRow = string[];

function parseCsvLine(line: string): CsvRow {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  result.push(current);
  return result.map((cell) => cell.trim());
}

function parseCsvRows(csv: string): CsvRow[] {
  const normalized = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  return lines.map(parseCsvLine);
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeInternalPartNumber(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function hasMeaningfulBomValue(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return false;
  return normalized !== "N/A" && normalized !== "NA" && normalized !== "NULL" && normalized !== "NONE" && normalized !== "-";
}

const HEADER_ALIASES: Record<string, string[]> = {
  feederNumber: ["Feeder Number", "Feeder", "Feeder No", "Feeder No."],
  internalPartNumber: [
    "Internal Part Number",
    "Company Internal Part Number",
    "UCAL Internal Part Number",
    "UCAL Internal Part No",
    "UCAL Internal Part No.",
    "UCAL Internal PN",
    "UCAL Part Number",
    "Ucal Internal Part Number",
    "Ucal Internal Part No",
    "Part Number",
    "Part No",
  ],
  requiredQty: ["Required Qty", "Qty", "Quantity"],
  referenceLocation: ["Reference Location", "Location", "Reference Designator"],
  description: ["Description", "Desc"],
  packageDescription: ["Package/Description", "Package Description", "Package"],
  make1: ["Make 1", "Supplier 1", "Make/Supplier 1"],
  mpn1: ["MPN 1", "Spool Part No. / MPN 1", "Part No 1"],
  make2: ["Make 2", "Supplier 2", "Make/Supplier 2"],
  mpn2: ["MPN 2", "Spool Part No. / MPN 2", "Part No 2"],
  make3: ["Make 3", "Supplier 3", "Make/Supplier 3"],
  mpn3: ["MPN 3", "Spool Part No. / MPN 3", "Part No 3"],
  remarks: ["Remarks", "Remark", "Comments"],
};

function buildHeaderIndex(headerRow: CsvRow): Partial<Record<keyof typeof HEADER_ALIASES, number>> {
  const normalized = headerRow.map(normalizeHeader);
  const indexMap: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {};

  for (const key of Object.keys(HEADER_ALIASES) as Array<keyof typeof HEADER_ALIASES>) {
    const aliases = HEADER_ALIASES[key].map(normalizeHeader);
    const foundIndex = normalized.findIndex((header) => aliases.includes(header));
    if (foundIndex !== -1) {
      indexMap[key] = foundIndex;
    }
  }

  return indexMap;
}

function cell(row: CsvRow, index?: number): string {
  if (index === undefined || index < 0 || index >= row.length) return "";
  return (row[index] ?? "").trim();
}

router.get("/bom", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const showDeleted = req.query.deleted === "true";
    const role = req.actor?.role ?? "anon";

    // TRD §8.2 — role in key. Operators see a projected view in some flows
    // and even though this endpoint returns the same shape today, the cache
    // contract reserves separate buckets per role so we can change the
    // projection later without retro-cache leak.
    const cacheKey = buildKey("bom", role, { kind: "list", showDeleted });
    const cached = getCached<unknown>("bom", cacheKey);
    if (cached !== undefined) {
      res.json(cached);
      return;
    }

    let query = db.select().from(bomsTable);

    if (showDeleted) {
      query = query.where(sql`${bomsTable.deletedAt} IS NOT NULL`) as any;
    } else {
      query = query.where(sql`${bomsTable.deletedAt} IS NULL`) as any;
    }

    const boms = await query.orderBy(bomsTable.createdAt);
    
    // Get item counts
    const counts = await db
      .select({ bomId: bomItemsTable.bomId, count: sql<number>`count(*)::int` })
      .from(bomItemsTable)
      .where(isNull(bomItemsTable.deletedAt))
      .groupBy(bomItemsTable.bomId);

    const countMap = new Map(counts.map((c) => [c.bomId, c.count]));

    // Get all makes for calculating unique manufacturers per BOM
    const makesData = await db
      .select({ bomId: bomItemsTable.bomId, make1: bomItemsTable.make1, make2: bomItemsTable.make2, make3: bomItemsTable.make3 })
      .from(bomItemsTable)
      .where(isNull(bomItemsTable.deletedAt));

    // Calculate makes count per BOM
    const makesCountMap = new Map<number, Set<string>>();
    for (const item of makesData) {
      if (!makesCountMap.has(item.bomId)) {
        makesCountMap.set(item.bomId, new Set());
      }
      const makesSet = makesCountMap.get(item.bomId) as Set<string>;
      if (item.make1) makesSet.add(item.make1);
      if (item.make2) makesSet.add(item.make2);
      if (item.make3) makesSet.add(item.make3);
    }

    const result = boms.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      itemCount: countMap.get(b.id) ?? 0,
      makesCount: (makesCountMap.get(b.id) as Set<string>)?.size ?? 0,
      suppliersCount: (makesCountMap.get(b.id) as Set<string>)?.size ?? 0,
      createdAt: b.createdAt,
      deletedAt: b.deletedAt,
      deletedBy: b.deletedBy,
    }));

    setCached("bom", cacheKey, result);
    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list BOMs" });
  }
});

router.post("/bom", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { name, description, revisionLabel, revisionNotes } = req.body;
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const [bom] = await db.insert(bomsTable).values({
      name,
      description,
      revisionLabel: revisionLabel || null,
      revisionNotes: revisionNotes || null,
    }).returning();
    invalidateBomCache();
    res.status(201).json({
      id: bom.id,
      name: bom.name,
      description: bom.description,
      revisionLabel: bom.revisionLabel,
      revisionNotes: bom.revisionNotes,
      itemCount: 0,
      createdAt: bom.createdAt,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create BOM" });
  }
});

router.get("/bom/:bomId", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const bomId = Number(req.params.bomId);
    const role = req.actor?.role ?? "anon";

    const cacheKey = buildKey("bom", role, { kind: "item", id: bomId });
    const cached = getCached<unknown>("bom", cacheKey);
    if (cached !== undefined) {
      res.json(cached);
      return;
    }

    const [bom] = await db.select().from(bomsTable).where(eq(bomsTable.id, bomId));
    if (!bom) {
      res.status(404).json({ error: "BOM not found" });
      return;
    }
    // Fetch ALL fields from bomItemsTable (complete data synchronization)
    const items = await db
      .select()
      .from(bomItemsTable)
      .where(
        and(
          eq(bomItemsTable.bomId, bomId),
          isNull(bomItemsTable.deletedAt),
          sql`COALESCE(${bomItemsTable.isDeleted}, FALSE) = FALSE`,
        ),
      );
    const payload = { ...bom, items };
    setCached("bom", cacheKey, payload);
    res.json(payload);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get BOM" });
  }
});

router.patch("/bom/:bomId", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const bomId = Number(req.params.bomId);
    const { name, description } = req.body;
    
    const updateData: { name?: string; description?: string } = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    
    const [updatedBom] = await db
      .update(bomsTable)
      .set(updateData)
      .where(eq(bomsTable.id, bomId))
      .returning();
    
    if (!updatedBom) {
      res.status(404).json({ error: "BOM not found" });
      return;
    }

    // Fetch ALL fields from bomItemsTable (complete data synchronization)
    const items = await db
      .select()
      .from(bomItemsTable)
      .where(
        and(
          eq(bomItemsTable.bomId, bomId),
          isNull(bomItemsTable.deletedAt),
          sql`COALESCE(${bomItemsTable.isDeleted}, FALSE) = FALSE`,
        ),
      );
    const itemCount = items.length;

    invalidateBomCache();
    res.json({
      ...updatedBom,
      items,
      itemCount,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update BOM" });
  }
});

router.delete("/bom/:bomId", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const bomId = Number(req.params.bomId);
    const deletedBy = req.actor?.username || "system";

    const [bom] = await db.select().from(bomsTable).where(eq(bomsTable.id, bomId));
    if (!bom) {
      res.status(404).json({ error: "BOM not found" });
      return;
    }

    if (bom.deletedAt) {
      res.status(400).json({ error: "BOM already in trash" });
      return;
    }

    // Soft delete - move to trash
    await db.update(bomsTable)
      .set({ deletedAt: new Date(), deletedBy })
      .where(eq(bomsTable.id, bomId));

    invalidateBomCache();
    res.json({ success: true, message: "BOM moved to trash" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete BOM" });
  }
});

router.post("/bom/:bomId/items", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const bomId = Number(req.params.bomId);
    const {
      feederNumber,
      partNumber,
      internalPartNumber,
      mpn1,
      mpn2,
      mpn3,
      make1,
      make2,
      make3,
      description,
      location,
      quantity,
      itemName,
      srNo,
      rdeplyPartNo,
      referenceDesignator,
      values,
      packageDescription,
      dnpParts,
      supplier1,
      partNo1,
      supplier2,
      partNo2,
      supplier3,
      partNo3,
      remarks,
    } = req.body;
    if (!feederNumber || !partNumber) {
      res.status(400).json({ error: "feederNumber and partNumber are required" });
      return;
    }
    const [bom] = await db.select({ id: bomsTable.id }).from(bomsTable).where(eq(bomsTable.id, bomId));
    if (!bom) {
      res.status(404).json({ error: "BOM not found" });
      return;
    }

    const parsedQuantity = Number(quantity);
    const parsedDnpParts =
      typeof dnpParts === "string"
        ? ["true", "1", "yes", "y", "x"].includes(dnpParts.trim().toLowerCase())
        : Boolean(dnpParts);

    const resolvedInternalPartNumber =
      internalPartNumber || rdeplyPartNo || partNumber || itemName || null;
    const resolvedMpn1 = mpn1 || partNo1 || null;
    const resolvedMpn2 = mpn2 || partNo2 || null;
    const resolvedMpn3 = mpn3 || partNo3 || null;
    const resolvedMake1 = make1 || supplier1 || null;
    const resolvedMake2 = make2 || supplier2 || null;
    const resolvedMake3 = make3 || supplier3 || null;

    const items = await db
      .insert(bomItemsTable)
      .values({ 
        bomId, 
        feederNumber, 
        partNumber, 
        itemName: itemName || partNumber,
        internalPartNumber: resolvedInternalPartNumber,
        make1: resolvedMake1,
        mpn1: resolvedMpn1,
        make2: resolvedMake2,
        mpn2: resolvedMpn2,
        make3: resolvedMake3,
        mpn3: resolvedMpn3,
        expectedMpn: resolvedMpn1,
        internalId: resolvedInternalPartNumber,
        srNo,
        rdeplyPartNo,
        referenceDesignator,
        values,
        packageDescription,
        dnpParts: parsedDnpParts,
        supplier1,
        partNo1,
        supplier2,
        partNo2,
        supplier3,
        partNo3,
        remarks,
        description, 
        location, 
        quantity: Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1,
      })
      .returning();
    invalidateBomCache();
    res.status(201).json(items[0]);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to add BOM item" });
  }
});

router.post("/bom/:bomId/import", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const bomId = Number(req.params.bomId);
    // Support both CSV string and JSON array of items from frontend
    let items: any[] = [];
    
    if (Array.isArray(req.body)) {
      // Frontend sends array of parsed items
      items = req.body.filter((item: any) => item && item.feederNumber);
    } else if (typeof req.body?.csv === "string") {
      // Legacy: raw CSV string support
      const csv = req.body.csv;
      if (!csv.trim()) {
        res.status(400).json({ error: "csv is required", imported: 0, skipped: 0, errors: ["Missing csv payload"] });
        return;
      }
      const rows = parseCsvRows(csv);
      if (rows.length < 2) {
        res.status(400).json({ error: "CSV must contain at least header row", imported: 0, skipped: 0, errors: ["Insufficient rows"] });
        return;
      }
      
      const headerRow = rows[rows.length > 1 ? 1 : 0] ?? [];
      const headerIndex = buildHeaderIndex(headerRow);
      
      if (headerIndex.feederNumber === undefined) {
        res.status(400).json({ error: "Feeder Number column not found", imported: 0, skipped: 0, errors: ["Missing required column"] });
        return;
      }
      
      for (let i = (rows.length > 1 ? 2 : 1); i < rows.length; i++) {
        const row = rows[i] ?? [];
        const isBlankRow = row.every((value) => !String(value ?? "").trim());
        if (isBlankRow) continue;
        
        items.push({
          feederNumber: cell(row, headerIndex.feederNumber),
          srNo: cell(row, headerIndex.srNo),
          internalPartNumber: cell(row, headerIndex.internalPartNumber),
          requiredQty: cell(row, headerIndex.requiredQty),
          referenceLocation: cell(row, headerIndex.referenceLocation),
          description: cell(row, headerIndex.description),
          values: cell(row, headerIndex.values),
          packageDescription: cell(row, headerIndex.packageDescription),
          make1: cell(row, headerIndex.make1),
          mpn1: cell(row, headerIndex.mpn1),
          make2: cell(row, headerIndex.make2),
          mpn2: cell(row, headerIndex.mpn2),
          make3: cell(row, headerIndex.make3),
          mpn3: cell(row, headerIndex.mpn3),
          remarks: cell(row, headerIndex.remarks),
        });
      }
    } else {
      res.status(400).json({ error: "Invalid request format", imported: 0, skipped: 0, errors: ["Expected array or csv field"] });
      return;
    }

    if (!items.length) {
      res.status(400).json({ error: "No valid items to import", imported: 0, skipped: 0, errors: ["No items parsed"] });
      return;
    }

    const [bom] = await db.select({ id: bomsTable.id }).from(bomsTable).where(eq(bomsTable.id, bomId));
    if (!bom) {
      res.status(404).json({ error: "BOM not found", imported: 0, skipped: 0, errors: ["Invalid bomId"] });
      return;
    }

    let imported = 0;
    const errors: string[] = [];
    const skipped: string[] = [];

    // BUG-16/17 fix: Wrap import in transaction for atomicity and add duplicate checking
    await db.transaction(async (tx) => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const feederNumber = (item.feederNumber || "").trim();
        
        if (!feederNumber) continue;
        
        const internalPartNumber = normalizeInternalPartNumber((item.internalPartNumber || "").trim());
        const hasMpnData = [internalPartNumber, item.mpn1, item.mpn2, item.mpn3].some(hasMeaningfulBomValue);
        
        if (!hasMpnData) {
          errors.push(`Row ${i + 1}: feeder "${feederNumber}" has no MPN/part number`);
          continue;
        }

        // Check for duplicates: same feederNumber + any matching MPN (BUG-17 fix)
        const existingItem = await tx
          .select()
          .from(bomItemsTable)
          .where(
            sql`${bomItemsTable.bomId} = ${bomId} AND ${bomItemsTable.feederNumber} = ${feederNumber} AND (
              ${bomItemsTable.mpn1} = ${item.mpn1 || null} OR
              ${bomItemsTable.mpn2} = ${item.mpn2 || null} OR
              ${bomItemsTable.mpn3} = ${item.mpn3 || null}
            )`
          )
          .limit(1);

        if (existingItem.length > 0) {
          skipped.push(`Row ${i + 1}: feeder "${feederNumber}" already exists in this BOM`);
          continue;
        }

        const fallbackPart = internalPartNumber || item.mpn1 || item.mpn2 || item.mpn3 || item.description || feederNumber;
        const parsedQuantity = parseInt(item.requiredQty) || 1;

        try {
          await tx.insert(bomItemsTable).values({
            bomId,
            feederNumber,
            partNumber: fallbackPart,
            itemName: fallbackPart,
            srNo: item.srNo,
            internalPartNumber,
            requiredQty: item.requiredQty,
            referenceLocation: item.referenceLocation,
            description: item.description,
            values: item.values,
            packageDescription: item.packageDescription,
            make1: item.make1,
            mpn1: item.mpn1,
            make2: item.make2,
            mpn2: item.mpn2,
            make3: item.make3,
            mpn3: item.mpn3,
            remarks: item.remarks,
            quantity: parsedQuantity > 0 ? parsedQuantity : 1,
            location: item.referenceLocation,
          });
          imported++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`Row ${i + 1}: ${message}`);
        }
      }
    });

    if (imported > 0) invalidateBomCache();
    res.json({ imported, skipped: skipped.length, errors, skippedReasons: skipped });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to import items", imported: 0, skipped: 0, errors: ["Internal server error"] });
  }
});

router.delete("/bom/:bomId/items/:itemId", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const itemId = Number(req.params.itemId);
    const bomId = Number(req.params.bomId);
    
    const [item] = await db.select().from(bomItemsTable).where(eq(bomItemsTable.id, itemId));
    if (!item || item.bomId !== bomId) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    
    await db.delete(bomItemsTable).where(eq(bomItemsTable.id, itemId));
    invalidateBomCache();
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete BOM item" });
  }
});

// Soft delete - move BOM to trash
router.patch("/bom/:bomId/delete", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const bomId = Number(req.params.bomId);
    const deletedBy = req.actor?.username || "system";
    
    const [bom] = await db.select().from(bomsTable).where(eq(bomsTable.id, bomId));
    if (!bom) {
      res.status(404).json({ error: "BOM not found" });
      return;
    }
    
    if (bom.deletedAt) {
      res.status(400).json({ error: "BOM already in trash" });
      return;
    }
    
    await db.update(bomsTable)
      .set({ deletedAt: new Date(), deletedBy })
      .where(eq(bomsTable.id, bomId));

    invalidateBomCache();
    res.json({ success: true, message: "BOM moved to trash" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete BOM" });
  }
});

// Restore from trash
router.patch("/bom/:bomId/restore", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const bomId = Number(req.params.bomId);
    
    const [bom] = await db.select().from(bomsTable).where(eq(bomsTable.id, bomId));
    if (!bom) {
      res.status(404).json({ error: "BOM not found" });
      return;
    }
    
    if (!bom.deletedAt) {
      res.status(400).json({ error: "BOM is not in trash" });
      return;
    }
    
    await db.update(bomsTable)
      .set({ deletedAt: null, deletedBy: null })
      .where(eq(bomsTable.id, bomId));

    invalidateBomCache();
    res.json({ success: true, message: "BOM restored from trash" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to restore BOM" });
  }
});

// Hard delete - permanently delete BOM
router.delete("/bom/:bomId/permanent", requireRole("qa", "supervisor", "admin"), async (req, res) => {
  try {
    const bomId = Number(req.params.bomId);

    const [bom] = await db.select().from(bomsTable).where(eq(bomsTable.id, bomId));
    if (!bom) {
      res.status(404).json({ error: "BOM not found" });
      return;
    }

    if (!bom.deletedAt) {
      res.status(400).json({ error: "Only deleted BOMs can be permanently deleted" });
      return;
    }

    await db.transaction(async (tx) => {
      const subtreeIds: number[] = [];
      const visited = new Set<number>();

      const collectSubtree = async (currentBomId: number) => {
        if (visited.has(currentBomId)) return;
        visited.add(currentBomId);

        const children = await tx
          .select({ id: bomsTable.id })
          .from(bomsTable)
          .where(eq(bomsTable.parentBomId, currentBomId));

        for (const child of children) {
          await collectSubtree(child.id);
        }

        subtreeIds.push(currentBomId);
      };

      await collectSubtree(bomId);

      for (const id of subtreeIds) {
        await tx.delete(sessionsTable).where(eq(sessionsTable.bomId, id));
        await tx.delete(changeoverSessionsTable).where(eq(changeoverSessionsTable.bomId, id));
      }

      for (const id of subtreeIds) {
        await tx.delete(bomItemsTable).where(eq(bomItemsTable.bomId, id));
      }

      for (const id of subtreeIds) {
        await tx.delete(bomsTable).where(eq(bomsTable.id, id));
      }
    });

    invalidateBomCache();
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to permanently delete BOM" });
  }
});


export default router;
