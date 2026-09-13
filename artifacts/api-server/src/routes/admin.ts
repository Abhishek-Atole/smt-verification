import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import path from "node:path";
import { existsSync } from "node:fs";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { getBackupStorageStatus, backupDir, estimateNextBackupAt } from "../services/backup-service";
import {
  usersTable,
  loginEventsTable,
  backupRunsTable,
  dbSizeLog,
  auditLogsTable,
  devicesTable,
  securitySettingsTable,
  refreshTokensTable,
  reportOutputSettingsTable,
} from "@workspace/db/schema";
import type { DeviceType, DeviceStatus } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { auditLog, verifyAuditChain } from "../lib/auditLogger";
import {
  requireAdminAuth,
  requireAdminIp,
  requireCredentialsChanged,
  slideAdminCookie,
  signAdminToken,
  getAdminCookieOptions,
  ADMIN_TOKEN_COOKIE,
  type AdminAuthRequest,
} from "../middleware/adminAuth";
import { revokeUser } from "../lib/tokenBlacklist";
import { revokeAllForUser } from "../lib/refreshStore";
import { invalidateDeviceCache, invalidateSecuritySettingsCache } from "../lib/deviceStore";
import { invalidateReportOutputSettingsCache } from "../lib/reportOutputStore";
import { isValidIpOrCidr } from "../lib/ipMatch";
import { snapshot as metricsSnapshot, latest as metricsLatest } from "../lib/metricsRingBuffer";
import { checkLockout, recordFailure, recordSuccess } from "../lib/lockoutStore";
import { userCache, buildKey, getCached, invalidatePrefix, setCached, getCacheStats } from "../lib/cache";
import { pushNotification, type NotificationType } from "../lib/notify";

const DEVICE_TYPES: DeviceType[] = ["end_device", "admin_device", "store_device", "server"];
const DEVICE_STATUSES: DeviceStatus[] = ["active", "blocked", "pending"];

function invalidateUserCache(): void {
  invalidatePrefix(userCache, "user:");
}

// Number of active admins OTHER than `userId`. Used by the last-admin guard:
// a change that removes an active admin is rejected when it would leave ZERO
// active admins (everyone locked out of the portal).
async function activeAdminCountExcluding(userId: string): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.role, "admin"),
        eq(usersTable.is_active, true),
        sql`${usersTable.id} <> ${userId}`,
      ),
    );
  return row?.c ?? 0;
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

  // Module 10.4 — admin may only authenticate from an admin_device (or the
  // host itself over loopback → device_type "server"; or during bootstrap when
  // no devices are registered yet → deviceType undefined). A valid admin
  // credential presented from an end/store device is rejected.
  const deviceType = (req as { deviceType?: DeviceType }).deviceType;
  if (deviceType !== undefined && deviceType !== "admin_device" && deviceType !== "server") {
    await auditLog({ event: "SECURITY_LOGIN_DEVICE_MISMATCH", detail: `admin_portal username=${username} device_type=${deviceType}`, ip: req.ip });
    await recordLoginEvent({ employeeId: username, ip: req.ip, ua: req.get("user-agent"), result: "failure", reason: "device_role_mismatch" });
    res.status(403).json({ error: "device_role_mismatch", message: "Admin login is not permitted from this device." });
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
    must_change_password: usersTable.must_change_password,
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
  const mustChange = user.must_change_password === true;
  const token = signAdminToken({ adminId: user.id, username: user.name || username, mustChange });
  res.cookie(ADMIN_TOKEN_COOKIE, token, getAdminCookieOptions(req));
  await recordLoginEvent({ userId: user.id, employeeId: username, ip: req.ip, ua: req.get("user-agent"), result: "success" });
  await auditLog({ event: "LOGIN_SUCCESS", operatorId: user.id, detail: "admin_portal", ip: req.ip });
  res.status(200).json({ adminId: user.id, username: user.name || username, mustChange });
});

// ─── POST /api/admin/auth/logout ─────────────────────────────────────────
router.post("/auth/logout", requireAdminAuth, async (req: AdminAuthRequest, res: Response) => {
  res.clearCookie(ADMIN_TOKEN_COOKIE, getAdminCookieOptions(req));
  await auditLog({ event: "LOGOUT", operatorId: req.admin?.adminId, detail: "admin_portal", ip: req.ip });
  res.status(200).json({ success: true });
});

