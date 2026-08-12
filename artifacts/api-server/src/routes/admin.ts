import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  usersTable,
  loginEventsTable,
  backupRunsTable,
  dbSizeLog,
  auditLogsTable,
} from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { auditLog, verifyAuditChain } from "../lib/auditLogger";
import {
  requireAdminAuth,
  requireAdminIp,
  slideAdminCookie,
  signAdminToken,
  getAdminCookieOptions,
  ADMIN_TOKEN_COOKIE,
  type AdminAuthRequest,
} from "../middleware/adminAuth";
import { revokeUser } from "../lib/tokenBlacklist";
import { snapshot as metricsSnapshot, latest as metricsLatest } from "../lib/metricsRingBuffer";
import { checkLockout, recordFailure, recordSuccess } from "../lib/lockoutStore";
import { userCache, buildKey, getCached, invalidatePrefix, setCached, getCacheStats } from "../lib/cache";

function invalidateUserCache(): void {
  invalidatePrefix(userCache, "user:");
}

const router: IRouter = Router();

// All admin routes go through the IP allowlist first. Login is the only
// route that does NOT require an admin cookie (it issues the cookie).
// Path-scoped to /admin/* so non-admin requests (e.g. /feeders) that flow
// through this router via routes/index.ts fall through cleanly.
router.use(requireAdminIp);

// Debug: test if admin router is reachable
router.get("/ping", (_req, res) => res.json({ pong: true }));

// ─── POST /api/admin/auth/login ──────────────────────────────────────────
// Separate JWT secret, separate cookie. Operator/QA/supervisor tokens are
// rejected here — only the `admin` role can authenticate via this endpoint.
router.post("/auth/login", async (req, res) => {
  const body = req.body as { username?: unknown; password?: unknown } | null;
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!username || username.length > 255 || !password || password.length > 128) {
    res.status(400).json({ error: "Invalid login payload" });
    return;
  }

  // PRD §2.5 — admin login bucket: 3 attempts / 15 min, 30-min lockout.
  // Keyed by `${ip}:${username}` so a single hostile IP can't burn the
  // lockout for every legitimate admin on the same VPN.
  const lockoutKey = `${req.ip ?? "unknown"}:${username.toLowerCase()}`;
  const lockoutStatus = checkLockout("admin-login", lockoutKey);
  if (lockoutStatus.locked) {
    await recordLoginEvent({ employeeId: username, ip: req.ip, ua: req.get("user-agent"), result: "failure", reason: "locked" });
    const retryAfter = lockoutStatus.until ? Math.max(0, Math.ceil((lockoutStatus.until - Date.now()) / 1000)) : undefined;
    if (retryAfter !== undefined) res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "rate_limit_admin_login", message: "Too many failed admin attempts. Try again later." });
    return;
  }

  const [user] = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    role: usersTable.role,
    employee_id: usersTable.employee_id,
    password_hash: usersTable.password_hash,
  })
    .from(usersTable)
    .where(and(eq(usersTable.role, "admin"), eq(usersTable.employee_id, username)))
    .limit(1);

  if (!user || !user.password_hash) {
    const failure = recordFailure("admin-login", lockoutKey);
    await recordLoginEvent({ employeeId: username, ip: req.ip, ua: req.get("user-agent"), result: "failure", reason: failure.justLocked ? "locked" : "unknown_user" });
    if (failure.justLocked) {
      // PRD §2.5 "alert" — log at error level AND chain into audit_logs.
      req.log.error({ admin: true, locked: true, username, ip: req.ip }, "Admin login lockout triggered (unknown user)");
      await auditLog({ event: "SECURITY_ADMIN_LOCKED", detail: `username=${username} reason=unknown_user_threshold`, ip: req.ip });
    }
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const passwordValid = await bcrypt.compare(password, user.password_hash);
  if (!passwordValid) {
    const failure = recordFailure("admin-login", lockoutKey);
    await recordLoginEvent({ userId: user.id, employeeId: username, ip: req.ip, ua: req.get("user-agent"), result: "failure", reason: failure.justLocked ? "locked" : "password_mismatch" });
    if (failure.justLocked) {
      req.log.error({ admin: true, locked: true, username, userId: user.id, ip: req.ip }, "Admin login lockout triggered (password threshold)");
      await auditLog({ event: "SECURITY_ADMIN_LOCKED", operatorId: user.id, detail: `username=${username} reason=password_threshold`, ip: req.ip });
    }
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  recordSuccess("admin-login", lockoutKey);
  const token = signAdminToken({ adminId: user.id, username: user.name || username });
  res.cookie(ADMIN_TOKEN_COOKIE, token, getAdminCookieOptions(req));
  await recordLoginEvent({ userId: user.id, employeeId: username, ip: req.ip, ua: req.get("user-agent"), result: "success" });
  await auditLog({ event: "LOGIN_SUCCESS", operatorId: user.id, detail: "admin_portal", ip: req.ip });
  res.status(200).json({ adminId: user.id, username: user.name || username });
});

