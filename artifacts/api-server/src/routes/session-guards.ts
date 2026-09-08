import { db } from "@workspace/db";
import { sessionsTable, changeoverOperatorsTable } from "@workspace/db/schema";
import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";

/**
 * Single-active-changeover guards, scoped PER LOGIN (approved scope).
 *
 * The reported bug was that a second changeover started by the same operator
 * overrode the first. The old "Module 2.1" gate capped active changeovers per
 * line at 2 and was keyed on lineName, not on who owns the session. The approved
 * model, confirmed with the user, is per login:
 *
 *   - A single user (an "owner" of the session — creator or accepted handover
 *     co-owner, mirroring the app's existing access scope) may run at most one
 *     changeover at a time.
 *   - BLOCKING_STATUSES — a session owned by this login that is mid-operator/QA
 *     work (active → active_splicing) prevents that login starting another. The
 *     unlock point is splicing_pending_qa: once the operator submits splicing to
 *     QA, that same login may start the next changeover while QA reviews.
 *   - Different logins on different lines are INDEPENDENT (that is the point of
 *     per-login scope) — they never block each other.
 *   - TERMINAL_STATUSES — completed/cancelled/incomplete. Never block.
 *
 * findBlockingSession(actorId) — does THIS actor already own a session in a
 *   BLOCKING status? (Guard 1, POST /sessions before insert.)
 *
 * findEarlierUnfinished(sessionId) — is there an EARLIER session (smaller id)
 *   that SHARES an accepted owner with the target session and has not reached a
 *   TERMINAL status? (Guard 2, before any transition to `completed`, enforcing
 *   that a login's own first changeover is fully verified before their next one
 *   closes — without coupling to other logins' independent lines.)
 *
 * Statuses are matched positively (never "NOT IN terminal") so legacy rows with
 * a NULL/free-text status can never block. Reads use the shared `db`, matching
 * countUnverifiedSplices in verification.ts; reads-then-writes are not wrapped
 * in a transaction (single-operator UI makes the create/create race negligible).
 */

export const BLOCKING_STATUSES = [
  "active",
  "pending_qa",
  "qa_in_review",
  "qa_confirmed",
  "active_splicing",
] as const;

export const TERMINAL_STATUSES = ["completed", "cancelled", "incomplete"] as const;

// Still counts as "unfinished" for FIFO if it is in a blocking status OR its
// splicing is sitting with QA (splicing_pending_qa).
export const UNFINISHED_STATUSES = [...BLOCKING_STATUSES, "splicing_pending_qa"] as const;

export interface BlockingSession {
  id: number;
  status: string;
  lineName: string | null;
  panelName: string | null;
}

// Sessions this actor may run: the changeover_operators rows where they are an
// accepted member (creator or accepted handover co-owner) — the same join the
// scoped session list / latest / detail reads use.
function ownedSessionIds(actorId: string) {
  return db
    .select({ sessionId: changeoverOperatorsTable.sessionId })
    .from(changeoverOperatorsTable)
    .where(
      and(
        eq(changeoverOperatorsTable.operatorId, actorId),
        eq(changeoverOperatorsTable.status, "accepted"),
      ),
    );
}

function sessionOwners(sessionId: number) {
  return db
    .select({ operatorId: changeoverOperatorsTable.operatorId })
    .from(changeoverOperatorsTable)
    .where(
      and(
        eq(changeoverOperatorsTable.sessionId, sessionId),
        eq(changeoverOperatorsTable.status, "accepted"),
      ),
    );
}

export async function findBlockingSession(actorId: string): Promise<BlockingSession | null> {
  const [session] = await db
    .select({
      id: sessionsTable.id,
      status: sessionsTable.status,
      lineName: sessionsTable.lineName,
      panelName: sessionsTable.panelName,
    })
    .from(sessionsTable)
    .where(
      and(
        isNull(sessionsTable.deletedAt),
        inArray(sessionsTable.status, [...BLOCKING_STATUSES] as string[]),
        inArray(sessionsTable.id, ownedSessionIds(actorId)),
      ),
    )
    .orderBy(asc(sessionsTable.id))
    .limit(1);

  return session ?? null;
}

export async function findEarlierUnfinished(sessionId: number): Promise<BlockingSession | null> {
  // An "earlier" changeover only matters if the SAME login owns both it and the
  // one being closed — otherwise independent lines on other logins would couple.
  const owners = await sessionOwners(sessionId);
  const ownerIds = owners.map((o) => o.operatorId);
  if (ownerIds.length === 0) return null;

  const [session] = await db
    .select({
      id: sessionsTable.id,
      status: sessionsTable.status,
      lineName: sessionsTable.lineName,
      panelName: sessionsTable.panelName,
    })
    .from(sessionsTable)
    .where(
      and(
        lt(sessionsTable.id, sessionId),
        isNull(sessionsTable.deletedAt),
        inArray(sessionsTable.status, [...UNFINISHED_STATUSES] as string[]),
        inArray(
          sessionsTable.id,
          db
            .select({ sessionId: changeoverOperatorsTable.sessionId })
            .from(changeoverOperatorsTable)
            .where(
              and(
                eq(changeoverOperatorsTable.status, "accepted"),
                inArray(changeoverOperatorsTable.operatorId, ownerIds),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(sessionsTable.id))
    .limit(1);

  return session ?? null;
}
