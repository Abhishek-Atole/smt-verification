import { Router, type IRouter, type Request, type Response } from "express";
import { TimestampService } from "../services/timestamp-service";

const router: IRouter = Router();

/**
 * GET /timestamp
 * Get current server timestamp and sync information
 */
router.get("/timestamp", (_req: Request, res: Response) => {
  try {
    const currentTime = TimestampService.getCurrentTimestamp();
    const syncStatus = TimestampService.getSyncStatus();

    res.json({
      success: true,
      data: {
        serverTime: currentTime.toISOString(),
        serverTimeMs: currentTime.getTime(),
        syncStatus: {
          isSynced: syncStatus.isSynced,
          timeOffset: syncStatus.timeOffset,
          serverStartTime: syncStatus.serverStartTime.toISOString(),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to get server timestamp",
    });
  }
});

/**
 * POST /timestamp/validate
 * Validate that a timestamp is within server time bounds
 */
router.post("/timestamp/validate", (req: Request, res: Response) => {
  try {
    const { timestamp, tolerance } = req.body;

    if (!timestamp) {
      return res.status(400).json({
        success: false,
        error: "timestamp is required",
      });
    }

    const clientTime = new Date(timestamp);
    const serverTime = TimestampService.getCurrentTimestamp();
    const diff = Math.abs(serverTime.getTime() - clientTime.getTime());
    const maxDiff = tolerance || 5000; // Default 5 second tolerance

    res.json({
      success: true,
      data: {
        isValid: diff < maxDiff,
        clientTime: clientTime.toISOString(),
        serverTime: serverTime.toISOString(),
        differencMs: diff,
        tolerance: maxDiff,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to validate timestamp",
    });
  }
});

/**
 * POST /timestamp/sync
 * Initiate NTP sync for time correction
 */
router.post("/timestamp/sync", async (_req: Request, res: Response) => {
  try {
    const result = await TimestampService.syncWithNTP();
    const syncStatus = TimestampService.getSyncStatus();

    res.json({
      success: result,
      data: {
        synced: result,
        status: syncStatus,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to sync timestamp",
    });
  }
});

export default router;
