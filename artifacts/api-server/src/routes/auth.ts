import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";

import { db } from "@workspace/db";
import { usersTable, loginEventsTable } from "@workspace/db/schema";

import {
  computeFingerprint,
  getAccessTtlSec,
  getReauthTtlSec,
  getRefreshTtlSec,
  hashRefreshToken,
  signAccessToken,
  signReauthToken,
  verifyAccessToken,
  type AccessTokenPayload,
} from "../lib/authTokens";
import {
  issueRefresh,
  revokeAllForUser,
  revokeByHash,
  rotateRefresh,
} from "../lib/refreshStore";
import { type AuthRequest, type UserRole, attachActor, requireAuth } from "../middleware/auth";
import { auditLog } from "../lib/auditLogger";
import { logger } from "../lib/logger";
import { checkLockout, recordFailure, recordSuccess } from "../lib/lockoutStore";
import { unrevoke } from "../lib/tokenBlacklist";

// ─── constants ──────────────────────────────────────────────────────────────
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_MIN_LENGTH = 10;          // PRD §2.1 / APP-FLOW §5
const USERNAME_MAX_LENGTH = 255;

// Cookies. Both Strict per PRD §2.8. Secure flag flips in production.
// COOKIE_SECURE=false is an explicit opt-out for LAN-HTTP installs (no TLS
// on the factory network) — browsers refuse Secure cookies over plain http,
// which would break every login. Leave unset when serving behind TLS.
function isProd(req: { hostname?: string } | undefined): boolean {
  if (process.env.COOKIE_SECURE === "false") return false;
  if (process.env.NODE_ENV !== "production") return false;
  const host = req?.hostname ?? "";
  return host !== "localhost" && host !== "127.0.0.1";
}

function accessCookieOptions(req?: { hostname?: string }) {
  return {
    httpOnly: true,
    secure: isProd(req),
    sameSite: "strict" as const,
    maxAge: getAccessTtlSec() * 1000,
    path: "/api",
  };
}

function refreshCookieOptions(req?: { hostname?: string }) {
  return {
    httpOnly: true,
    secure: isProd(req),
    sameSite: "strict" as const,
    maxAge: getRefreshTtlSec() * 1000,
    path: "/api/auth",
  };
}

// Step-up proof cookie. Path "/api" so it rides along on the BOM write routes it
// authorizes; short TTL so a single confirm only opens a brief write window.
function reauthCookieOptions(req?: { hostname?: string }) {
  return {
    httpOnly: true,
    secure: isProd(req),
    sameSite: "strict" as const,
    maxAge: getReauthTtlSec() * 1000,
    path: "/api",
  };
}

function clearAuthCookies(res: Response, req?: { hostname?: string }) {
  res.clearCookie("smt_token",   { ...accessCookieOptions(req),  maxAge: undefined });
  res.clearCookie("smt_refresh", { ...refreshCookieOptions(req), maxAge: undefined });
}

// ─── login payload validation ───────────────────────────────────────────────
const VALID_LOGIN_ROLES: UserRole[] = ["operator", "qa", "supervisor", "storekeeper"];

function parseLoginPayload(body: unknown): { username: string; password: string; role: UserRole } | null {
  if (!body || typeof body !== "object") return null;
  const c = body as Record<string, unknown>;
  const username = typeof c.username === "string" ? c.username.trim() : "";
  const password = typeof c.password === "string" ? c.password : "";
  const role = c.role;
  if (!username || username.length > USERNAME_MAX_LENGTH)         return null;
  if (!password || password.length > PASSWORD_MAX_LENGTH)         return null;
  // Admin is NOT in the /login dropdown — admin uses /api/admin/auth/login only.
  if (typeof role !== "string" || !VALID_LOGIN_ROLES.includes(role as UserRole)) return null;
  return { username, password, role: role as UserRole };
}

