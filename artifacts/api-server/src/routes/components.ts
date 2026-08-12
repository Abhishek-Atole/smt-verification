import { Router, type IRouter, type Request, type Response } from "express";
import { ComponentService } from "../services/component-service";
import { type InsertComponent } from "@workspace/db/schema";
import { attachActor, requireRole, requireAuth, type AuthRequest } from "../middleware/auth";

type InsertComponentRequest = {
  partId: string;
  mpn: string;
  description?: string;
  manufacturer?: string;
  category?: string;
};

const router: IRouter = Router();

router.use(attachActor);

/**
 * GET /api/components - List all components
 */
router.get("/components", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const comps = await ComponentService.getComponents();
    return res.json(comps);
  } catch (error) {
    return res.status(500).json({ error: `Failed to fetch components: ${error}` });
  }
});

/**
 * GET /api/components/by-mpn/:mpn - Get component by MPN (lookup)
 */
router.get("/components/by-mpn/:mpn", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { mpn } = req.params;
    const component = await ComponentService.getComponentByMpn(mpn as string);

    if (!component) {
      return res.status(404).json({ error: `Component with MPN ${mpn} not found` });
    }

    return res.json(component);
  } catch (error) {
    return res.status(500).json({ error: `Failed to fetch component: ${error}` });
  }
});

/**
 * GET /api/components/by-part-id/:partId - Get component by Part ID
 */
router.get("/components/by-part-id/:partId", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { partId } = req.params;
    const component = await ComponentService.getComponentByPartId(partId as string);

    if (!component) {
      return res
        .status(404)
        .json({ error: `Component with Part ID ${partId} not found` });
    }

    return res.json(component);
  } catch (error) {
    return res.status(500).json({ error: `Failed to fetch component: ${error}` });
  }
});

/**
 * GET /api/components/:id - Get component by database ID
 */
router.get("/components/:id", requireRole("operator", "qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const component = await ComponentService.getComponentById(Number(id));

    if (!component) {
      return res.status(404).json({ error: "Component not found" });
    }

    return res.json(component);
  } catch (error) {
    return res.status(500).json({ error: `Failed to fetch component: ${error}` });
  }
});

/**
 * POST /api/components - Create new component
 */
router.post(
  "/components",
  requireRole("qa", "supervisor", "admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { partId, mpn, description, manufacturer, category } = req.body;

      if (!partId || !mpn) {
        return res
          .status(400)
          .json({ error: "Missing required fields: partId, mpn" });
      }

      const component = await ComponentService.createComponent({
        partId,
        mpn,
        description,
        manufacturer,
        category,
      });

      return res.status(201).json(component);
  } catch (error) {
    return res.status(500).json({ error: `Failed to create component: ${error}` });
  }
});

/**
 * GET /api/components/:id/alternates - Get approved alternates for a component
 */
router.get("/components/:id/alternates", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const alternates = await ComponentService.getApprovedAlternates(
      Number(id)
    );

    return res.json(alternates);
  } catch (error) {
    return res.status(500).json({ error: `Failed to fetch alternates: ${error}` });
  }
});

/**
 * POST /api/components/:id/alternates - Add or approve alternate component
 */
router.post("/components/:id/alternates", requireRole("qa", "supervisor", "admin"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { alternateComponentId, approvedBy, notes } = req.body;

    if (!alternateComponentId) {
      return res.status(400).json({ error: "Missing alternateComponentId" });
    }

    const result = await ComponentService.addAlternate(
      Number(id),
      Number(alternateComponentId),
      approvedBy,
      notes
    );

    return res.status(201).json(result);
  } catch (error) {
    return res.status(500).json({ error: `Failed to add alternate: ${error}` });
  }
});

/**
 * GET /api/components/:mpn/alternate-mpns - Get list of approved alternate MPNs
 */
router.get("/components/:mpn/alternate-mpns", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const mpn = String(req.params.mpn ?? "").trim();
    const alternates = await ComponentService.getApprovedAlternateMpns(mpn);

    res.json({ mpn, alternates });
  } catch (error) {
    res
      .status(500)
      .json({ error: `Failed to fetch alternate MPNs: ${error}` });
  }
});

export default router;