// ─── GET /api/admin/auth/me ──────────────────────────────────────────────
router.get("/auth/me", requireAdminAuth, slideAdminCookie, (req: AdminAuthRequest, res: Response) => {
  res.json({ adminId: req.admin!.adminId, username: req.admin!.username, mustChange: req.admin!.mustChange });
});

// ─── POST /api/admin/auth/change-credentials ─────────────────────────────
// First-login setup: the seeded admin (must_change_password=true) is forced to
// pick a NEW username AND a NEW password before anything else in the Control
// Panel works (see requireCredentialsChanged hard gate below). Requires the
// current (temporary) password. Deliberately NOT gated by
// requireCredentialsChanged — this is the one route that clears the flag.
router.post("/auth/change-credentials", requireAdminAuth, async (req: AdminAuthRequest, res: Response) => {
  const body = req.body as { newUsername?: unknown; currentPassword?: unknown; newPassword?: unknown } | null;
  const newUsername = typeof body?.newUsername === "string" ? body.newUsername.trim() : "";
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  const adminId = req.admin!.adminId;

  if (newUsername.length < 3 || newUsername.length > 255) {
    res.status(400).json({ error: "invalid_username", message: "Username must be 3–255 characters." });
    return;
  }
  if (newPassword.length < 12 || newPassword.length > 128) {
    res.status(400).json({ error: "invalid_password", message: "Password must be 12–128 characters." });
    return;
  }

  const [user] = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    employee_id: usersTable.employee_id,
    password_hash: usersTable.password_hash,
  })
    .from(usersTable)
    .where(and(eq(usersTable.id, adminId), eq(usersTable.role, "admin")))
    .limit(1);
  if (!user || !user.password_hash) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const currentValid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!currentValid) {
    res.status(401).json({ error: "invalid_current_password", message: "Current password is incorrect." });
    return;
  }

  // Enforce that BOTH credentials actually change (the whole point of the gate).
  if (newUsername.toLowerCase() === (user.employee_id ?? "").toLowerCase()) {
    res.status(400).json({ error: "username_unchanged", message: "Pick a username different from the current one." });
    return;
  }
  if (await bcrypt.compare(newPassword, user.password_hash)) {
    res.status(400).json({ error: "password_unchanged", message: "Pick a password different from the current one." });
    return;
  }

  // employee_id is NOT unique at the DB level on client installs (drizzle push +
  // ops migrations don't add the constraint), so enforce uniqueness explicitly —
  // otherwise the admin could silently claim another user's login id. Compared
  // case-insensitively to avoid confusing near-duplicates.
  const clash = await db.execute<{ id: string }>(
    sql`SELECT id FROM users WHERE lower(employee_id) = lower(${newUsername}) AND id <> ${adminId} LIMIT 1`,
  );
  if (clash.rows.length > 0) {
    res.status(409).json({ error: "username_taken", message: "That username is already in use." });
    return;
  }

  const password_hash = await bcrypt.hash(newPassword, 12);
  try {
    const updated = await db.update(usersTable)
      .set({ employee_id: newUsername, password_hash, must_change_password: false })
      .where(eq(usersTable.id, adminId))
      .returning({ id: usersTable.id });
    if (updated.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }
  } catch (err) {
    // employee_id is UNIQUE — a collision means the name is taken.
    logger.warn({ err }, "admin change-credentials failed");
    res.status(409).json({ error: "username_taken", message: "That username is already in use." });
    return;
  }
  invalidateUserCache();

  // Re-issue the cookie with the flag cleared so the gate lifts on this response.
  const token = signAdminToken({ adminId, username: user.name || newUsername, mustChange: false });
  res.cookie(ADMIN_TOKEN_COOKIE, token, getAdminCookieOptions(req));
  await auditLog({ event: "ADMIN_CREDENTIALS_CHANGED", operatorId: adminId, detail: "first_login_setup", ip: req.ip });
  res.status(200).json({ adminId, username: user.name || newUsername, mustChange: false });
});

