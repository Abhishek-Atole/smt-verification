import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// Item 3 (Module 4) — handover round-trip on the LIVE session model.
// Before this change the sender wrote `changeover_operators` while the
// recipient's banner read `session_handovers` (a disjoint, 0-row model), so a
// handover never surfaced and the recipient silently gained access with no
// Accept step. The invariant chain asserted here:
//   A hands #N to B  →  B sees it pending  →  B still has NO access
//   B accepts        →  B has access, pending list empties
//   (reject path)    →  B never gains access
// Needs real rows (ownership + join reads), so it is gated on DATABASE_URL_TEST
// exactly like ownership-l3.test.ts and skipped otherwise.
const testDatabaseUrl = process.env.DATABASE_URL_TEST;
const runIntegration = Boolean(testDatabaseUrl);

process.env.DATABASE_URL = testDatabaseUrl ?? process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "api-server-handover-secret-0123456789";
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? "api-server-handover-ADMIN-secret-0123456789";
process.env.AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET ?? "api-server-handover-audit-hmac-secret";
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "http://localhost:5173";
process.env.NODE_ENV = "development";
process.env.ADMIN_IP_ALLOWLIST = "";

const csrf = "XMLHttpRequest";
const OP_A_NAME = "HO Operator A";
const OP_B_NAME = "HO Operator B";

let app: import("express").Express;
let db: typeof import("@workspace/db")["db"];
let eq: typeof import("drizzle-orm")["eq"];
let usersTable: typeof import("@workspace/db/schema")["usersTable"];
let bomsTable: typeof import("@workspace/db/schema")["bomsTable"];
let sessionsTable: typeof import("@workspace/db/schema")["sessionsTable"];
let changeoverOperatorsTable: typeof import("@workspace/db/schema")["changeoverOperatorsTable"];
let signAccessToken: typeof import("../../lib/authTokens")["signAccessToken"];

const opAId = randomUUID();
const opBId = randomUUID();
let bomId: number;
let sessionId: number; // handed over and accepted
let rejectSessionId: number; // handed over and rejected

function cookie(role: string, userId: string, name: string): string {
  const token = signAccessToken({
    userId, username: `ho-${role}-${userId.slice(0, 8)}`, name,
    role: role as never, mustChangePassword: false, jti: randomUUID(),
  });
  return `smt_token=${token}`;
}

let cookieA: string, cookieB: string;

async function seedSession(): Promise<number> {
  // operatorName is deliberately A's name so the legacy by-name owner path also
  // resolves to A — B must go through the join table, which is what we test.
  const [row] = await db.insert(sessionsTable).values({
    bomId, companyName: "HO Co", panelName: "P1", supervisorName: "SV1",
    operatorName: OP_A_NAME, shiftName: "A", shiftDate: "2026-01-01",
  }).returning({ id: sessionsTable.id });
  await db.insert(changeoverOperatorsTable).values({
    sessionId: row.id, operatorId: opAId, role: "creator", status: "accepted",
  });
  return row.id;
}

