import type { NextFunction, Request, Response } from "express";
import { db } from "@workspace/db";
import { changeoverSessionsTable, sessionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getAuthActorFromCookie } from "../routes/auth";
import { isRevoked } from "../lib/tokenBlacklist";
import { auditLog } from "../lib/auditLogger";

// PRD §2.4 acceptance — "audit log records the attempt" when one operator
// tries to access another's session. Fire-and-forget so the 403 response
// is not blocked on the chain insert.
function recordForbiddenAccess(
  req: AuthRequest,
  sessionId: string,
  ownerKey: string,
): void {
  const actor = req.actor;
  if (!actor) return;
  void auditLog({
    event: "UNAUTHORIZED_ACCESS",
    operatorId: actor.userId,
    sessionId,
    detail: `actor=${actor.username} role=${actor.role} method=${req.method} path=${req.path} owner=${ownerKey}`,
    ip: req.ip,
  });
}

export type UserRole = "operator" | "qa" | "supervisor" | "admin" | "storekeeper";

export interface RequestActor {
  userId: string;
  id: string;
  username: string;
  name: string;
  role: UserRole;
}

export interface AuthRequest extends Request {
  actor?: RequestActor;
}

export function attachActor(req: AuthRequest, res: Response, next: NextFunction): void {
  const actor = getAuthActorFromCookie(req);
  if (!actor || !actor.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // U17 — admin-initiated revocation takes effect on the very next request.
  if (isRevoked(actor.userId)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.actor = {
    userId: actor.userId,
    id: actor.userId,
    username: actor.username,
    name: actor.name || actor.username,
    role: actor.role,
  };
  next();
}

/**
 * Role-based authorization guard
 * Usage: router.post("/path", requireRole("qa", "supervisor"), handler)
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const actor = req.actor;
    if (!actor) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!allowedRoles.includes(actor.role)) {
      res.status(403).json({ error: "Forbidden: insufficient permissions" });
      return;
    }
    next();
  };
}

/**
 * Authentication guard — requires valid authentication only (any role)
 * Usage: router.get("/path", requireAuth, handler)
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const actor = req.actor;
  if (!actor) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function requireQaOrSupervisor(req: AuthRequest, res: Response, next: NextFunction): void {
  const actor = req.actor;
  if (!actor) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (actor.role !== "qa" && actor.role !== "supervisor") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

export async function requireOperatorSessionOwnership(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const actor = req.actor;
  if (!actor) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (actor.role !== "operator") {
    res.status(403).json({ error: "Only operators can post scans" });
    return;
  }

  const sessionId = String(req.body?.sessionId ?? "").trim();
  if (!sessionId) {
    res.status(400).json({ error: "Invalid sessionId" });
    return;
  }

  const [session] = await db
    .select({ id: changeoverSessionsTable.id, operatorId: changeoverSessionsTable.operatorId })
    .from(changeoverSessionsTable)
    .where(eq(changeoverSessionsTable.id, sessionId));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Compare as strings (all now UUID)
  if (String(session.operatorId) !== String(actor.id)) {
    res.status(403).json({ error: "Forbidden: session does not belong to operator" });
    return;
  }

  next();
}

// PRD §2.4 — link-manipulation defense for the active changeover_sessions
// (UUID) table. qa / supervisor / admin always pass; operator must own the
// session via operator_id FK; anyone else (e.g. storekeeper) → 403.
export async function requireChangeoverSessionAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const actor = req.actor;
  if (!actor) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (actor.role === "qa" || actor.role === "supervisor" || actor.role === "admin") {
    next();
    return;
  }

  if (actor.role !== "operator") {
    recordForbiddenAccess(req, String(req.params.sessionId ?? ""), `disallowed_role:${actor.role}`);
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const sessionId = String(req.params.sessionId ?? "").trim();
  if (!sessionId) {
    res.status(400).json({ error: "Invalid sessionId" });
    return;
  }

  const [session] = await db
    .select({ id: changeoverSessionsTable.id, operatorId: changeoverSessionsTable.operatorId })
    .from(changeoverSessionsTable)
    .where(eq(changeoverSessionsTable.id, sessionId));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (String(session.operatorId) !== String(actor.id)) {
    recordForbiddenAccess(req, sessionId, `operator_id=${session.operatorId}`);
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  next();
}

// PRD §2.4 — link-manipulation defense for the legacy `sessions` (integer
// id) table. It has no operator_id FK, only operator_name text; ownership
// is a case-insensitive comparison against actor.username. Two operators
// can't collide because users.employee_id is unique.
// PRD §2.4 — session read-access guard. Same ownership semantics as
// requireChangeoverSessionAccess, used by verification read routes.
export const requireSessionReadAccess = requireChangeoverSessionAccess;

export async function requireLegacySessionAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const actor = req.actor;
  if (!actor) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (actor.role === "qa" || actor.role === "supervisor" || actor.role === "admin") {
    next();
    return;
  }

  if (actor.role !== "operator") {
    recordForbiddenAccess(req, String(req.params.sessionId ?? ""), `disallowed_role:${actor.role}`);
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const sessionId = Number(req.params.sessionId);
  if (!Number.isFinite(sessionId) || sessionId <= 0) {
    res.status(400).json({ error: "Invalid sessionId" });
    return;
  }

  const [session] = await db
    .select({ id: sessionsTable.id, operatorName: sessionsTable.operatorName })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const sessionOperator = (session.operatorName ?? "").trim().toLowerCase();
  const actorUsername = (actor.username ?? "").trim().toLowerCase();
  if (!sessionOperator || sessionOperator !== actorUsername) {
    recordForbiddenAccess(req, String(sessionId), `operator_name=${session.operatorName ?? "<null>"}`);
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  next();
}