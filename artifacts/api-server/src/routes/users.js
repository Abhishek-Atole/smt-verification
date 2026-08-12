import { Router } from "express";
const router = Router();
// Get current user endpoint
router.get("/users", (_req, res) => {
    // Return a basic user object for the frontend
    // The actual user is managed client-side via localStorage
    res.json({ id: null, name: null, role: null });
});
// HEAD request handler for health checks
router.head("/users", (_req, res) => {
    res.status(200).end();
});
export default router;
