// @ts-nocheck
import { Router } from "express";
import { FeederService } from "../services/feeder-service";
const router = Router();
/**
 * GET /api/feeders - List all feeders
 */
router.get("/feeders", async (req, res) => {
    try {
        const status = req.query.status;
        const feeders = await FeederService.getFeeders(status ? { status } : undefined);
        return res.json(feeders);
    }
    catch (error) {
        return res.status(500).json({ error: `Failed to fetch feeders: ${error}` });
    }
});
/**
 * GET /api/feeders/:feederId - Get feeder by business ID (e.g., "FDR_001")
 */
router.get("/feeders/:feederId", async (req, res) => {
    try {
        const { feederId } = req.params;
        const feeder = await FeederService.getFeederByFeederId(feederId);
        if (!feeder) {
            return res.status(404).json({ error: `Feeder ${feederId} not found` });
        }
        return res.json(feeder);
    }
    catch (error) {
        return res.status(500).json({ error: `Failed to fetch feeder: ${error}` });
    }
});
/**
 * POST /api/feeders - Create new feeder
 */
router.post("/feeders", async (req, res) => {
    try {
        const { feederId, feederType, size, make, description } = req.body;
        if (!feederId || !feederType || !size || !make) {
            return res.status(400).json({
                error: "Missing required fields: feederId, feederType, size, make",
            });
        }
        // @ts-ignore - Drizzle type inference issue
        // @ts-ignore - ServiceCreate type inference
        const feeder = await FeederService.createFeeder({
            feederId,
            feederType,
            size,
            make,
            description,
        });
        // @ts-ignore - FeederService return type
        return res.status(201).json(feeder);
    }
    catch (error) {
        return res.status(500).json({ error: `Failed to create feeder: ${error}` });
    }
});
/**
 * PUT /api/feeders/:id - Update feeder
 */
router.put("/feeders/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const feeder = await FeederService.updateFeeder(Number(id), updates);
        if (!feeder) {
            return res.status(404).json({ error: "Feeder not found" });
        }
        return res.json(feeder);
    }
    catch (error) {
        return res.status(500).json({ error: `Failed to update feeder: ${error}` });
    }
});
/**
 * DELETE /api/feeders/:id - Deactivate feeder
 */
router.delete("/feeders/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const success = await FeederService.deleteFeeder(Number(id));
        if (!success) {
            return res.status(404).json({ error: "Feeder not found" });
        }
        return res.json({ message: "Feeder deactivated successfully" });
    }
    catch (error) {
        return res.status(500).json({ error: `Failed to delete feeder: ${error}` });
    }
});
/**
 * GET /api/feeders/:feederId/validate - Validate feeder exists and is active
 */
router.get("/feeders/:feederId/validate", async (req, res) => {
    try {
        const { feederId } = req.params;
        const exists = await FeederService.validateFeederExists(feederId);
        return res.json({ feederId, exists, valid: exists });
    }
    catch (error) {
        return res.status(500).json({ error: `Failed to validate feeder: ${error}` });
    }
});
export default router;