// ─── Hard gate ───────────────────────────────────────────────────────────
// Everything below requires a first-login admin to have completed setup. The
// auth routes above (login/logout/me/change-credentials) are intentionally
// declared before this line so they stay reachable while mustChange is true.
router.use(requireAdminAuth, requireCredentialsChanged);

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
  const body = req.body as { name?: unknown; role?: unknown; isActive?: unknown; employeeId?: unknown } | null;

  // The target row is needed both for guards (self / last-admin) and for a
  // clear 404, so read it before building the UPDATE.
  const [target] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      role: usersTable.role,
      employeeId: usersTable.employee_id,
      isActive: usersTable.is_active,
    })
    .from(usersTable)
    .where(eq(usersTable.id, id));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }

  const sets: Array<ReturnType<typeof sql>> = [];

  if (typeof body?.name === "string" && body.name.trim()) sets.push(sql`name = ${body.name.trim()}`);

  // Role is validated first so the guard below reasons about a valid value.
  let roleChange: string | null = null;
  if (body?.role !== undefined) {
    if (typeof body.role !== "string" || !["operator","qa","supervisor","admin","storekeeper"].includes(body.role)) {
      res.status(400).json({ error: "invalid_role" });
      return;
    }
    roleChange = body.role;
  }

  const disable = body?.isActive === false;

  // employeeId (login) — editable per admin; enforce case-insensitive uniqueness.
  let employeeIdChange: string | null = null;
  if (body?.employeeId !== undefined) {
    if (typeof body.employeeId !== "string" || !body.employeeId.trim() || body.employeeId.trim().length > 255) {
      res.status(400).json({ error: "invalid_employee_id", message: "employeeId must be a non-empty string up to 255 chars." });
      return;
    }
    employeeIdChange = body.employeeId.trim();
    const [dup] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          sql`upper(${usersTable.employee_id}) = ${employeeIdChange.toUpperCase()}`,
          sql`${usersTable.id} <> ${id}`,
        ),
      )
      .limit(1);
    if (dup) { res.status(409).json({ error: "conflict_employee_id", message: "Another user already uses that Employee ID." }); return; }
  }

  // Self guard: an admin may fix their own name/employee ID but must not be able
  // to disable or demote their own account (would lock themselves out).
  const actorIsTarget = req.admin?.adminId === id;
  if (actorIsTarget && (disable || roleChange !== null)) {
    res.status(409).json({ error: "self_modification", message: "You cannot disable or change the role of your own account." });
    return;
  }

  // Last-admin guard: removing an ACTIVE admin is only allowed when another
  // active admin would remain.
  const removingActiveAdmin =
    target.isActive && target.role === "admin" && (disable || (roleChange !== null && roleChange !== "admin"));
  if (removingActiveAdmin && (await activeAdminCountExcluding(id)) === 0) {
    res.status(409).json({ error: "last_admin", message: "Cannot remove the last active admin account." });
    return;
  }

  if (roleChange !== null) sets.push(sql`role = ${roleChange}::"UserRole"`);
  // user_type mirrors role (create sets it; keep them consistent on role edits).
  if (roleChange !== null) sets.push(sql`user_type = ${roleChange}`);
  if (typeof body?.isActive === "boolean") {
    sets.push(sql`is_active = ${body.isActive}`);
    // Disabling a user must also revoke their live token.
    if (body.isActive === false) revokeUser(id);
  }
  // Demoting a current admin removes their admin access immediately (otherwise
  // the still-valid admin cookie would last up to its absolute TTL).
  if (target.role === "admin" && roleChange !== null && roleChange !== "admin") revokeUser(id);

  if (employeeIdChange !== null) sets.push(sql`employee_id = ${employeeIdChange}`);

  if (sets.length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  const changedFields = [
    typeof body?.name === "string" ? "name" : null,
    roleChange !== null ? "role" : null,
    typeof body?.isActive === "boolean" ? "is_active" : null,
    employeeIdChange !== null ? "employee_id" : null,
  ].filter(Boolean).join(",");
  await db.execute<{ id: string }>(
    sql`UPDATE users SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`,
  );
  invalidateUserCache();
  await auditLog({
    event: "USER_UPDATED",
    operatorId: req.admin?.adminId,
    detail: `user_updated:${id} fields=${changedFields}`,
    ip: req.ip,
  });
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
  // PRD §Phase-1:203 — an admin reset sets a temporary password, so re-arm the
  // forced-change flag: the user must set their own password on next login,
  // exactly like first login (APP-FLOW §5). Without this, a user whose flag was
  // already cleared would keep using the admin's default indefinitely.
  const updated = await db.update(usersTable).set({ password_hash, must_change_password: true }).where(eq(usersTable.id, id)).returning({ id: usersTable.id });
  if (updated.length === 0) { res.status(404).json({ error: "User not found" }); return; }
  // Force the user off — their existing token is revoked.
  revokeUser(id);
  invalidateUserCache();
  await auditLog({ event: "USER_PASSWORD_RESET", operatorId: req.admin?.adminId, detail: `user_password_reset:${id}`, ip: req.ip });
  res.json({ id });
});