// ─── POST /api/admin/auth/logout ─────────────────────────────────────────
router.post("/auth/logout", requireAdminAuth, async (req: AdminAuthRequest, res: Response) => {
  res.clearCookie(ADMIN_TOKEN_COOKIE, getAdminCookieOptions(req));
  await auditLog({ event: "LOGOUT", operatorId: req.admin?.adminId, detail: "admin_portal", ip: req.ip });
  res.status(200).json({ success: true });
});

// ─── GET /api/admin/auth/me ──────────────────────────────────────────────
router.get("/auth/me", requireAdminAuth, slideAdminCookie, (req: AdminAuthRequest, res: Response) => {
  res.json({ adminId: req.admin!.adminId, username: req.admin!.username });
});

// ─── User management ─────────────────────────────────────────────────────

router.get("/users", requireAdminAuth, slideAdminCookie, async (_req, res) => {
  // TRD §8.1 — user cache, 30s TTL, admin role only (no other role hits this).
  const cacheKey = buildKey("user", "admin", "list:all");
  const cached = getCached<{ users: unknown[] }>("user", cacheKey);
  if (cached !== undefined) {
    res.json(cached);
    return;
  }

  const rows = await db.execute<{
    id: string; name: string; role: string; employee_id: string;
    is_active: boolean; created_at: Date;
  }>(sql`SELECT id, name, role, employee_id, is_active, created_at
         FROM users ORDER BY name`);
  const payload = {
    users: rows.rows.map((r) => ({
      id: r.id, name: r.name, role: r.role,
      employeeId: r.employee_id, isActive: r.is_active, createdAt: r.created_at,
    })),
  };
  setCached("user", cacheKey, payload);
  res.json(payload);
});