describe.runIf(runIntegration)("handover accept/reject round-trip (real DB)", () => {
  beforeAll(async () => {
    app = (await import("../../app")).default;
    ({ db } = await import("@workspace/db"));
    ({ eq } = await import("drizzle-orm"));
    ({ signAccessToken } = await import("../../lib/authTokens"));
    const schema = await import("@workspace/db/schema");
    usersTable = schema.usersTable;
    bomsTable = schema.bomsTable;
    sessionsTable = schema.sessionsTable;
    changeoverOperatorsTable = schema.changeoverOperatorsTable;

    app.set("trust proxy", 1);

    await db.insert(usersTable).values([
      { id: opAId, name: OP_A_NAME, role: "operator", employee_id: `HO-A-${Date.now()}` },
      { id: opBId, name: OP_B_NAME, role: "operator", employee_id: `HO-B-${Date.now()}` },
    ]);
    const [bom] = await db.insert(bomsTable)
      .values({ name: `ho-bom-${Date.now()}`, description: "handover fixture" })
      .returning({ id: bomsTable.id });
    bomId = bom.id;

    sessionId = await seedSession();
    rejectSessionId = await seedSession();

    cookieA = cookie("operator", opAId, OP_A_NAME);
    cookieB = cookie("operator", opBId, OP_B_NAME);
  });

  afterAll(async () => {
    if (!db) return;
    for (const id of [sessionId, rejectSessionId]) {
      if (id) await db.delete(sessionsTable).where(eq(sessionsTable.id, id)); // cascades co-owners
    }
    if (bomId) await db.delete(bomsTable).where(eq(bomsTable.id, bomId));
    await db.delete(usersTable).where(eq(usersTable.id, opAId));
    await db.delete(usersTable).where(eq(usersTable.id, opBId));
  });

  test("B has no access to A's changeover before any handover", async () => {
    const res = await request(app).get(`/api/sessions/${sessionId}`).set("Cookie", cookieB);
    expect(res.status).toBe(403);
  });

  test("A initiates handover → B sees it pending but still has NO access", async () => {
    const init = await request(app)
      .post(`/api/sessions/${sessionId}/handover`)
      .set("Cookie", cookieA)
      .set("X-Requested-With", csrf)
      .send({ toOperatorId: opBId, notes: "night shift" });
    expect(init.status).toBe(201);

    const pending = await request(app)
      .get("/api/verification/handover/pending")
      .set("Cookie", cookieB);
    expect(pending.status).toBe(200);
    const mine = pending.body.handovers.find((h: { sessionId: number }) => h.sessionId === sessionId);
    expect(mine).toEqual(expect.objectContaining({
      sessionId, status: "pending", notes: "night shift", fromOperatorName: OP_A_NAME,
    }));

    // The whole point of the explicit-Accept model: pending ≠ access.
    const denied = await request(app).get(`/api/sessions/${sessionId}`).set("Cookie", cookieB);
    expect(denied.status).toBe(403);

    // ...and it must not leak into B's scoped changeover list either.
    const list = await request(app).get("/api/sessions").set("Cookie", cookieB);
    expect(list.body.map((s: { id: number }) => s.id)).not.toContain(sessionId);
  });

  test("B accepts → gains access, and the pending list empties", async () => {
    const accept = await request(app)
      .post(`/api/verification/handover/${sessionId}/accept`)
      .set("Cookie", cookieB)
      .set("X-Requested-With", csrf);
    expect(accept.status).toBe(200);

    const granted = await request(app).get(`/api/sessions/${sessionId}`).set("Cookie", cookieB);
    expect(granted.status).not.toBe(403);

    const list = await request(app).get("/api/sessions").set("Cookie", cookieB);
    expect(list.body.map((s: { id: number }) => s.id)).toContain(sessionId);

    const pending = await request(app)
      .get("/api/verification/handover/pending")
      .set("Cookie", cookieB);
    expect(pending.body.handovers.find((h: { sessionId: number }) => h.sessionId === sessionId)).toBeUndefined();
  });

  test("accepting twice → 404 (no pending row left)", async () => {
    const again = await request(app)
      .post(`/api/verification/handover/${sessionId}/accept`)
      .set("Cookie", cookieB)
      .set("X-Requested-With", csrf);
    expect(again.status).toBe(404);
  });

  test("B rejects a second handover → never gains access", async () => {
    await request(app)
      .post(`/api/sessions/${rejectSessionId}/handover`)
      .set("Cookie", cookieA)
      .set("X-Requested-With", csrf)
      .send({ toOperatorId: opBId, notes: "wrong person" })
      .expect(201);

    const reject = await request(app)
      .post(`/api/verification/handover/${rejectSessionId}/reject`)
      .set("Cookie", cookieB)
      .set("X-Requested-With", csrf);
    expect(reject.status).toBe(200);

    const denied = await request(app).get(`/api/sessions/${rejectSessionId}`).set("Cookie", cookieB);
    expect(denied.status).toBe(403);

    const pending = await request(app)
      .get("/api/verification/handover/pending")
      .set("Cookie", cookieB);
    expect(pending.body.handovers.find((h: { sessionId: number }) => h.sessionId === rejectSessionId)).toBeUndefined();
  });

  test("a rejected handover can be re-armed: A hands over again → pending again", async () => {
    await request(app)
      .post(`/api/sessions/${rejectSessionId}/handover`)
      .set("Cookie", cookieA)
      .set("X-Requested-With", csrf)
      .send({ toOperatorId: opBId, notes: "retry" })
      .expect(201);

    const pending = await request(app)
      .get("/api/verification/handover/pending")
      .set("Cookie", cookieB);
    expect(pending.body.handovers.find((h: { sessionId: number }) => h.sessionId === rejectSessionId))
      .toEqual(expect.objectContaining({ sessionId: rejectSessionId, notes: "retry", status: "pending" }));
  });

  test("a non-recipient cannot accept a handover addressed to someone else", async () => {
    const res = await request(app)
      .post(`/api/verification/handover/${rejectSessionId}/accept`)
      .set("Cookie", cookieA)
      .set("X-Requested-With", csrf);
    expect(res.status).toBe(404); // A has an 'accepted' creator row, not a pending one
  });
});

test.skipIf(runIntegration)("handover round-trip requires DATABASE_URL_TEST", () => {
  expect(process.env.DATABASE_URL_TEST).toBeUndefined();
});