router.delete("/users/:id", requireAdminAuth, slideAdminCookie, async (req: AdminAuthRequest, res: Response) => {
  const id = String(req.params.id);
  const actorId = req.admin?.adminId;
  const [target] = await db
    .select({ id: usersTable.id, role: usersTable.role, isActive: usersTable.is_active })
    .from(usersTable)
    .where(eq(usersTable.id, id));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  // Self guard: an admin must not delete their own account.
  if (actorId === id) {
    res.status(409).json({ error: "self_modification", message: "You cannot delete your own account." });
    return;
  }
  // Last-admin guard.
  if (target.role === "admin" && target.isActive && (await activeAdminCountExcluding(id)) === 0) {
    res.status(409).json({ error: "last_admin", message: "Cannot remove the last active admin account." });
    return;
  }
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
  // Without BACKUP_DIR, runBackupNow() throws and we'd 500. Surface it clearly
  // instead — the Data Management page already shows the red "backups OFF"
  // banner, so a create attempt here should explain rather than look broken.
  const status = await getBackupStorageStatus();
  if (!status.configured) {
    res.status(409).json({ error: "backup_dir_unset", message: "BACKUP_DIR is not configured on this server." });
    return;
  }
  try {
    const run = await runBackupNow({ triggeredBy: req.admin!.adminId });
    res.status(202).json(run);
  } catch (err) {
    logger.error({ err }, "backup run failed");
    res.status(500).json({ error: "backup_failed" });
  }
});

// Backup storage health for the Data Management page: is BACKUP_DIR set, is it
// on the same disk as the DB, what is the retention window and next scheduled
// run. Admin-only; the page renders it as a health banner.
router.get("/backups/storage", requireAdminAuth, slideAdminCookie, async (_req, res) => {
  const status = await getBackupStorageStatus();
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
  const scheduledHourLocal = Number(process.env.BACKUP_HOUR_LOCAL ?? 2);
  res.json({
    ...status,
    retentionDays,
    scheduledHourLocal,
    nextScheduledAt: estimateNextBackupAt(scheduledHourLocal).toISOString(),
  });
});

// Download a completed backup's .sql so an admin can copy it off the machine
// (NAS/USB). Guarded: only a `success` run, resolved path must stay inside
// BACKUP_DIR, and the file must still exist on disk.
router.get("/backups/:id/file", requireAdminAuth, slideAdminCookie, async (req: AdminAuthRequest, res: Response) => {
  const id = String(req.params.id);
  const [run] = await db
    .select({ status: backupRunsTable.status, filePath: backupRunsTable.filePath })
    .from(backupRunsTable)
    .where(eq(backupRunsTable.id, id));
  if (!run || run.status !== "success" || !run.filePath) {
    res.status(404).json({ error: "backup_file_not_found", message: "No completed backup exists for that id." });
    return;
  }
  let dir: string;
  try {
    dir = backupDir();
  } catch {
    res.status(409).json({ error: "backup_dir_unset", message: "BACKUP_DIR is not configured on this server." });
    return;
  }
  const resolvedDir = path.resolve(dir);
  const file = path.resolve(run.filePath);
  if (!file.startsWith(resolvedDir + path.sep)) {
    res.status(404).json({ error: "backup_file_not_found" });
    return;
  }
  if (!existsSync(file)) {
    res.status(404).json({ error: "backup_file_missing", message: "The file is no longer on disk (e.g. pruned by retention)." });
    return;
  }
  res.download(file, path.basename(file));
});