router.post("/users", requireAdminAuth, slideAdminCookie, async (req: AdminAuthRequest, res: Response) => {
  const body = req.body as { name?: unknown; employeeId?: unknown; role?: unknown; password?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const employeeId = typeof body?.employeeId === "string" ? body.employeeId.trim() : "";
  const role = body?.role;
  const password = typeof body?.password === "string" ? body.password : "";
  const validRoles = ["operator", "qa", "supervisor", "admin", "storekeeper"];
  if (!name || !employeeId || typeof role !== "string" || !validRoles.includes(role) || password.length < 8 || password.length > 128) {
    res.status(400).json({ error: "Invalid user payload" });
    return;
  }
  const password_hash = await bcrypt.hash(password, 12);
  try {
    const [created] = await db.insert(usersTable).values({
      name, role, employee_id: employeeId, password_hash, user_type: role,
    }).returning({ id: usersTable.id, name: usersTable.name, role: usersTable.role, employeeId: usersTable.employee_id });
    invalidateUserCache();
    await auditLog({ event: "USER_CREATED", operatorId: req.admin?.adminId, detail: `user_created:${created.id}`, ip: req.ip });
    res.status(201).json(created);
  } catch (err) {
    logger.warn({ err }, "user create failed");
    res.status(409).json({ error: "User exists or invalid" });
  }
});

router.patch("/users/:id", requireAdminAuth, slideAdminCookie, async (req: AdminAuthRequest, res: Response) => {
  const id = String(req.params.id);
  const body = req.body as { name?: unknown; role?: unknown; isActive?: unknown } | null;
  const sets: Array<ReturnType<typeof sql>> = [];
  if (typeof body?.name === "string" && body.name.trim()) sets.push(sql`name = ${body.name.trim()}`);
  if (typeof body?.role === "string" && ["operator","qa","supervisor","admin","storekeeper"].includes(body.role)) sets.push(sql`role = ${body.role}::"UserRole"`);
  if (typeof body?.isActive === "boolean") {
    sets.push(sql`is_active = ${body.isActive}`);
    // Disabling a user must also revoke their live token.
    if (body.isActive === false) revokeUser(id);
  }
  if (sets.length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  const updated = await db.execute<{ id: string }>(
    sql`UPDATE users SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING id`,
  );
  if (updated.rows.length === 0) { res.status(404).json({ error: "User not found" }); return; }
  invalidateUserCache();
  await auditLog({ event: "USER_UPDATED", operatorId: req.admin?.adminId, detail: `user_updated:${id}`, ip: req.ip });
  res.json({ id });
});

router.post("/users/:id/reset-password", requireAdminAuth, slideAdminCookie, async (req: AdminAuthRequest, res: Response) => {
  const id = String(req.params.id);
  const body = req.body as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < 8 || password.length > 128) {
    res.status(400).json({ error: "Password must be 8-128 chars" });
    return;
  }
  const password_hash = await bcrypt.hash(password, 12);
  const updated = await db.update(usersTable).set({ password_hash }).where(eq(usersTable.id, id)).returning({ id: usersTable.id });
  if (updated.length === 0) { res.status(404).json({ error: "User not found" }); return; }
  // Force the user off — their existing token is revoked.
  revokeUser(id);
  invalidateUserCache();
  await auditLog({ event: "USER_PASSWORD_RESET", operatorId: req.admin?.adminId, detail: `user_password_reset:${id}`, ip: req.ip });
  res.json({ id });
});

router.delete("/users/:id", requireAdminAuth, slideAdminCookie, async (req: AdminAuthRequest, res: Response) => {
  const id = String(req.params.id);
  try {
    const deleted = await db.delete(usersTable).where(eq(usersTable.id, id)).returning({ id: usersTable.id });
    if (deleted.length === 0) { res.status(404).json({ error: "User not found" }); return; }
    revokeUser(id);
    invalidateUserCache();
    await auditLog({ event: "USER_DELETED", operatorId: req.admin?.adminId, detail: `user_deleted:${id}`, ip: req.ip });
    res.json({ id });
  } catch (err) {
    // FK RESTRICT violation — user has dependent rows. Per PRD line 204-205,
    // surface as 409 and direct the admin to Disable instead.
    logger.warn({ err, userId: id }, "user delete blocked by FK");
    res.status(409).json({ error: "conflict_user_has_references", message: "User has dependent records; disable instead of deleting." });
  }
});

// ─── Session revocation (U17) ───────────────────────────────────────────
router.delete("/sessions/:userId", requireAdminAuth, slideAdminCookie, async (req: AdminAuthRequest, res: Response) => {
  const userId = String(req.params.userId);
  revokeUser(userId);
  await auditLog({ event: "SESSION_REVOKED", operatorId: req.admin?.adminId, detail: `session_revoked:${userId}`, ip: req.ip });
  res.json({ userId, revoked: true });
});

// ─── Login activity ──────────────────────────────────────────────────────
router.get("/login-events", requireAdminAuth, slideAdminCookie, async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 200), 1000);
  const rows = await db.select().from(loginEventsTable).orderBy(desc(loginEventsTable.createdAt)).limit(limit);
  res.json({ events: rows });
});

