
import { Router, type IRouter } from "express";
import { FeederService } from "../services/feeder-service";
import { attachActor, requireRole, requireAuth, type AuthRequest } from "../middleware/auth";

const router: IRouter = Router();

router.use(attachActor);

/**
 * GET /api/feeders - List all feeders
 */
router.get("/feeders", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const status = req.query.status as string | undefined;
    const feeders = await FeederService.getFeeders(status ? { status } : undefined);
    return res.json(feeders);
  } catch (error) {
    return res.status(500).json({ error: `Failed to fetch feeders: ${error}` });
  }
});

/**
 * GET /api/feeders/:feederId - Get feeder by business ID (e.g., "FDR_001")
 */
router.get("/feeders/:feederId", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { feederId } = req.params;
    const feeder = await FeederService.getFeederByFeederId(feederId as string);

    if (!feeder) {
      return res.status(404).json({ error: `Feeder ${feederId} not found` });
    }

    return res.json(feeder);
  } catch (error) {
    return res.status(500).json({ error: `Failed to fetch feeder: ${error}` });
  }
});

/**
 * POST /api/feeders - Create new feeder
 */
router.post("/feeders", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { feederId, feederType, size, make, description } = req.body;

    if (!feederId || !feederType || !size || !make) {
      return res.status(400).json({
        error:
          "Missing required fields: feederId, feederType, size, make",
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
    } as any);
    // @ts-ignore - FeederService return type

    return res.status(201).json(feeder);
  } catch (error) {
    return res.status(500).json({ error: `Failed to create feeder: ${error}` });
  }
});

/**
 * PUT /api/feeders/:id - Update feeder
 */
router.put("/feeders/:id", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const feeder = await FeederService.updateFeeder(Number(id), updates);

    if (!feeder) {
      return res.status(404).json({ error: "Feeder not found" });
    }

    return res.json(feeder);
  } catch (error) {
    return res.status(500).json({ error: `Failed to update feeder: ${error}` });
  }
});

/**
 * DELETE /api/feeders/:id - Deactivate feeder  
 */
router.delete("/feeders/:id", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const success = await FeederService.deleteFeeder(Number(id));

    if (!success) {
      return res.status(404).json({ error: "Feeder not found" });
    }

    return res.json({ message: "Feeder deactivated successfully" });
  } catch (error) {
    return res.status(500).json({ error: `Failed to delete feeder: ${error}` });
  }
});

/**
 * GET /api/feeders/:feederId/validate - Validate feeder exists and is active
 */
router.get("/feeders/:feederId/validate", requireAuth, async (req: AuthRequest, res) => {
  try {
    const feederId = String(req.params.feederId ?? "").trim();
    const exists = await FeederService.validateFeederExists(feederId);

    return res.json({ feederId, exists, valid: exists });
  } catch (error) {
    return res.status(500).json({ error: `Failed to validate feeder: ${error}` });
  }
});

export default router;