// ─── Module 10.2 — Device / IP allow-list management ────────────────────
// CRUD over the devices table. Every mutation invalidates the deviceStore
// cache (so the per-request guard sees the change within one request, not one
// cache-TTL later) and writes an audit event. Block/unblock is a status PATCH.

router.get("/devices", requireAdminAuth, slideAdminCookie, async (_req, res) => {
  const rows = await db.select().from(devicesTable).orderBy(devicesTable.deviceType, devicesTable.deviceName);
  // Module 10.2 — flag rows whose stored allowed_ip fails the strict validator
  // (written before the 2026-08-30 fix). Computed server-side so the admin UI
  // badge and the save-time rejection use the SAME validator and cannot drift.
  // Additive field; nothing is modified or hidden — see decision.md 2026-08-30.
  res.json({
    devices: rows.map((row) => ({ ...row, allowedIpValid: isValidIpOrCidr(row.allowedIp) })),
  });
});

router.post("/devices", requireAdminAuth, slideAdminCookie, async (req: AdminAuthRequest, res: Response) => {
  const body = req.body as {
    deviceType?: unknown; deviceName?: unknown; allowedIp?: unknown; macAddress?: unknown; status?: unknown;
  } | null;
  const deviceType = body?.deviceType;
  const deviceName = typeof body?.deviceName === "string" ? body.deviceName.trim() : "";
  const allowedIp = typeof body?.allowedIp === "string" ? body.allowedIp.trim() : "";
  const macAddress = typeof body?.macAddress === "string" && body.macAddress.trim() ? body.macAddress.trim() : null;
  const status = body?.status;

  if (typeof deviceType !== "string" || !DEVICE_TYPES.includes(deviceType as DeviceType)) {
    res.status(400).json({ error: "invalid_device_type" });
    return;
  }
  if (!deviceName || deviceName.length > 120) {
    res.status(400).json({ error: "invalid_device_name" });
    return;
  }
  if (!isValidIpOrCidr(allowedIp)) {
    res.status(400).json({ error: "invalid_allowed_ip", message: "allowedIp must be a valid IP or CIDR range." });
    return;
  }
  const statusValue: DeviceStatus =
    typeof status === "string" && DEVICE_STATUSES.includes(status as DeviceStatus) ? (status as DeviceStatus) : "pending";

  const [created] = await db.insert(devicesTable).values({
    deviceType: deviceType as DeviceType,
    deviceName,
    allowedIp,
    macAddress,
    status: statusValue,
    createdBy: req.admin?.adminId ?? null,
    lastModifiedBy: req.admin?.adminId ?? null,
  }).returning();
  invalidateDeviceCache();
  await auditLog({ event: "DEVICE_CREATED", operatorId: req.admin?.adminId, detail: `device=${created.id} type=${created.deviceType} ip=${created.allowedIp} status=${created.status}`, ip: req.ip });
  res.status(201).json(created);
});

router.patch("/devices/:id", requireAdminAuth, slideAdminCookie, async (req: AdminAuthRequest, res: Response) => {
  const id = String(req.params.id);
  const body = req.body as {
    deviceType?: unknown; deviceName?: unknown; allowedIp?: unknown; macAddress?: unknown; status?: unknown;
  } | null;
  const patch: Partial<{
    deviceType: DeviceType; deviceName: string; allowedIp: string; macAddress: string | null; status: DeviceStatus;
    lastModifiedBy: string | null; lastModifiedAt: Date;
  }> = {};

  if (typeof body?.deviceType === "string") {
    if (!DEVICE_TYPES.includes(body.deviceType as DeviceType)) { res.status(400).json({ error: "invalid_device_type" }); return; }
    patch.deviceType = body.deviceType as DeviceType;
  }
  if (typeof body?.deviceName === "string") {
    if (!body.deviceName.trim() || body.deviceName.trim().length > 120) { res.status(400).json({ error: "invalid_device_name" }); return; }
    patch.deviceName = body.deviceName.trim();
  }
  if (typeof body?.allowedIp === "string") {
    if (!isValidIpOrCidr(body.allowedIp.trim())) { res.status(400).json({ error: "invalid_allowed_ip" }); return; }
    patch.allowedIp = body.allowedIp.trim();
  }
  if (body?.macAddress !== undefined) {
    patch.macAddress = typeof body.macAddress === "string" && body.macAddress.trim() ? body.macAddress.trim() : null;
  }
  if (typeof body?.status === "string") {
    if (!DEVICE_STATUSES.includes(body.status as DeviceStatus)) { res.status(400).json({ error: "invalid_status" }); return; }
    patch.status = body.status as DeviceStatus;
  }
  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "No valid fields to update" }); return; }

  patch.lastModifiedBy = req.admin?.adminId ?? null;
  patch.lastModifiedAt = new Date();
  const [updated] = await db.update(devicesTable).set(patch).where(eq(devicesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Device not found" }); return; }
  invalidateDeviceCache();
  await auditLog({ event: "DEVICE_UPDATED", operatorId: req.admin?.adminId, detail: `device=${id} fields=${Object.keys(patch).join(",")} status=${updated.status}`, ip: req.ip });
  res.json(updated);
});

