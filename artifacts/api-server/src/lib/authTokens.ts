// JWT + refresh-token crypto helpers for Phase 2-A (PRD §2.6, TRD §6.1, U7).
// Access tokens are short (30 min default) and signed JWTs; refresh tokens are
// random 256-bit opaque values, stored SHA-256-hashed in refresh_tokens.

import crypto from "crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";

import type { UserRole } from "../middleware/auth";

const DEFAULT_ACCESS_TTL_SEC  = 30 * 60;
const DEFAULT_REFRESH_TTL_SEC = 7 * 24 * 60 * 60;
const DEFAULT_REAUTH_TTL_SEC  = 5 * 60;

export interface AccessTokenPayload {
  userId: string;
  username: string;
  name: string;
  role: UserRole;
  mustChangePassword: boolean;
  jti: string;
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set and ≥32 chars");
  }
  return secret;
}

export function getAccessTtlSec(): number {
  const fromEnv = Number(process.env.JWT_ACCESS_TTL_SEC);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_ACCESS_TTL_SEC;
}

export function getRefreshTtlSec(): number {
  const fromEnv = Number(process.env.JWT_REFRESH_TTL_SEC);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_REFRESH_TTL_SEC;
}

export function getReauthTtlSec(): number {
  const fromEnv = Number(process.env.JWT_REAUTH_TTL_SEC);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_REAUTH_TTL_SEC;
}

// Step-up (re-auth) proof. Issued by POST /auth/verify-password once the actor
// re-enters their own password; required by sensitive BOM writes so those can no
// longer be driven from a bare session cookie without a fresh password check.
// Short-lived + bound to the user via `sub`; `purpose` fences it off from access
// tokens signed with the same secret.
export function signReauthToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: "reauth" }, getJwtSecret(), { expiresIn: getReauthTtlSec() });
}

// Returns the bound userId when the token is a valid, unexpired reauth proof,
// else null.
export function verifyReauthToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;
    if (decoded.purpose !== "reauth") return null;
    return typeof decoded.sub === "string" && decoded.sub ? decoded.sub : null;
  } catch {
    return null;
  }
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: getAccessTtlSec() });
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;
    const userId = typeof decoded.userId === "string" ? decoded.userId : "";
    const username = typeof decoded.username === "string" ? decoded.username : "";
    const name = typeof decoded.name === "string" ? decoded.name : "";
    const role = decoded.role;
    const mustChangePassword = decoded.mustChangePassword === true;
    const jti = typeof decoded.jti === "string" ? decoded.jti : "";
    if (
      !userId ||
      !username ||
      !jti ||
      (role !== "operator" && role !== "qa" && role !== "supervisor" && role !== "admin" && role !== "storekeeper")
    ) {
      return null;
    }
    return { userId, username, name, role, mustChangePassword, jti };
  } catch {
    return null;
  }
}

// Refresh tokens are opaque random 256-bit values, base64url-encoded for cookie
// transport. We never store the plaintext — the SHA-256 hex digest is what hits
// refresh_tokens.token_hash.
export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

// U7 — fingerprint = sha256(UA + '|' + ipSubnet24). Stored on the refresh row;
// mismatch on rotation invalidates the family.
export function computeFingerprint(userAgent: string | undefined, ip: string | undefined): string {
  const uaClean = (userAgent ?? "").slice(0, 255);
  const ipClean = ipSubnet24(ip ?? "");
  return crypto.createHash("sha256").update(`${uaClean}|${ipClean}`, "utf8").digest("hex");
}

function ipSubnet24(ip: string): string {
  // IPv4 → first three octets; IPv6 → first /48 group. Bare-bones; refine if real
  // multi-subnet clients show up.
  if (!ip) return "";
  if (ip.includes(":")) {
    return ip.split(":").slice(0, 3).join(":");
  }
  return ip.split(".").slice(0, 3).join(".");
}
