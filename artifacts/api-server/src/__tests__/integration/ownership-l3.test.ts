import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// L3 — ownership / IDOR guards. These are the only guards that consult real
// rows (operator-owns-THIS-session), so unlike L0-L2 they cannot run against a
// mocked DB — they need a live schema. Gated on DATABASE_URL_TEST; skipped
// otherwise (mirrors the existing integration harness). Covers all three wired
// ownership middlewares:
//   - requireChangeoverSessionAccess  (verification read routes, UUID :sessionId)
//   - requireOperatorSessionOwnership  (POST /verification/scan, body.sessionId)
//   - requireLegacySessionOwnership    (sessions.ts, integer :sessionId)
// We assert the ACCESS DECISION (403 vs. cleared-the-guard). The fire-and-forget
// UNAUTHORIZED_ACCESS audit side-effect is out of scope (async, best-effort).
const testDatabaseUrl = process.env.DATABASE_URL_TEST;
const runIntegration = Boolean(testDatabaseUrl);

process.env.DATABASE_URL = testDatabaseUrl ?? process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "api-server-ownership-l3-secret-0123456789";
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? "api-server-ownership-l3-ADMIN-secret-0123456789";
process.env.AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET ?? "api-server-ownership-l3-audit-hmac-secret";
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "http://localhost:5173";
process.env.NODE_ENV = "development";
process.env.ADMIN_IP_ALLOWLIST = "";

const csrf = "XMLHttpRequest";
const OP_A_NAME = "L3 Operator A";

// Populated in beforeAll (only runs inside the runIf-gated describe).
let app: import("express").Express;
let db: typeof import("@workspace/db")["db"];
let eq: typeof import("drizzle-orm")["eq"];
let usersTable: typeof import("@workspace/db/schema")["usersTable"];
let bomsTable: typeof import("@workspace/db/schema")["bomsTable"];
let changeoverSessionsTable: typeof import("@workspace/db/schema")["changeoverSessionsTable"];
let sessionsTable: typeof import("@workspace/db/schema")["sessionsTable"];

const opAId = randomUUID();
let signAccessToken: typeof import("../../lib/authTokens")["signAccessToken"];
let bomId: number;
let legacySessionId: number;
const changeoverId = `SMT_L3_${Date.now()}`;

// Direct-minted cookies — attachActor decodes the JWT, it does not look the user
// up in the DB, so only opA needs a real row (the changeover FK references it).
function cookie(role: string, userId: string, name: string): string {
  const token = signAccessToken({
    userId, username: `l3-${role}-${userId.slice(0, 8)}`, name,
    role: role as never, mustChangePassword: false, jti: randomUUID(),
  });
  return `smt_token=${token}`;
}

let cookieA: string, cookieB: string, cookieQA: string, cookieStore: string;

describe.runIf(runIntegration)("L3 ownership guards (real DB)", () => {
  beforeAll(async () => {
    app = (await import("../../app")).default;
    ({ db } = await import("@workspace/db"));
    ({ eq } = await import("drizzle-orm"));
    ({ signAccessToken } = await import("../../lib/authTokens"));
    const schema = await import("@workspace/db/schema");
    usersTable = schema.usersTable;
    bomsTable = schema.bomsTable;
    changeoverSessionsTable = schema.changeoverSessionsTable;
    sessionsTable = schema.sessionsTable;

    app.set("trust proxy", 1);

    await db.insert(usersTable).values({
      id: opAId, name: OP_A_NAME, role: "operator", employee_id: `L3-${Date.now()}`,
    });
    const [bom] = await db.insert(bomsTable)
      .values({ name: `l3-bom-${Date.now()}`, description: "L3 ownership fixture" })
      .returning({ id: bomsTable.id });
    bomId = bom.id;

    await db.insert(changeoverSessionsTable).values({ id: changeoverId, operatorId: opAId, bomId });

    const [legacy] = await db.insert(sessionsTable).values({
      bomId, companyName: "L3 Co", panelName: "P1", supervisorName: "SV1",
      operatorName: OP_A_NAME, shiftName: "A", shiftDate: "2026-01-01",
    }).returning({ id: sessionsTable.id });
    legacySessionId = legacy.id;

    cookieA = cookie("operator", opAId, OP_A_NAME);
    cookieB = cookie("operator", randomUUID(), "L3 Operator B");
    cookieQA = cookie("qa", randomUUID(), "L3 QA");
    cookieStore = cookie("storekeeper", randomUUID(), "L3 Store");
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(changeoverSessionsTable).where(eq(changeoverSessionsTable.id, changeoverId));
    if (legacySessionId) await db.delete(sessionsTable).where(eq(sessionsTable.id, legacySessionId));
    if (bomId) await db.delete(bomsTable).where(eq(bomsTable.id, bomId));
    await db.delete(usersTable).where(eq(usersTable.id, opAId));
  });

  // ── requireChangeoverSessionAccess — GET /verification/sessions/:id/progress ─
  describe("changeover read access (UUID session)", () => {
    const url = () => `/api/verification/sessions/${changeoverId}/progress`;

    test("owner operator clears the guard (not 403)", async () => {
      const res = await request(app).get(url()).set("Cookie", cookieA);
      expect(res.status).not.toBe(403);
    });

    test("non-owner operator → 403", async () => {
      const res = await request(app).get(url()).set("Cookie", cookieB);
      expect(res.status).toBe(403);
    });

    test("qa bypasses ownership (not 403)", async () => {
      const res = await request(app).get(url()).set("Cookie", cookieQA);
      expect(res.status).not.toBe(403);
    });

    test("storekeeper (disallowed role) → 403", async () => {
      const res = await request(app).get(url()).set("Cookie", cookieStore);
      expect(res.status).toBe(403);
    });
  });

  // ── requireOperatorSessionOwnership — POST /verification/scan (body.sessionId) ─
  describe("operator scan ownership", () => {
    const post = (ck: string) =>
      request(app).post("/api/verification/scan").set("Cookie", ck)
        .set("X-Requested-With", csrf).send({ sessionId: changeoverId });

    test("owner operator clears the guard (not 403)", async () => {
      const res = await post(cookieA);
      expect(res.status).not.toBe(403); // may 400 downstream (no scan payload) — guard passed
    });

    test("non-owner operator → 403 (session does not belong to operator)", async () => {
      const res = await post(cookieB);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(expect.objectContaining({ error: "Forbidden: session does not belong to operator" }));
    });

    test("qa cannot post scans → 403 (operator-only)", async () => {
      const res = await post(cookieQA);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(expect.objectContaining({ error: "Only operators can post scans" }));
    });
  });

  // ── requireLegacySessionOwnership — GET /sessions/:id (integer) ───────────────
  describe("legacy session ownership (integer session)", () => {
    const url = () => `/api/sessions/${legacySessionId}`;

    test("owner operator (name matches operator_name) clears the guard (not 403)", async () => {
      const res = await request(app).get(url()).set("Cookie", cookieA);
      expect(res.status).not.toBe(403);
    });

    test("non-owner operator → 403 (changeover does not belong to you)", async () => {
      const res = await request(app).get(url()).set("Cookie", cookieB);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(expect.objectContaining({ error: "Forbidden: changeover does not belong to you" }));
    });

    test("qa bypasses ownership (not 403)", async () => {
      const res = await request(app).get(url()).set("Cookie", cookieQA);
      expect(res.status).not.toBe(403);
    });
  });
});

test.skipIf(runIntegration)("L3 requires DATABASE_URL_TEST to run real ownership tests", () => {
  expect(process.env.DATABASE_URL_TEST).toBeUndefined();
});
