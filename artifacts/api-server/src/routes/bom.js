import { Router } from "express";
import { db } from "@workspace/db";
import { bomsTable, bomItemsTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
const router = Router();
router.get("/bom", async (req, res) => {
    try {
        const boms = await db.select().from(bomsTable).orderBy(bomsTable.createdAt);
        const counts = await db
            .select({ bomId: bomItemsTable.bomId, count: sql `count(*)::int` })
            .from(bomItemsTable)
            .groupBy(bomItemsTable.bomId);
        const countMap = new Map(counts.map((c) => [c.bomId, c.count]));
        const result = boms.map((b) => ({
            id: b.id,
            name: b.name,
            description: b.description,
            itemCount: countMap.get(b.id) ?? 0,
            createdAt: b.createdAt,
        }));
        res.json(result);
    }
    catch (err) {
        req.log.error(err);
        res.status(500).json({ error: "Failed to list BOMs" });
    }
});
router.post("/bom", async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) {
            res.status(400).json({ error: "name is required" });
            return;
        }
        const [bom] = await db.insert(bomsTable).values({ name, description }).returning();
        res.status(201).json({
            id: bom.id,
            name: bom.name,
            description: bom.description,
            itemCount: 0,
            createdAt: bom.createdAt,
        });
    }
    catch (err) {
        req.log.error(err);
        res.status(500).json({ error: "Failed to create BOM" });
    }
});
router.get("/bom/:bomId", async (req, res) => {
    try {
        const bomId = Number(req.params.bomId);
        const [bom] = await db.select().from(bomsTable).where(eq(bomsTable.id, bomId));
        if (!bom) {
            res.status(404).json({ error: "BOM not found" });
            return;
        }
        const items = await db.select().from(bomItemsTable).where(eq(bomItemsTable.bomId, bomId));
        res.json({ ...bom, items });
    }
    catch (err) {
        req.log.error(err);
        res.status(500).json({ error: "Failed to get BOM" });
    }
});
router.patch("/bom/:bomId", async (req, res) => {
    try {
        const bomId = Number(req.params.bomId);
        const { name, description } = req.body;
        const updateData = {};
        if (name !== undefined)
            updateData.name = name;
        if (description !== undefined)
            updateData.description = description;
        const [updatedBom] = await db
            .update(bomsTable)
            .set(updateData)
            .where(eq(bomsTable.id, bomId))
            .returning();
        if (!updatedBom) {
            res.status(404).json({ error: "BOM not found" });
            return;
        }
        const items = await db.select().from(bomItemsTable).where(eq(bomItemsTable.bomId, bomId));
        const itemCount = items.length;
        res.json({
            id: updatedBom.id,
            name: updatedBom.name,
            description: updatedBom.description,
            itemCount,
            createdAt: updatedBom.createdAt,
        });
    }
    catch (err) {
        req.log.error(err);
        res.status(500).json({ error: "Failed to update BOM" });
    }
});
router.delete("/bom/:bomId", async (req, res) => {
    try {
        const bomId = Number(req.params.bomId);
        const [bom] = await db.select({ id: bomsTable.id }).from(bomsTable).where(eq(bomsTable.id, bomId));
        if (!bom) {
            res.status(404).json({ error: "BOM not found" });
            return;
        }
        await db.delete(bomItemsTable).where(eq(bomItemsTable.bomId, bomId));
        await db.delete(bomsTable).where(eq(bomsTable.id, bomId));
        res.status(204).send();
    }
    catch (err) {
        req.log.error(err);
        res.status(500).json({ error: "Failed to delete BOM" });
    }
});
router.post("/bom/:bomId/items", async (req, res) => {
    try {
        const bomId = Number(req.params.bomId);
        const { feederNumber, partNumber, description, location, quantity, itemName } = req.body;
        if (!feederNumber || !partNumber) {
            res.status(400).json({ error: "feederNumber and partNumber are required" });
            return;
        }
        const [bom] = await db.select({ id: bomsTable.id }).from(bomsTable).where(eq(bomsTable.id, bomId));
        if (!bom) {
            res.status(404).json({ error: "BOM not found" });
            return;
        }
        const items = await db
            .insert(bomItemsTable)
            .values({
            bomId,
            feederNumber,
            partNumber,
            itemName: itemName || partNumber, // Use itemName if provided, otherwise use partNumber
            description,
            location,
            quantity: quantity ?? 1
        })
            .returning();
        res.status(201).json(items[0]);
    }
    catch (err) {
        req.log.error(err);
        res.status(500).json({ error: "Failed to add BOM item" });
    }
});
router.delete("/bom/:bomId/items/:itemId", async (req, res) => {
    try {
        const itemId = Number(req.params.itemId);
        const bomId = Number(req.params.bomId);
        const [item] = await db.select().from(bomItemsTable).where(eq(bomItemsTable.id, itemId));
        if (!item || item.bomId !== bomId) {
            res.status(404).json({ error: "Item not found" });
            return;
        }
        await db.delete(bomItemsTable).where(eq(bomItemsTable.id, itemId));
        res.status(204).send();
    }
    catch (err) {
        req.log.error(err);
        res.status(500).json({ error: "Failed to delete BOM item" });
    }
});
export default router;
