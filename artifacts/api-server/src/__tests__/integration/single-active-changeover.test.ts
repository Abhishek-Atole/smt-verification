import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// Single-active-changeover workflow, scoped PER LOGIN (approved change). Guards
// a reported bug: a second changeover started overrode the first. Confirmed rules
// with the user:
//   1. A single login (an accepted owner of the session) may run at most ONE
//      changeover at a time — a session they own in a BLOCKING status
//      (active → active_splicing) prevents them starting another.
//   2. The next may start once their current changeover's splicing is SUBMITTED
//      to QA (status = splicing_pending_qa) — the unlock point.
//   3. FIFO close — their EARLIER changeover must reach a terminal status
//      (completed/cancelled/incomplete) before a LATER one of theirs may complete.
//   4. Different logins on different lines are INDEPENDENT — they never block
//      each other's start or close.
// Needs real rows + the create/complete endpoints, so it is gated on
// DATABASE_URL_TEST exactly like handover-accept.test.ts and skipped otherwise.
const testDatabaseUrl = process.env.DATABASE_URL_TEST;
const runIntegration = Boolean(testDatabaseUrl);

process.env.DATABASE_URL = testDatabaseUrl ?? process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "api-server-single-active-secret-0123456789";
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? "api-server-single-active-ADMIN-secret-0123456789";
process.env.AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET ?? "api-server-single-active-audit-hmac-secret";
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "http://localhost:5173";
process.env.NODE_ENV = "development";
process.env.ADMIN_IP_ALLOWLIST = "";

const csrf = "XMLHttpRequest";

let app: import("express").Express;
let db: typeof import("@workspace/db")["db"];
let eq: typeof import("drizzle-orm")["eq"];
let usersTable: typeof import("@workspace/db/schema")["usersTable"];
let bomsTable: typeof import("@workspace/db/schema")["bomsTable"];
let bomItemsTable: typeof import("@workspace/db/schema")["bomItemsTable"];
let sessionsTable: typeof import("@workspace/db/schema")["sessionsTable"];
let signAccessToken: typeof import("../../lib/authTokens")["signAccessToken"];

const qaId = randomUUID(); // actor A — QA who can create + close
const opBId = randomUUID(); // actor B — independent operator
let bomId: number;
const createdIds: number[] = [];

function cookie(userId: string, name: string, role: "qa" | "operator"): string {
  const token = signAccessToken({
    userId,
    username: `sa-${role}-${userId.slice(0, 8)}`,
    name,
    role,
    mustChangePassword: false,
    jti: randomUUID(),
  });
  return `smt_token=${token}`;
}
const cookieA = () => cookie(qaId, "SingleActive QA", "qa");
const cookieB = () => cookie(opBId, "SA Operator B", "operator");

function createBody(panel: string) {
  return {
    bomId,
    companyName: "SA Co",
    panelName: panel,
    supervisorName: "SA Roster Supervisor",
    qaName: "SA Roster QA",
    operatorName: "SA Operator",
    shiftName: "Morning",
    shiftDate: "2026-01-01",
    lineName: "SA-L1",
    machineName: "SA-M1",
  };
}

async function insertSession(panel: string, status: string): Promise<number> {
  const [row] = await db
    .insert(sessionsTable)
    .values({
      bomId, companyName: "SA Co", panelName: panel, supervisorName: "SA Supervisor",
      operatorName: "SA Operator", shiftName: "Morning", shiftDate: "2026-01-01",
      lineName: "SA-L1", machineName: "SA-M1",
      status: status as never,
    })
    .returning({ id: sessionsTable.id });
  createdIds.push(row.id);
  return row.id;
}

async function setStatus(id: number, status: string): Promise<void> {
  await db.update(sessionsTable).set({ status: status as never }).where(eq(sessionsTable.id, id));
}

