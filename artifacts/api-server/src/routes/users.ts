import { Router, type IRouter } from "express";
import { attachActor, requireRole, type AuthRequest } from "../middleware/auth";

const router: IRouter = Router();

router.use(attachActor);

// Get user listing - QA/engineer only
router.get("/users", requireRole("qa", "supervisor", "admin"), (_req: AuthRequest, res) => {
  // Return a basic user object for the frontend
  // The actual user is managed client-side via localStorage
  res.json({ id: null, name: null, role: null });
});

// HEAD request handler for health checks
router.head("/users", (_req, res) => {
  res.status(200).end();
});

export default router;
