import { Router } from "express";
import { TraceabilityService } from "../services/traceability-service";
const router = Router();
/**
 * GET /api/traceability/reel/:reelId - Find all scans using a specific reel
 */
router.get("/traceability/reel/:reelId", async (req, res) => {
    try {
        const { reelId } = req.params;
        const scans = await TraceabilityService.findScansForReel(reelId);
        return res.json({
            reelId,
            count: scans.length,
            scans,
        });
    }
    catch (error) {
        return res.status(500).json({ error: `Failed to find reel scans: ${error}` });
    }
});
/**
 * GET /api/traceability/lot/:lotNumber - Find all scans for a lot
 */
router.get("/traceability/lot/:lotNumber", async (req, res) => {
    try {
        const { lotNumber } = req.params;
        const scans = await TraceabilityService.findScansForLot(lotNumber);
        return res.json({
            lotNumber,
            count: scans.length,
            scans,
        });
    }
    catch (error) {
        return res.status(500).json({ error: `Failed to find lot scans: ${error}` });
    }
});
/**
 * GET /api/traceability/date-code/:dateCode - Find all scans for a date code
 */
router.get("/traceability/date-code/:dateCode", async (req, res) => {
    try {
        const { dateCode } = req.params;
        const scans = await TraceabilityService.findScansForDateCode(dateCode);
        return res.json({
            dateCode,
            count: scans.length,
            scans,
        });
    }
    catch (error) {
        return res.status(500).json({ error: `Failed to find date code scans: ${error}` });
    }
});
/**
 * GET /api/traceability/session/:sessionId/trace - Full traceability for a session
 */
router.get("/traceability/session/:sessionId/trace", async (req, res) => {
    try {
        const { sessionId } = req.params;
        const trace = await TraceabilityService.getSessionTraceability(Number(sessionId));
        return res.json({
            sessionId: Number(sessionId),
            count: trace.length,
            trace,
        });
    }
    catch (error) {
        return res.status(500).json({ error: `Failed to get session trace: ${error}` });
    }
});
/**
 * GET /api/traceability/sessions-for-reel/:reelId - Find all sessions using a reel
 */
router.get("/traceability/sessions-for-reel/:reelId", async (req, res) => {
    try {
        const { reelId } = req.params;
        const sessions = await TraceabilityService.findSessionsForReel(reelId);
        res.json({
            reelId,
            count: sessions.length,
            sessions,
        });
    }
    catch (error) {
        res
            .status(500)
            .json({ error: `Failed to find sessions for reel: ${error}` });
    }
});
/**
 * GET /api/traceability/sessions-for-lot/:lotNumber - Find all sessions using a lot
 */
router.get("/traceability/sessions-for-lot/:lotNumber", async (req, res) => {
    try {
        const { lotNumber } = req.params;
        const sessions = await TraceabilityService.findSessionsForLot(lotNumber);
        res.json({
            lotNumber,
            count: sessions.length,
            sessions,
        });
    }
    catch (error) {
        res
            .status(500)
            .json({ error: `Failed to find sessions for lot: ${error}` });
    }
});
/**
 * GET /api/traceability/alternate-usage - Report on alternate component usage
 */
router.get("/traceability/alternate-usage", async (req, res) => {
    try {
        const limit = req.query.limit ? Number(req.query.limit) : 100;
        const report = await TraceabilityService.getAlternateUsageReport(limit);
        res.json({
            count: report.length,
            limit,
            report,
        });
    }
    catch (error) {
        res
            .status(500)
            .json({ error: `Failed to get alternate usage report: ${error}` });
    }
});
export default router;