router.delete("/devices/:id", requireAdminAuth, slideAdminCookie, async (req: AdminAuthRequest, res: Response) => {
  const id = String(req.params.id);
  const [deleted] = await db.delete(devicesTable).where(eq(devicesTable.id, id)).returning({ id: devicesTable.id });
  if (!deleted) { res.status(404).json({ error: "Device not found" }); return; }
  invalidateDeviceCache();
  await auditLog({ event: "DEVICE_DELETED", operatorId: req.admin?.adminId, detail: `device=${id}`, ip: req.ip });
  res.json({ id });
});

// ─── Module 10.3 — Security settings (single-row) ───────────────────────
router.get("/security-settings", requireAdminAuth, slideAdminCookie, async (_req, res) => {
  const [row] = await db.select().from(securitySettingsTable).where(eq(securitySettingsTable.id, true));
  res.json({ settings: row ?? null });
});

router.patch("/security-settings", requireAdminAuth, slideAdminCookie, async (req: AdminAuthRequest, res: Response) => {
  const body = req.body as {
    maintenanceMode?: unknown; failedAttemptThreshold?: unknown;
    sessionTimeoutEndDeviceSec?: unknown; sessionTimeoutStoreDeviceSec?: unknown; sessionTimeoutAdminDeviceSec?: unknown;
  } | null;
  const patch: Partial<{
    maintenanceMode: boolean; failedAttemptThreshold: number;
    sessionTimeoutEndDeviceSec: number; sessionTimeoutStoreDeviceSec: number; sessionTimeoutAdminDeviceSec: number;
    updatedBy: string | null; updatedAt: Date;
  }> = {};

  if (typeof body?.maintenanceMode === "boolean") patch.maintenanceMode = body.maintenanceMode;
  const intField = (v: unknown, min: number, max: number): number | null =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

  if (body?.failedAttemptThreshold !== undefined) {
    const n = intField(body.failedAttemptThreshold, 1, 50);
    if (n === null) { res.status(400).json({ error: "invalid_failed_attempt_threshold", message: "1–50." }); return; }
    patch.failedAttemptThreshold = n;
  }
  // Session timeouts: 60s (1 min) .. 86400s (24 h).
  for (const [key, field] of [
    ["sessionTimeoutEndDeviceSec", "sessionTimeoutEndDeviceSec"],
    ["sessionTimeoutStoreDeviceSec", "sessionTimeoutStoreDeviceSec"],
    ["sessionTimeoutAdminDeviceSec", "sessionTimeoutAdminDeviceSec"],
  ] as const) {
    if (body?.[key] !== undefined) {
      const n = intField(body[key], 60, 86_400);
      if (n === null) { res.status(400).json({ error: `invalid_${key}`, message: "60–86400 seconds." }); return; }
      patch[field] = n;
    }
  }
  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "No valid fields to update" }); return; }

  patch.updatedBy = req.admin?.adminId ?? null;
  patch.updatedAt = new Date();
  // Upsert the single row (id=true) — the seed migration inserts it, but guard
  // against a fresh install where the row is missing.
  const [updated] = await db.insert(securitySettingsTable)
    .values({ id: true, ...patch })
    .onConflictDoUpdate({ target: securitySettingsTable.id, set: patch })
    .returning();
  invalidateSecuritySettingsCache();
  await auditLog({ event: "SECURITY_SETTINGS_UPDATED", operatorId: req.admin?.adminId, detail: `fields=${Object.keys(patch).filter((k) => k !== "updatedBy" && k !== "updatedAt").join(",")}`, ip: req.ip });
  res.json({ settings: updated });
});

