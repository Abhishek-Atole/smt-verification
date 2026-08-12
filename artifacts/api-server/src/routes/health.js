import { Router } from "express";
const router = Router();
router.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
});
// Alias for /health without the 'z'
router.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});
// HEAD request handler for health checks
router.head("/health", (_req, res) => {
    res.status(200).end();
});
export default router;
