import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import { bomsTable, bomItemsTable, changeoverSessionsTable, sessionsTable } from "@workspace/db/schema";
import { eq, and, sql, isNull, isNotNull } from "drizzle-orm";
import { attachActor, requireRole, requireAuth, type AuthRequest } from "../middleware/auth";
import { bomCache, buildKey, getCached, invalidatePrefix, setCached } from "../lib/cache";
import { auditLog } from "../lib/auditLogger";
import { pushNotification } from "../lib/notify";

const router: IRouter = Router();

router.use(attachActor);

// PRD §2.7 / TRD §8 — drop every BOM cache key after any write.
function invalidateBomCache(): void {
  invalidatePrefix(bomCache, "bom:");
}

// Revision lifecycle guard: content edits are only allowed on an 'active' BOM.
// A locked/held revision must be released before its fields or items can change.
// Sends the error response itself and returns false when the caller should stop.
async function assertBomEditable(bomId: number, res: Response): Promise<boolean> {
  const [bom] = await db.select({ status: bomsTable.status }).from(bomsTable).where(eq(bomsTable.id, bomId));
  if (!bom) {
    res.status(404).json({ error: "BOM not found" });
    return false;
  }
  if ((bom.status ?? "active") !== "active") {
    res.status(409).json({ error: "This BOM revision is locked or on hold. Release it before making changes." });
    return false;
  }
  return true;
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
  make4: ["Make 4", "Supplier 4", "Make/Supplier 4"],
  mpn4: ["MPN 4", "Spool Part No. / MPN 4", "Part No 4"],
  make5: ["Make 5", "Supplier 5", "Make/Supplier 5"],
  mpn5: ["MPN 5", "Spool Part No. / MPN 5", "Part No 5"],
  make6: ["Make 6", "Supplier 6", "Make/Supplier 6"],
  mpn6: ["MPN 6", "Spool Part No. / MPN 6", "Part No 6"],
  make7: ["Make 7", "Supplier 7", "Make/Supplier 7"],
  mpn7: ["MPN 7", "Spool Part No. / MPN 7", "Part No 7"],
  make8: ["Make 8", "Supplier 8", "Make/Supplier 8"],
  mpn8: ["MPN 8", "Spool Part No. / MPN 8", "Part No 8"],
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
      .select({ bomId: bomItemsTable.bomId, make1: bomItemsTable.make1, make2: bomItemsTable.make2, make3: bomItemsTable.make3, make4: bomItemsTable.make4, make5: bomItemsTable.make5, make6: bomItemsTable.make6, make7: bomItemsTable.make7, make8: bomItemsTable.make8 })
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
      if (item.make4) makesSet.add(item.make4);
      if (item.make5) makesSet.add(item.make5);
      if (item.make6) makesSet.add(item.make6);
      if (item.make7) makesSet.add(item.make7);
      if (item.make8) makesSet.add(item.make8);
    }

    // Operators cannot see locked/held revisions; qa/supervisor/admin see all (with a badge).
    const visibleBoms = role === "operator"
      ? boms.filter((b) => (b.status ?? "active") === "active")
      : boms;

    const result = visibleBoms.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      version: b.version,
      product: b.product,
      customer: b.customer,
      revisionLabel: b.revisionLabel,
      status: b.status ?? "active",
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
    const { name, description, version, product, customer, revisionLabel, revisionNotes } = req.body;
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const [bom] = await db.insert(bomsTable).values({
      name,
      description,
      version: version || null,
      product: product || null,
      customer: customer || null,
      revisionLabel: revisionLabel || null,
      revisionNotes: revisionNotes || null,
    }).returning();
    invalidateBomCache();
    await auditLog({ event: "BOM_CREATED", operatorId: req.actor?.id, detail: `BOM "${bom.name}" created`, ip: req.ip });
    await pushNotification({ type: "success", message: `BOM created: ${bom.name}`, detail: `by ${req.actor?.username ?? "system"}`, entityId: String(bom.id), createdBy: req.actor?.username });
    res.status(201).json({
      id: bom.id,
      name: bom.name,
      description: bom.description,
      version: bom.version,
      product: bom.product,
      customer: bom.customer,
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
    // Operators cannot open locked/held revisions.
    if (role === "operator" && (bom.status ?? "active") !== "active") {
      res.status(403).json({ error: "This BOM revision is locked or on hold." });
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
    const { name, description, version, product, customer } = req.body;

    if (!(await assertBomEditable(bomId, res))) return;

    const updateData: { name?: string; description?: string; version?: string; product?: string; customer?: string } = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (version !== undefined) updateData.version = version;
    if (product !== undefined) updateData.product = product;
    if (customer !== undefined) updateData.customer = customer;
    
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
    await auditLog({ event: "BOM_UPDATED", operatorId: req.actor?.id, detail: `BOM "${updatedBom.name}" updated`, ip: req.ip });
    await pushNotification({ type: "info", message: `BOM updated: ${updatedBom.name}`, detail: `by ${req.actor?.username ?? "system"}`, entityId: String(updatedBom.id), createdBy: req.actor?.username });
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
    await auditLog({ event: "BOM_DELETED", operatorId: req.actor?.id, detail: `BOM "${bom.name}" moved to trash`, ip: req.ip });
    await pushNotification({ type: "warning", message: `BOM deleted: ${bom.name}`, detail: `moved to trash by ${req.actor?.username ?? "system"}`, entityId: String(bomId), createdBy: req.actor?.username });
    res.json({ success: true, message: "BOM moved to trash" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete BOM" });
  }
});

router.post("/bom/:bomId/items", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const bomId = Number(req.params.bomId);
    if (!(await assertBomEditable(bomId, res))) return;
    const {
      feederNumber,
      partNumber,
      internalPartNumber,
      mpn1,
      mpn2,
      mpn3,
      mpn4,
      mpn5,
      mpn6,
      mpn7,
      mpn8,
      make1,
      make2,
      make3,
      make4,
      make5,
      make6,
      make7,
      make8,
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
        make4: make4 || null,
        mpn4: mpn4 || null,
        make5: make5 || null,
        mpn5: mpn5 || null,
        make6: make6 || null,
        mpn6: mpn6 || null,
        make7: make7 || null,
        mpn7: mpn7 || null,
        make8: make8 || null,
        mpn8: mpn8 || null,
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
    await auditLog({ event: "BOM_UPDATED", operatorId: req.actor?.id, detail: `BOM #${bomId}: item "${feederNumber}" added`, ip: req.ip });
    res.status(201).json(items[0]);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to add BOM item" });
  }
});

router.post("/bom/:bomId/import", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const bomId = Number(req.params.bomId);
    if (!(await assertBomEditable(bomId, res))) return;
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
          make4: cell(row, headerIndex.make4),
          mpn4: cell(row, headerIndex.mpn4),
          make5: cell(row, headerIndex.make5),
          mpn5: cell(row, headerIndex.mpn5),
          make6: cell(row, headerIndex.make6),
          mpn6: cell(row, headerIndex.mpn6),
          make7: cell(row, headerIndex.make7),
          mpn7: cell(row, headerIndex.mpn7),
          make8: cell(row, headerIndex.make8),
          mpn8: cell(row, headerIndex.mpn8),
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
        const hasMpnData = [internalPartNumber, item.mpn1, item.mpn2, item.mpn3, item.mpn4, item.mpn5, item.mpn6, item.mpn7, item.mpn8].some(hasMeaningfulBomValue);
        
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
              ${bomItemsTable.mpn3} = ${item.mpn3 || null} OR
              ${bomItemsTable.mpn4} = ${item.mpn4 || null} OR
              ${bomItemsTable.mpn5} = ${item.mpn5 || null} OR
              ${bomItemsTable.mpn6} = ${item.mpn6 || null} OR
              ${bomItemsTable.mpn7} = ${item.mpn7 || null} OR
              ${bomItemsTable.mpn8} = ${item.mpn8 || null}
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
            make4: item.make4,
            mpn4: item.mpn4,
            make5: item.make5,
            mpn5: item.mpn5,
            make6: item.make6,
            mpn6: item.mpn6,
            make7: item.make7,
            mpn7: item.mpn7,
            make8: item.make8,
            mpn8: item.mpn8,
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
    if (imported > 0) {
      await auditLog({ event: "BOM_IMPORTED", operatorId: req.actor?.id, detail: `BOM #${bomId}: imported ${imported} item(s)`, ip: req.ip });
    }
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
    if (!(await assertBomEditable(bomId, res))) return;

    const [item] = await db.select().from(bomItemsTable).where(eq(bomItemsTable.id, itemId));
    if (!item || item.bomId !== bomId) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    
    await db.delete(bomItemsTable).where(eq(bomItemsTable.id, itemId));
    invalidateBomCache();
    await auditLog({ event: "BOM_UPDATED", operatorId: req.actor?.id, detail: `BOM #${bomId}: item #${itemId} removed`, ip: req.ip });
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
    await auditLog({ event: "BOM_DELETED", operatorId: req.actor?.id, detail: `BOM "${bom.name}" moved to trash`, ip: req.ip });
    await pushNotification({ type: "warning", message: `BOM deleted: ${bom.name}`, detail: `moved to trash by ${req.actor?.username ?? "system"}`, entityId: String(bomId), createdBy: req.actor?.username });
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
    await auditLog({ event: "BOM_RESTORED", operatorId: req.actor?.id, detail: `BOM "${bom.name}" restored from trash`, ip: req.ip });
    await pushNotification({ type: "info", message: `BOM restored: ${bom.name}`, detail: `by ${req.actor?.username ?? "system"}`, entityId: String(bomId), createdBy: req.actor?.username });
    res.json({ success: true, message: "BOM restored from trash" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to restore BOM" });
  }
});

// Revision lifecycle: lock / release / hold a revision.
// status: 'active' (release, usable) | 'locked' | 'hold' (both block scanning + edits).
const STATUS_META: Record<string, { event: "BOM_LOCKED" | "BOM_RELEASED" | "BOM_HELD"; verb: string; type: "info" | "warning" }> = {
  active: { event: "BOM_RELEASED", verb: "released", type: "info" },
  locked: { event: "BOM_LOCKED", verb: "locked", type: "warning" },
  hold: { event: "BOM_HELD", verb: "put on hold", type: "warning" },
};

router.patch("/bom/:bomId/status", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const bomId = Number(req.params.bomId);
    const status = String(req.body?.status ?? "");
    const meta = STATUS_META[status];
    if (!meta) {
      res.status(400).json({ error: "status must be one of: active, locked, hold" });
      return;
    }

    const [bom] = await db.select().from(bomsTable).where(eq(bomsTable.id, bomId));
    if (!bom) {
      res.status(404).json({ error: "BOM not found" });
      return;
    }
    if (bom.deletedAt) {
      res.status(400).json({ error: "Cannot change status of a trashed BOM" });
      return;
    }

    const [updated] = await db
      .update(bomsTable)
      .set({ status })
      .where(eq(bomsTable.id, bomId))
      .returning();

    invalidateBomCache();
    await auditLog({ event: meta.event, operatorId: req.actor?.id, detail: `BOM "${bom.name}" ${meta.verb}`, ip: req.ip });
    await pushNotification({ type: meta.type, message: `BOM ${meta.verb}: ${bom.name}`, detail: `by ${req.actor?.username ?? "system"}`, entityId: String(bomId), createdBy: req.actor?.username });
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update BOM status" });
  }
});

// Hard delete - permanently delete BOM
router.delete("/bom/:bomId/permanent", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
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
    await auditLog({ event: "BOM_PERMANENTLY_DELETED", operatorId: req.actor?.id, detail: `BOM "${bom.name}" permanently deleted`, ip: req.ip });
    await pushNotification({ type: "error", message: `BOM permanently deleted: ${bom.name}`, detail: `by ${req.actor?.username ?? "system"}`, entityId: String(bomId), createdBy: req.actor?.username });
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to permanently delete BOM" });
  }
});


export default router;