// ─── Module 15b — Report output settings (single-row) ───────────────────
// Two destinations with different reach:
//   • client folder → POLICY ONLY. A browser cannot be given a path; the File
//     System Access API yields an opaque, non-serializable handle from a user
//     gesture. Each PC picks its own folder once; only on/off + subfolder layout
//     + an advisory label sync from here.
//   • archive root → a real absolute path on the API host, honoured by
//     report-archive-service.ts. Overrides REPORT_ARCHIVE_ROOT.
router.get("/report-output-settings", requireAdminAuth, slideAdminCookie, async (_req, res) => {
  const [row] = await db.select().from(reportOutputSettingsTable).where(eq(reportOutputSettingsTable.id, true));
  // Sensible default the UI can prefill so an admin doesn't have to know the
  // host layout: a report-archive folder inside the app directory on THIS host.
  // Derived from the running bundle (dist/.. = deploy root), which is the same
  // shape on the dev repo and the client install.
  const suggestedArchiveRoot = path.join(path.resolve(__dirname, ".."), "report-archive");
  res.json({ settings: row ?? null, envArchiveRoot: process.env.REPORT_ARCHIVE_ROOT?.trim() || null, suggestedArchiveRoot });
});

router.patch("/report-output-settings", requireAdminAuth, slideAdminCookie, async (req: AdminAuthRequest, res: Response) => {
  const body = req.body as {
    clientFolderEnabled?: unknown; folderLabel?: unknown; organizeSubfolders?: unknown;
    archiveEnabled?: unknown; archiveRoot?: unknown;
  } | null;
  const patch: Partial<{
    clientFolderEnabled: boolean; folderLabel: string | null; organizeSubfolders: boolean;
    archiveEnabled: boolean; archiveRoot: string | null;
    updatedBy: string | null; updatedAt: Date;
  }> = {};

  if (typeof body?.clientFolderEnabled === "boolean") patch.clientFolderEnabled = body.clientFolderEnabled;
  if (typeof body?.organizeSubfolders === "boolean") patch.organizeSubfolders = body.organizeSubfolders;
  if (typeof body?.archiveEnabled === "boolean") patch.archiveEnabled = body.archiveEnabled;

  if (body?.folderLabel !== undefined) {
    if (body.folderLabel !== null && typeof body.folderLabel !== "string") {
      res.status(400).json({ error: "invalid_folder_label", message: "folderLabel must be a string or null." });
      return;
    }
    const label = typeof body.folderLabel === "string" ? body.folderLabel.trim() : "";
    if (label.length > 200) {
      res.status(400).json({ error: "invalid_folder_label", message: "folderLabel max 200 chars." });
      return;
    }
    patch.folderLabel = label || null;
  }

  if (body?.archiveRoot !== undefined) {
    if (body.archiveRoot !== null && typeof body.archiveRoot !== "string") {
      res.status(400).json({ error: "invalid_archive_root", message: "archiveRoot must be a string or null." });
      return;
    }
    const root = typeof body.archiveRoot === "string" ? body.archiveRoot.trim() : "";
    if (root) {
      // Absolute only: a relative root resolves against the API's cwd, which
      // differs between the systemd unit and a dev shell — same setting, two
      // different folders. Reject rather than silently pick one.
      if (!path.isAbsolute(root)) {
        res.status(400).json({ error: "invalid_archive_root", message: "archiveRoot must be an absolute path." });
        return;
      }
      if (root.length > 500) {
        res.status(400).json({ error: "invalid_archive_root", message: "archiveRoot max 500 chars." });
        return;
      }
    }
    patch.archiveRoot = root || null;
  }

  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "No valid fields to update" }); return; }

  patch.updatedBy = req.admin?.adminId ?? null;
  patch.updatedAt = new Date();
  const [updated] = await db.insert(reportOutputSettingsTable)
    .values({ id: true, ...patch })
    .onConflictDoUpdate({ target: reportOutputSettingsTable.id, set: patch })
    .returning();
  invalidateReportOutputSettingsCache();
  await auditLog({
    event: "REPORT_OUTPUT_SETTINGS_UPDATED",
    operatorId: req.admin?.adminId,
    detail: `fields=${Object.keys(patch).filter((k) => k !== "updatedBy" && k !== "updatedAt").join(",")}`,
    ip: req.ip,
  });
  res.json({ settings: updated });
});