// ─── login identifier resolution (legacy compat) ────────────────────────────
let userTableColumnsPromise: Promise<Set<string>> | null = null;
async function getUserTableColumns(): Promise<Set<string>> {
  if (!userTableColumnsPromise) {
    userTableColumnsPromise = db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
    `).then((r) => {
      const rows = Array.isArray((r as { rows?: Array<{ column_name?: string }> }).rows)
        ? (r as { rows: Array<{ column_name?: string }> }).rows : [];
      return new Set(rows.map((row) => row.column_name).filter((c): c is string => typeof c === "string"));
    });
  }
  return userTableColumnsPromise;
}

function resolveLoginIdentifier(username: string, identifierColumn: string): string {
  const normalized = username.trim();
  if (identifierColumn !== "employee_id") return normalized.toLowerCase();
  // Seeded users use lowercase employee_id; EMP### codes are uppercase.
  if (/^emp\d+$/i.test(normalized)) return normalized.toUpperCase();
  const lower = normalized.toLowerCase();
  const seeded = ["operator1", "operator2", "qa1", "engineer1", "admin1", "storekeeper1"];
  return seeded.includes(lower) ? lower : normalized.toUpperCase();
}

// ─── login event recorder ───────────────────────────────────────────────────
async function recordLoginEvent(input: {
  userId?: string; employeeId?: string; ip?: string; ua?: string;
  result: "success" | "failure"; reason?: string;
}): Promise<void> {
  try {
    await db.insert(loginEventsTable).values({
      userId:        input.userId,
      employeeId:    input.employeeId,
      ip:            input.ip,
      userAgent:     input.ua,
      result:        input.result,
      failureReason: input.reason,
    });
  } catch (err) {
    logger.warn({ err }, "login_event insert failed");
  }
}

// ─── helpers shared with middleware/auth.ts ─────────────────────────────────
function readAccessCookie(req: { cookies?: { smt_token?: string } }): string | null {
  const t = req.cookies?.smt_token;
  return typeof t === "string" && t.length > 0 ? t : null;
}

function readRefreshCookie(req: { cookies?: { smt_refresh?: string } }): string | null {
  const t = req.cookies?.smt_refresh;
  return typeof t === "string" && t.length > 0 ? t : null;
}

export function getAuthActorFromCookie(req: { cookies?: { smt_token?: string } }): AccessTokenPayload | null {
  const token = readAccessCookie(req);
  return token ? verifyAccessToken(token) : null;
}

// ─── routes ─────────────────────────────────────────────────────────────────
const router: IRouter = Router();

router.post("/auth/login", async (req: Request, res: Response) => {
  const parsed = parseLoginPayload(req.body);
  if (!parsed) {
    await recordLoginEvent({ ip: req.ip, ua: req.get("user-agent"), result: "failure", reason: "invalid_payload" });
    res.status(400).json({ error: "auth_invalid_payload", message: "Invalid login payload" });
    return;
  }

  const { username, password, role } = parsed;

  // PRD §2.5 — per-username lockout. Username is normalised to lowercase so
  // case variations on the way in cannot dodge the lockout.
  const lockoutKey = username.toLowerCase();
  const lockoutStatus = checkLockout("user-login", lockoutKey);
  if (lockoutStatus.locked) {
    await recordLoginEvent({ employeeId: username, ip: req.ip, ua: req.get("user-agent"), result: "failure", reason: "locked" });
    const retryAfter = lockoutStatus.until ? Math.max(0, Math.ceil((lockoutStatus.until - Date.now()) / 1000)) : undefined;
    if (retryAfter !== undefined) res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "rate_limit_login",
      message: "Too many failed attempts. Account temporarily locked. Try again later.",
    });
    return;
  }
  const columns = await getUserTableColumns();
  const identifierColumn = columns.has("employee_id") ? "employee_id" : "username";
  const passwordColumn   = columns.has("password_hash") ? "password_hash" : "password";
  const displayColumn    = columns.has("name") ? "name" : identifierColumn;
  const loginIdentifier  = resolveLoginIdentifier(username, identifierColumn);

  type Row = {
    id: string;
    username: string;
    display_name: string;
    role: UserRole;
    password_hash?: string;
    is_active?: boolean;
    must_change_password?: boolean;
  };
  const result = await db.execute<Row>(sql`
    SELECT
      id,
      ${sql.identifier(displayColumn)}    AS display_name,
      ${sql.identifier(identifierColumn)} AS username,
      role,
      ${sql.identifier(passwordColumn)}   AS password_hash,
      COALESCE(is_active, TRUE)            AS is_active,
      COALESCE(must_change_password, TRUE) AS must_change_password
    FROM users
    WHERE ${sql.identifier(identifierColumn)} = ${loginIdentifier}
      AND role = ${role}
    LIMIT 1
  `);
  const rows = (result as unknown as { rows: Row[] }).rows ?? [];
  const user = rows[0];

  // No role enumeration: wrong role and wrong password produce IDENTICAL output.
  if (!user) {
    // Treat unknown-user as a failed attempt against the typed username so an
    // attacker can't probe usernames cheaply by guessing wrong roles.
    const failure = recordFailure("user-login", lockoutKey);
    await recordLoginEvent({ employeeId: username, ip: req.ip, ua: req.get("user-agent"), result: "failure", reason: failure.justLocked ? "locked" : "unknown_user" });
    if (failure.justLocked) {
      await auditLog({ event: "SECURITY_ACCOUNT_LOCKED", detail: `username=${username} reason=unknown_user_threshold`, ip: req.ip });
    }
    res.status(401).json({ error: "auth_invalid_credentials", message: "Invalid username, password, or role" });
    return;
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash ?? "");
  if (!passwordMatches) {
    const failure = recordFailure("user-login", lockoutKey);
    await recordLoginEvent({ userId: user.id, employeeId: username, ip: req.ip, ua: req.get("user-agent"), result: "failure", reason: failure.justLocked ? "locked" : "password_mismatch" });
    if (failure.justLocked) {
      await auditLog({ event: "SECURITY_ACCOUNT_LOCKED", operatorId: user.id, detail: `username=${username} reason=password_threshold`, ip: req.ip });
    }
    res.status(401).json({ error: "auth_invalid_credentials", message: "Invalid username, password, or role" });
    return;
  }

  if (user.is_active === false) {
    await recordLoginEvent({ userId: user.id, employeeId: username, ip: req.ip, ua: req.get("user-agent"), result: "failure", reason: "inactive" });
    res.status(403).json({ error: "forbidden_inactive", message: "Your account is disabled. Contact your supervisor." });
    return;
  }

  // U17 — a successful, credential-verified login clears any stale userId
  // revocation. revokeUser() (admin reset / force-logout) is keyed by userId to
  // kill EXISTING tokens on their next request; without this, the fresh token we
  // are about to issue would also be rejected for up to 8h, trapping the user —
  // including on the /change-password escape hatch after an admin reset. Bans are
  // unaffected: disabled/deleted accounts never reach this line (see checks above).
  unrevoke(user.id);

  const fingerprint = computeFingerprint(req.get("user-agent"), req.ip);
  const refresh     = await issueRefresh({
    userId:    user.id,
    userAgent: req.get("user-agent"),
    ip:        req.ip,
    fingerprint,
  });

  const access = signAccessToken({
    userId:             user.id,
    username:           user.username,
    name:               user.display_name ?? user.username,
    role:               user.role,
    mustChangePassword: user.must_change_password === true,
    jti:                refresh.id,
  });

  res.cookie("smt_token",   access,         accessCookieOptions(req));
  res.cookie("smt_refresh", refresh.token,  refreshCookieOptions(req));

  recordSuccess("user-login", lockoutKey);
  await auditLog({ event: "LOGIN_SUCCESS", operatorId: user.id, detail: user.role, ip: req.ip });
  await recordLoginEvent({ userId: user.id, employeeId: username, ip: req.ip, ua: req.get("user-agent"), result: "success" });

  res.status(200).json({
    userId:             user.id,
    username:           user.username,
    name:               user.display_name ?? user.username,
    role:               user.role,
    mustChangePassword: user.must_change_password === true,
  });
});

router.post("/auth/refresh", async (req: Request, res: Response) => {
  const presented = readRefreshCookie(req);
  if (!presented) {
    res.status(401).json({ error: "auth_required", message: "No refresh token" });
    return;
  }

  const fingerprint = computeFingerprint(req.get("user-agent"), req.ip);
  const outcome = await rotateRefresh({
    presentedToken: presented,
    userAgent:      req.get("user-agent"),
    ip:             req.ip,
    fingerprint,
  });

  if (!outcome.ok) {
    clearAuthCookies(res, req);
    if (outcome.reason === "reuse_detected") {
      res.status(401).json({ error: "auth_refresh_reuse", message: "Session compromised — please log in again" });
      return;
    }
    if (outcome.reason === "fingerprint_mismatch") {
      res.status(401).json({ error: "auth_fingerprint_mismatch", message: "Session changed device — please log in again" });
      return;
    }
    res.status(401).json({ error: "auth_token_expired", message: "Session expired — please log in again" });
    return;
  }

  // Need to fetch user info for the new access token. The refresh row carries
  // only userId, so do one targeted read.
  type UserRow = {
    id: string; username: string; name: string; role: UserRole;
    is_active: boolean; must_change_password: boolean;
  };
  const userResult = await db.execute<UserRow>(sql`
    SELECT id, employee_id AS username, name, role, is_active, must_change_password
    FROM users WHERE id = (SELECT user_id FROM refresh_tokens WHERE id = ${outcome.id})
    LIMIT 1
  `);
  const user = ((userResult as unknown as { rows: UserRow[] }).rows ?? [])[0];
  if (!user || user.is_active === false) {
    clearAuthCookies(res, req);
    res.status(401).json({ error: "auth_token_expired", message: "Session expired" });
    return;
  }

  const access = signAccessToken({
    userId:             user.id,
    username:           user.username,
    name:               user.name,
    role:               user.role,
    mustChangePassword: user.must_change_password === true,
    jti:                outcome.id,
  });

  res.cookie("smt_token",   access,           accessCookieOptions(req));
  res.cookie("smt_refresh", outcome.token,    refreshCookieOptions(req));
  res.status(200).json({ refreshed: true });
});

router.post("/auth/logout", attachActor, requireAuth, async (req: AuthRequest, res: Response) => {
  const presented = readRefreshCookie(req);
  if (presented) {
    await revokeByHash(hashRefreshToken(presented));
  }
  clearAuthCookies(res, req);
  await auditLog({ event: "LOGOUT", operatorId: req.actor?.id, detail: req.actor?.role, ip: req.ip });
  res.status(200).json({ success: true });
});

router.get("/auth/me", (req: Request, res: Response) => {
  const actor = getAuthActorFromCookie(req);
  if (!actor) {
    clearAuthCookies(res, req);
    res.status(401).json({ error: "auth_required" });
    return;
  }
  res.json({
    userId:             actor.userId,
    username:           actor.username,
    name:               actor.name,
    role:               actor.role,
    mustChangePassword: actor.mustChangePassword,
  });
});

router.post("/auth/change-password", attachActor, requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.actor!.id;

  // PRD §2.5 — 3 password-change attempts per hour, per user. No sticky
  // lockout: once the 3rd failure trips, the rest of the window 429s but
  // the user can still log in normally; this only gates the change flow.
  const pwChangeStatus = checkLockout("password-change", userId);
  if (pwChangeStatus.locked) {
    const retryAfter = pwChangeStatus.until ? Math.max(0, Math.ceil((pwChangeStatus.until - Date.now()) / 1000)) : undefined;
    if (retryAfter !== undefined) res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "rate_limit_password_change",
      message: "Too many password-change attempts. Try again later.",
    });
    return;
  }

  const body = req.body as { oldPassword?: unknown; newPassword?: unknown } | null;
  const oldPassword = typeof body?.oldPassword === "string" ? body.oldPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  if (
    !oldPassword || oldPassword.length > PASSWORD_MAX_LENGTH ||
    !newPassword || newPassword.length < PASSWORD_MIN_LENGTH || newPassword.length > PASSWORD_MAX_LENGTH ||
    !/[0-9]/.test(newPassword) || !/[A-Za-z]/.test(newPassword)
  ) {
    res.status(400).json({
      error: "auth_password_policy",
      message: `Password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} chars and include at least one letter and one number`,
    });
    return;
  }

  const [user] = await db.select({ password_hash: usersTable.password_hash }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "user_not_found" });
    return;
  }

  const oldMatches = await bcrypt.compare(oldPassword, user.password_hash ?? "");
  if (!oldMatches) {
    recordFailure("password-change", userId);
    res.status(401).json({ error: "auth_invalid_credentials", message: "Current password is incorrect" });
    return;
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await db.update(usersTable)
    .set({ password_hash: newHash, must_change_password: false })
    .where(eq(usersTable.id, userId));

  // Force re-login on every other device by revoking every refresh row for this user,
  // then issue a fresh pair so the current device stays logged in.
  await revokeAllForUser(userId);

  const fingerprint = computeFingerprint(req.get("user-agent"), req.ip);
  const refresh     = await issueRefresh({
    userId,
    userAgent:   req.get("user-agent"),
    ip:          req.ip,
    fingerprint,
  });
  const access = signAccessToken({
    userId,
    username:           req.actor!.username,
    name:               req.actor!.name,
    role:               req.actor!.role,
    mustChangePassword: false,
    jti:                refresh.id,
  });
  res.cookie("smt_token",   access,         accessCookieOptions(req));
  res.cookie("smt_refresh", refresh.token,  refreshCookieOptions(req));

  recordSuccess("password-change", userId);
  await auditLog({ event: "LOGIN_SUCCESS", operatorId: userId, detail: "password_changed", ip: req.ip });
  res.status(200).json({ success: true });
});

router.post("/auth/verify-override", attachActor, requireAuth, async (req: AuthRequest, res: Response) => {
  // Used by manual-override modal in the verification flow. Validates that a
  // supervisor/qa with the supplied password approves the action.
  try {
    const { password, role } = req.body as { password?: unknown; role?: unknown };
    if (typeof password !== "string" || password.length < 1 || password.length > 128 ||
        (role !== "supervisor" && role !== "qa")) {
      res.status(400).json({ error: "password and role (supervisor|qa) are required" });
      return;
    }
    const userRecord = await db.query.usersTable.findFirst({ where: eq(usersTable.role, role) });
    if (!userRecord) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const passwordValid = await bcrypt.compare(password, userRecord.password_hash ?? "");
    if (!passwordValid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    await auditLog({
      event:      "SCAN_VERIFIED",
      operatorId: userRecord.id,
      detail:     `Manual override approval by ${userRecord.name} (${role})`,
      ip:         req.ip,
    });
    res.json({ valid: true, approverName: userRecord.name, approverRole: role });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Verification failed" });
  }
});

router.post("/auth/verify-password", attachActor, requireAuth, async (req: AuthRequest, res: Response) => {
  // Step-up confirm for sensitive actions (e.g. BOM add/delete). Verifies the
  // CURRENT actor's own password — mirrors verify-override but for oneself.
  const userId = req.actor!.id;
  const body = req.body as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || password.length > PASSWORD_MAX_LENGTH) {
    res.status(400).json({ error: "auth_invalid_payload", message: "Password is required" });
    return;
  }
  const [user] = await db.select({ password_hash: usersTable.password_hash }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "user_not_found" });
    return;
  }
  const matches = await bcrypt.compare(password, user.password_hash ?? "");
  if (!matches) {
    res.status(401).json({ error: "auth_invalid_credentials", message: "Password is incorrect" });
    return;
  }
  // Issue a short-lived step-up proof so the sensitive BOM writes this confirm
  // authorizes are actually enforced server-side (requireStepUp), not just gated
  // in the UI.
  res.cookie("smt_reauth", signReauthToken(userId), reauthCookieOptions(req));
  res.status(200).json({ valid: true });
});

export default router;