describe.runIf(runIntegration)("single-active changeover per login + FIFO close (real DB)", () => {
  beforeAll(async () => {
    app = (await import("../../app")).default;
    ({ db } = await import("@workspace/db"));
    ({ eq } = await import("drizzle-orm"));
    ({ signAccessToken } = await import("../../lib/authTokens"));
    const schema = await import("@workspace/db/schema");
    usersTable = schema.usersTable;
    bomsTable = schema.bomsTable;
    bomItemsTable = schema.bomItemsTable;
    sessionsTable = schema.sessionsTable;

    app.set("trust proxy", 1);

    await db.insert(usersTable).values([
      { id: qaId, name: "SingleActive QA", role: "qa", employee_id: `SA-QA-${Date.now()}` },
      { id: opBId, name: "SA Operator B", role: "operator", employee_id: `SA-OPB-${Date.now()}` },
    ]);
    const [bom] = await db.insert(bomsTable)
      .values({ name: `sa-bom-${Date.now()}`, description: "single-active fixture" })
      .returning({ id: bomsTable.id });
    bomId = bom.id;
  });

  afterAll(async () => {
    if (!db) return;
    for (const id of createdIds) {
      await db.delete(sessionsTable).where(eq(sessionsTable.id, id));
    }
    if (bomId) await db.delete(bomsTable).where(eq(bomsTable.id, bomId));
    await db.delete(usersTable).where(eq(usersTable.id, qaId));
    await db.delete(usersTable).where(eq(usersTable.id, opBId));
  });

  test("A: create succeeds when A owns no blocking changeover", async () => {
    const res = await request(app)
      .post("/api/sessions")
      .set("Cookie", cookieA())
      .set("X-Requested-With", csrf)
      .send(createBody("SA-Panel-OK"));
    expect(res.status).toBe(201);
    createdIds.push(res.body.id);
    expect(res.body.status).toBe("active");
    // The operator of record must be the actor's REAL name (users.name), not the
    // login/username the body sent (createBody sends operatorName "SA Operator").
    expect(res.body.operatorName).toBe("SingleActive QA");
  });

  test("report payload carries the real operator name + roster QA/supervisor names", async () => {
    const sessionId = createdIds[createdIds.length - 1];
    const res = await request(app)
      .get(`/api/sessions/${sessionId}/report`)
      .set("Cookie", cookieA());
    expect(res.status).toBe(200);
    // Operator = resolved real name (users.name), overriding the body's login-ish value.
    expect(res.body.session.operatorName).toBe("SingleActive QA");
    // QA and Supervisor = whatever engineer names were chosen from the roster.
    expect(res.body.session.qaName).toBe("SA Roster QA");
    expect(res.body.session.supervisorName).toBe("SA Roster Supervisor");
  });

  test("A: create is blocked while A owns an active changeover", async () => {
    const activeId = createdIds[createdIds.length - 1];
    const res = await request(app)
      .post("/api/sessions")
      .set("Cookie", cookieA())
      .set("X-Requested-With", csrf)
      .send(createBody("SA-Panel-Blocked"));
    expect(res.status).toBe(409);
    expect(res.body.blockingSession?.id).toBe(activeId);
  });

  test("B: a DIFFERENT login can start while A's changeover is active (per-login independence)", async () => {
    const res = await request(app)
      .post("/api/sessions")
      .set("Cookie", cookieB())
      .set("X-Requested-With", csrf)
      .send({ ...createBody("SA-Panel-B"), lineName: "SA-L2", machineName: "SA-M2" });
    expect(res.status).toBe(201);
    createdIds.push(res.body.id);
    expect(res.body.status).toBe("active");
  });

  test("A: create allowed once A's open changeover's splicing is submitted to QA", async () => {
    const openId = createdIds[0]; // A's first session, still active
    await setStatus(openId, "splicing_pending_qa"); // unlock point
    const res = await request(app)
      .post("/api/sessions")
      .set("Cookie", cookieA())
      .set("X-Requested-With", csrf)
      .send(createBody("SA-Panel-Next"));
    expect(res.status).toBe(201);
    createdIds.push(res.body.id);
    expect(res.body.status).toBe("active");
  });

  test("A: A's later changeover cannot close while A's earlier one is still open (FIFO)", async () => {
    const earlierId = createdIds[0]; // splicing_pending_qa
    const laterId = createdIds[createdIds.length - 1]; // A's second, currently active
    await setStatus(laterId, "splicing_pending_qa");

    const close = await request(app)
      .post(`/api/verification/qa-queue/${laterId}/complete`)
      .set("Cookie", cookieA())
      .set("X-Requested-With", csrf);
    expect(close.status).toBe(409);
    expect(close.body.earlierUnfinished?.id).toBe(earlierId);
  });

  test("B: B's changeover closes even though A has an earlier session open (no cross-login coupling)", async () => {
    const bSessionId = createdIds.find((id) => id !== createdIds[0] && id !== createdIds[2]) ?? createdIds[2];
    // createdIds: [A1, A-dup(never created), B, A2] → index: 0=A1, 2=B, 3=A2
    const earlierA = createdIds[0]; // A's open splicing_pending_qa, id < B's id
    expect(bSessionId).toBeGreaterThan(earlierA);
    await setStatus(bSessionId, "splicing_pending_qa");

    const closeB = await request(app)
      .post(`/api/verification/qa-queue/${bSessionId}/complete`)
      .set("Cookie", cookieA())
      .set("X-Requested-With", csrf);
    expect(closeB.status).toBe(200);
    expect(closeB.body.status).toBe("completed");
  });

  test("A: earlier closes first, then A's later one closes", async () => {
    const earlierId = createdIds[0];
    const laterId = createdIds[createdIds.length - 1]; // A2

    const closeEarlier = await request(app)
      .post(`/api/verification/qa-queue/${earlierId}/complete`)
      .set("Cookie", cookieA())
      .set("X-Requested-With", csrf);
    expect(closeEarlier.status).toBe(200);
    expect(closeEarlier.body.status).toBe("completed");

    const closeLater = await request(app)
      .post(`/api/verification/qa-queue/${laterId}/complete`)
      .set("Cookie", cookieA())
      .set("X-Requested-With", csrf);
    expect(closeLater.status).toBe(200);
    expect(closeLater.body.status).toBe("completed");
  });

  test("A: create allowed once all of A's changeovers are terminal", async () => {
    const res = await request(app)
      .post("/api/sessions")
      .set("Cookie", cookieA())
      .set("X-Requested-With", csrf)
      .send(createBody("SA-Panel-Final"));
    expect(res.status).toBe(201);
    createdIds.push(res.body.id);
    await setStatus(res.body.id, "completed");
  });

  test("GET /bom/:id returns items in sr_no sequence, not insertion order", async () => {
    // AUTO_LEGACY auto-advances feeders from this endpoint, so its order is what
    // the operator is prompted in. Insert deliberately OUT of sequence (sr_no
    // 2, then 0, then 1) — the response must still be F0, F1, F2.
    let orderBomId: number | undefined;
    try {
      const [b] = await db.insert(bomsTable)
        .values({ name: `order-bom-${Date.now()}` })
        .returning({ id: bomsTable.id });
      orderBomId = b.id;
      await db.insert(bomItemsTable).values([
        { bomId: b.id, feederNumber: "F2", partNumber: "P2", srNo: "2", quantity: 1 },
        { bomId: b.id, feederNumber: "F0", partNumber: "P0", srNo: "0", quantity: 1 },
        { bomId: b.id, feederNumber: "F1", partNumber: "P1", srNo: "1", quantity: 1 },
      ]);

      const res = await request(app)
        .get(`/api/bom/${b.id}`)
        .set("Cookie", cookieA());
      expect(res.status).toBe(200);
      expect(res.body.items.map((i: { feederNumber: string }) => i.feederNumber)).toEqual(["F0", "F1", "F2"]);
    } finally {
      if (orderBomId) {
        await db.delete(bomItemsTable).where(eq(bomItemsTable.bomId, orderBomId));
        await db.delete(bomsTable).where(eq(bomsTable.id, orderBomId));
      }
    }
  });
});
