import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getPoolStats } from "./admin";
import { getCacheStats } from "../lib/cache";

const router: IRouter = Router();

const startTime = Date.now();

// PRD §6.3 — /health returns status, db ping + latency, pool stats, cache stats, uptime.
// Returns 200 on success, 503 if DB is unreachable. Rate-limited at proxy level.
router.get(["/healthz", "/health"], async (_req, res) => {
  let dbOk = false;
  let dbLatencyMs = -1;

  try {
    const t0 = performance.now();
    await db.execute(sql`SELECT 1`);
    dbLatencyMs = Math.round(performance.now() - t0);
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const pool = dbOk ? getPoolStats() : { total: 0, idle: 0, waiting: 0 };
  const cache = getCacheStats();

  const body: Record<string, unknown> = {
    status: dbOk ? "ok" : "degraded",
    uptimeS: Math.round((Date.now() - startTime) / 1000),
    db: {
      ok: dbOk,
      latencyMs: dbOk ? dbLatencyMs : null,
      pool: dbOk
        ? { total: pool.total, idle: pool.idle, waiting: pool.waiting }
        : null,
    },
    cache: {
      hitRate: {
        bom: cache.hitRate.bom,
        user: cache.hitRate.user,
        machine: cache.hitRate.machine,
      },
      hits: cache.hits,
      misses: cache.misses,
    },
  };

  res.status(dbOk ? 200 : 503).json(body);
});

// HEAD request handler for health checks
router.head("/health", (_req, res) => {
  res.status(200).end();
});

export default router;
