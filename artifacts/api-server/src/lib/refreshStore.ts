// Refresh-token persistence + rotation + replay detection (PRD §2.6, TRD §6.3).
//
// Replay detection rule:
//   If a presented refresh token's row has revoked_at != NULL AND replaced_by != NULL
//   it means the old token (already rotated) is being re-used. That indicates
//   the cookie was stolen and the attacker raced the legitimate user. Response:
//   revoke the ENTIRE token family for that user; client must re-login.

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@workspace/db";
import { refreshTokensTable } from "@workspace/db/schema";

import {
  generateRefreshToken,
  getRefreshTtlSec,
  hashRefreshToken,
} from "./authTokens";

export type IssueRefreshResult = {
  token: string;       // plaintext for the cookie — NEVER persisted
  tokenHash: string;
  expiresAt: Date;
  id: string;
};

export async function issueRefresh(input: {
  userId: string;
  userAgent?: string;
  ip?: string;
  fingerprint: string;
}): Promise<IssueRefreshResult> {
  const token     = generateRefreshToken();
  const tokenHash = hashRefreshToken(token);
  const expiresAt = new Date(Date.now() + getRefreshTtlSec() * 1000);

  const [row] = await db.insert(refreshTokensTable).values({
    userId:      input.userId,
    tokenHash,
    expiresAt,
    userAgent:   input.userAgent?.slice(0, 255),
    ip:          input.ip,
    fingerprint: input.fingerprint,
  }).returning({ id: refreshTokensTable.id });

  return { token, tokenHash, expiresAt, id: row.id };
}

export type RotateRefreshOutcome =
  | { ok: true; token: string; tokenHash: string; expiresAt: Date; id: string }
  | { ok: false; reason: "not_found" | "expired" | "reuse_detected" | "fingerprint_mismatch" };

export async function rotateRefresh(input: {
  presentedToken: string;
  userAgent?: string;
  ip?: string;
  fingerprint: string;
}): Promise<RotateRefreshOutcome> {
  const presentedHash = hashRefreshToken(input.presentedToken);

  const [existing] = await db.select().from(refreshTokensTable).where(eq(refreshTokensTable.tokenHash, presentedHash));
  if (!existing) {
    return { ok: false, reason: "not_found" };
  }

  // Reuse detection — old token already rotated, but the SAME hash got presented
  // again. Revoke the whole family and refuse.
  if (existing.revokedAt !== null && existing.replacedBy !== null) {
    await revokeAllForUser(existing.userId);
    return { ok: false, reason: "reuse_detected" };
  }
  if (existing.revokedAt !== null) {
    return { ok: false, reason: "not_found" };
  }
  if (existing.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  // U7 — fingerprint mismatch invalidates the entire family.
  if (existing.fingerprint && existing.fingerprint !== input.fingerprint) {
    await revokeAllForUser(existing.userId);
    return { ok: false, reason: "fingerprint_mismatch" };
  }

  const next = await issueRefresh({
    userId:      existing.userId,
    userAgent:   input.userAgent,
    ip:          input.ip,
    fingerprint: input.fingerprint,
  });

  await db.update(refreshTokensTable)
    .set({ revokedAt: new Date(), replacedBy: next.id })
    .where(eq(refreshTokensTable.id, existing.id));

  return {
    ok:        true,
    token:     next.token,
    tokenHash: next.tokenHash,
    expiresAt: next.expiresAt,
    id:        next.id,
  };
}

export async function revokeByHash(tokenHash: string): Promise<void> {
  await db.update(refreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokensTable.tokenHash, tokenHash), isNull(refreshTokensTable.revokedAt)));
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await db.update(refreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokensTable.userId, userId), isNull(refreshTokensTable.revokedAt)));
}

// Surface so the admin portal can see active sessions per user (used in P2-C).
export async function countActiveForUser(userId: string): Promise<number> {
  const [row] = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM refresh_tokens
    WHERE user_id = ${userId} AND revoked_at IS NULL AND expires_at > now()
  `).then((r) => (r as unknown as { rows: { count: string }[] }).rows ?? []);
  return Number(row?.count ?? "0");
}