// ─── Metrics (U16) ───────────────────────────────────────────────────────
router.get("/metrics/history", requireAdminAuth, slideAdminCookie, (_req, res) => {
  res.json({ samples: metricsSnapshot() });
});
router.get("/metrics/latest", requireAdminAuth, slideAdminCookie, (_req, res) => {
  const sample = metricsLatest();
  // TRD §8.4 — expose cache hit/miss counters here so the admin pane can
  // surface the > 70 % hit-rate target without a separate endpoint.
  const cache = getCacheStats();
  res.json({ sample: sample ?? null, cache });
});

// ─── DB size trend (U18) ────────────────────────────────────────────────
router.get("/db-size", requireAdminAuth, slideAdminCookie, async (_req, res) => {
  const rows = await db.select().from(dbSizeLog).orderBy(desc(dbSizeLog.date)).limit(30);
  const maxMb = Number(process.env.DB_MAX_SIZE_MB ?? 5000);
  const latest = rows[0]?.sizeBytes ?? 0;
  const ratio = maxMb > 0 ? latest / (maxMb * 1024 * 1024) : 0;
  res.json({ samples: rows.reverse(), maxBytes: maxMb * 1024 * 1024, alertOver80: ratio > 0.8 });
});

// ─── Audit chain integrity (U6) ─────────────────────────────────────────
router.get("/audit/integrity", requireAdminAuth, slideAdminCookie, async (_req, res) => {
  const result = await verifyAuditChain();
  res.json(result);
});

// ─── Audit log viewer ────────────────────────────────────────────────────
// Read-only projection of the audit_logs chain for the admin portal. Does
// NOT call auditLog() (reads are not audited) and does NOT touch chain_hash.
router.get("/audit/logs", requireAdminAuth, slideAdminCookie, async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 200), 1000);
  const rows = await db.select({
    id: auditLogsTable.id,
    action: auditLogsTable.action,
    entityId: auditLogsTable.entityId,
    changedBy: auditLogsTable.changedBy,
    description: auditLogsTable.description,
    createdAt: auditLogsTable.createdAt,
  }).from(auditLogsTable).orderBy(desc(auditLogsTable.id)).limit(limit);
  res.json({ logs: rows });
});

// ─── Backups (Phase 1) ─────────────────────────────────────────────────
router.get("/backups", requireAdminAuth, slideAdminCookie, async (_req, res) => {
  const rows = await db.select().from(backupRunsTable).orderBy(desc(backupRunsTable.startedAt)).limit(100);
  res.json({ runs: rows });
});

router.post("/backups/run", requireAdminAuth, slideAdminCookie, async (req: AdminAuthRequest, res: Response) => {
  const { runBackupNow } = await import("../services/backup-service");
  try {
    const run = await runBackupNow({ triggeredBy: req.admin!.adminId });
    res.status(202).json(run);
  } catch (err) {
    logger.error({ err }, "backup run failed");
    res.status(500).json({ error: "backup_failed" });
  }
});

// ─── helpers ─────────────────────────────────────────────────────────────
async function recordLoginEvent(input: {
  userId?: string; employeeId?: string; ip?: string; ua?: string; result: "success" | "failure"; reason?: string;
}): Promise<void> {
  try {
    await db.insert(loginEventsTable).values({
      userId: input.userId,
      employeeId: input.employeeId,
      ip: input.ip,
      userAgent: input.ua,
      result: input.result,
      failureReason: input.reason,
    });
  } catch (err) {
    logger.warn({ err }, "login_event insert failed");
  }
}

// Pool reporter for /api/health and /admin/metrics — exposed so health.ts can read it.
export function getPoolStats() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

// Marker re-export for tests that need the sql tag
export { sql };

export default router;