// ─── Module 10.3 — Active sessions + force logout ───────────────────────
// Lists live (unrevoked, unexpired) refresh-token sessions joined to their
// user so the admin can see who is logged in on which device_type and force
// them off. device_type is inferred from role (there is no per-session device
// column): storekeeper→store_device, admin→admin_device, else end_device.
router.get("/active-sessions", requireAdminAuth, slideAdminCookie, async (_req, res) => {
  const rows = await db.select({
    id: refreshTokensTable.id,
    userId: refreshTokensTable.userId,
    userName: usersTable.name,
    role: usersTable.role,
    ip: refreshTokensTable.ip,
    userAgent: refreshTokensTable.userAgent,
    issuedAt: refreshTokensTable.issuedAt,
    expiresAt: refreshTokensTable.expiresAt,
  })
    .from(refreshTokensTable)
    .innerJoin(usersTable, eq(usersTable.id, refreshTokensTable.userId))
    .where(and(isNull(refreshTokensTable.revokedAt), gt(refreshTokensTable.expiresAt, sql`now()`)))
    .orderBy(desc(refreshTokensTable.issuedAt));

  const sessions = rows.map((r) => ({
    ...r,
    deviceType: r.role === "storekeeper" ? "store_device" : r.role === "admin" ? "admin_device" : "end_device",
  }));
  res.json({ sessions });
});

// Force logout: revoke the in-memory access-token blacklist AND every refresh
// token for the user, so the session can't be silently refreshed back.
router.post("/active-sessions/:userId/logout", requireAdminAuth, slideAdminCookie, async (req: AdminAuthRequest, res: Response) => {
  const userId = String(req.params.userId);
  revokeUser(userId);
  await revokeAllForUser(userId);
  await auditLog({ event: "SESSION_REVOKED", operatorId: req.admin?.adminId, detail: `force_logout:${userId}`, ip: req.ip });
  res.json({ userId, revoked: true });
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

// Module 14 — admin-authored notification broadcast. Writes one row into the
// shared feed, either global (target_role/target_user_id null) or scoped to a
// single role. Reuses pushNotification's best-effort insert; classified
// event_class "broadcast" so the client can style it distinctly.
const BROADCAST_ROLES = ["operator", "qa", "supervisor", "admin", "storekeeper"];
const BROADCAST_TYPES: NotificationType[] = ["success", "info", "warning", "error"];

router.post("/notifications/broadcast", requireAdminAuth, slideAdminCookie, async (req: AdminAuthRequest, res: Response) => {
  const body = req.body as { message?: unknown; detail?: unknown; type?: unknown; targetRole?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const detail = typeof body?.detail === "string" && body.detail.trim() ? body.detail.trim() : undefined;
  const type = BROADCAST_TYPES.includes(body?.type as NotificationType) ? (body!.type as NotificationType) : "info";
  // "all" (or omitted) → global; otherwise a single valid role.
  const rawRole = typeof body?.targetRole === "string" ? body.targetRole : "all";
  if (rawRole !== "all" && !BROADCAST_ROLES.includes(rawRole)) {
    res.status(400).json({ error: "Invalid targetRole" });
    return;
  }
  if (!message || message.length > 500) {
    res.status(400).json({ error: "message is required (max 500 chars)" });
    return;
  }

  await pushNotification({
    type,
    message,
    detail,
    eventClass: "broadcast",
    targetRole: rawRole === "all" ? undefined : rawRole,
    createdBy: req.admin?.username,
    createdByUserId: req.admin?.adminId,
  });

  await auditLog({
    event: "NOTIFICATION_BROADCAST",
    operatorId: req.admin?.adminId,
    detail: `broadcast:${rawRole}:${message.slice(0, 80)}`,
    ip: req.ip,
  });

  res.status(201).json({ success: true, targetRole: rawRole });
});

export default router;
