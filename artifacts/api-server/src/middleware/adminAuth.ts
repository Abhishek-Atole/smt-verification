import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { logger } from "../lib/logger";

// Admin tokens are signed with JWT_ADMIN_SECRET (MUST differ from JWT_SECRET).
// They live in a separate cookie (smt_admin_token) on path /api/admin, so the
// browser will not attach them to regular routes — preventing accidental
// elevation through cookie reuse.

export const ADMIN_TOKEN_COOKIE = "smt_admin_token";
export const ADMIN_SLIDING_TTL_SEC = Number(process.env.JWT_ADMIN_SLIDING_TTL_SEC ?? 900);   // 15 min
export const ADMIN_ABSOLUTE_TTL_SEC = Number(process.env.JWT_ADMIN_ABSOLUTE_TTL_SEC ?? 3600); // 1 h

export interface AdminTokenPayload {
  adminId: string;
  username: string;
  isAdmin: true;
  /** First-login gate: true until the admin sets a NEW username AND password. */
  mustChange: boolean;
  /** Absolute expiry (unix seconds) — sliding TTL cannot extend past this. */
  absExp: number;
}

export interface AdminAuthRequest extends Request {
  admin?: AdminTokenPayload;
}

function getAdminSecret(): string {
  const secret = process.env.JWT_ADMIN_SECRET;
  if (!secret) throw new Error("JWT_ADMIN_SECRET must be set");
  return secret;
}

export function signAdminToken(input: { adminId: string; username: string; mustChange: boolean; absExp?: number }): string {
  const now = Math.floor(Date.now() / 1000);
  const absExp = input.absExp ?? now + ADMIN_ABSOLUTE_TTL_SEC;
  const payload: AdminTokenPayload = {
    adminId: input.adminId,
    username: input.username,
    isAdmin: true,
    mustChange: input.mustChange,
    absExp,
  };
  return jwt.sign(payload, getAdminSecret(), { expiresIn: ADMIN_SLIDING_TTL_SEC });
}

export function verifyAdminToken(token: string): AdminTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getAdminSecret()) as JwtPayload & Partial<AdminTokenPayload>;
    if (
      typeof decoded.adminId !== "string" ||
      typeof decoded.username !== "string" ||
      decoded.isAdmin !== true ||
      typeof decoded.absExp !== "number"
    ) {
      return null;
    }
    if (Math.floor(Date.now() / 1000) > decoded.absExp) {
      return null; // absolute TTL exceeded
    }
    return {
      adminId: decoded.adminId,
      username: decoded.username,
      isAdmin: true,
      mustChange: decoded.mustChange === true,
      absExp: decoded.absExp,
    };
  } catch (err) {
    logger.warn({ err }, "Invalid admin JWT");
    return null;
  }
}

export function getAdminCookieOptions(req?: { hostname?: string }) {
  // COOKIE_SECURE=false: explicit opt-out for LAN-HTTP installs (see routes/auth.ts isProd).
  const isLocalhost = !req || req.hostname === "localhost" || req.hostname === "127.0.0.1" || process.env.NODE_ENV !== "production";
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "false" ? false : !isLocalhost,
    sameSite: "strict" as const,
    maxAge: ADMIN_SLIDING_TTL_SEC * 1000,
    path: "/api/admin",
  };
}

/** Reject unless a valid smt_admin_token cookie is present. */
export function requireAdminAuth(req: AdminAuthRequest, res: Response, next: NextFunction): void {
  const token = (req.cookies as { [k: string]: string | undefined } | undefined)?.[ADMIN_TOKEN_COOKIE];
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const payload = verifyAdminToken(token);
  if (!payload) {
    res.clearCookie(ADMIN_TOKEN_COOKIE, getAdminCookieOptions(req));
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.admin = payload;
  next();
}

/** Optional IP allow-list — set ADMIN_IP_ALLOWLIST (comma-separated) to enforce. Empty = allow all. */
export function requireAdminIp(req: Request, res: Response, next: NextFunction): void {
  const raw = process.env.ADMIN_IP_ALLOWLIST;
  if (!raw || raw.trim() === "") {
    next();
    return;
  }
  const allowed = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  const ip = (req.ip ?? "").replace(/^::ffff:/, "");
  if (!allowed.has(ip)) {
    logger.warn({ ip }, "Admin request from non-allowlisted IP");
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

/** Issue a refreshed sliding-TTL cookie on every authenticated admin response. */
export function slideAdminCookie(req: AdminAuthRequest, res: Response, next: NextFunction): void {
  if (req.admin) {
    const refreshed = signAdminToken({
      adminId: req.admin.adminId,
      username: req.admin.username,
      mustChange: req.admin.mustChange,
      absExp: req.admin.absExp,
    });
    res.cookie(ADMIN_TOKEN_COOKIE, refreshed, getAdminCookieOptions(req));
  }
  next();
}

/**
 * Hard gate for the first-login admin. Until the seeded admin sets a NEW
 * username AND a NEW password (POST /auth/change-credentials), every admin
 * route guarded by this returns 409 must_change_credentials. Only login,
 * logout, me, and change-credentials stay reachable. Runs after
 * requireAdminAuth (needs req.admin populated). 409 (not 401) lets the SPA
 * tell "must set up account" apart from "not logged in".
 */
export function requireCredentialsChanged(req: AdminAuthRequest, res: Response, next: NextFunction): void {
  if (req.admin?.mustChange) {
    res.status(409).json({ error: "must_change_credentials", message: "Set a new admin username and password before continuing." });
    return;
  }
  next();
}
