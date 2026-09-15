import { afterAll, beforeAll, describe, expect, test } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";

const testDatabaseUrl = process.env.DATABASE_URL_TEST;

if (testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl;
}

process.env.JWT_SECRET ??= "integration-test-secret";
process.env.ALLOWED_ORIGINS ??= "http://localhost:5173";

const runIntegration = Boolean(process.env.DATABASE_URL_TEST);

// `qa_name` is what the final report prints under QA Engineer (PDF approvals block, XLSX
// "QA" row, on-screen report). The confirmation routes also admit supervisors and admins,
// and used to stamp the ACTING user's name into it — so a supervisor's confirmation made
// the report show a supervisor as the QA engineer. Session 83 in dev reached exactly that
// state (qa_name "Supervisor 1" with supervisor_name "Maroti Biradar").
describe.runIf(runIntegration)("QA name attribution on confirmation", () => {
  let app: any;
  let db: any;
  let bomsTable: any;
  let sessionsTable: any;
  let scanRecordsTable: any;
  let usersTable: any;

  const ASSIGNED_QA = "Assigned QA Person";
  const SUPERVISOR_NAME = "it-supervisor";
  const QA_NAME = "it-qa";

  let supervisorCookie = "";
  let qaCookie = "";
  const supervisorIds: string[] = [];
  const sessionIds: number[] = [];
  const bomIds: number[] = [];

  const XHR = { "X-Requested-With": "XMLHttpRequest" };

  function tokenFor(userId: string, name: string, role: string): string {
    return jwt.sign(
      { userId, username: name, name, role, mustChangePassword: false, jti: randomUUID() },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" },
    );
  }

  async function createPendingSession(): Promise<number> {
    const [bom] = await db
      .insert(bomsTable)
      .values({ name: `it-qaname-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
      .returning({ id: bomsTable.id });
    bomIds.push(bom.id);

    const [session] = await db
      .insert(sessionsTable)
      .values({
        bomId: bom.id,
        companyName: "IT Co",
        panelName: `it-qaname-${Date.now()}`,
        supervisorName: "Assigned Supervisor",
        operatorName: "IT Operator",
        qaName: ASSIGNED_QA,
        shiftName: "A",
        shiftDate: "2026-01-01",
        verificationMode: "AUTO",
        status: "pending_qa",
      })
      .returning({ id: sessionsTable.id });
    sessionIds.push(session.id);
    return session.id;
  }

  async function readQaName(sessionId: number): Promise<string | null> {
    const [row] = await db
      .select({ qaName: sessionsTable.qaName })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId));
    return row?.qaName ?? null;
  }

  beforeAll(async () => {
    app = (await import("../../app")).default;
    db = (await import("@workspace/db")).db;

    const schema: any = await import("@workspace/db/schema");
    bomsTable = schema.bomsTable;
    sessionsTable = schema.sessionsTable;
    scanRecordsTable = schema.scanRecordsTable;
    usersTable = schema.usersTable;

    const stamp = Date.now();
    for (const [name, role] of [
      [SUPERVISOR_NAME, "supervisor"],
      [QA_NAME, "qa"],
    ] as const) {
      const [user] = await db
        .insert(usersTable)
        .values({
          name,
          employee_id: `${name}-${stamp}`,
          password_hash: "testpass",
          role,
        })
        .returning({ id: usersTable.id });
      supervisorIds.push(user.id);
      const cookie = `smt_token=${tokenFor(user.id, name, role)}`;
      if (role === "supervisor") supervisorCookie = cookie;
      else qaCookie = cookie;
    }
  });

  afterAll(async () => {
    if (!db) {
      return;
    }
    if (sessionIds.length > 0) {
      await db.delete(scanRecordsTable).where(inArray(scanRecordsTable.sessionId, sessionIds));
      await db.delete(sessionsTable).where(inArray(sessionsTable.id, sessionIds));
    }
    if (bomIds.length > 0) {
      await db.delete(bomsTable).where(inArray(bomsTable.id, bomIds));
    }
    if (supervisorIds.length > 0) {
      await db.delete(usersTable).where(inArray(usersTable.id, supervisorIds));
    }
  });

  test("a supervisor's confirmation keeps the assigned QA name", async () => {
    const sessionId = await createPendingSession();

    const res = await request(app)
      .post(`/api/verification/qa-queue/${sessionId}/manual-confirm`)
      .set("Cookie", supervisorCookie)
      .set(XHR)
      .send({});

    expect(res.status).toBe(200);
    // The bug: this used to become SUPERVISOR_NAME, so the report showed a supervisor
    // under "QA Engineer".
    expect(await readQaName(sessionId)).toBe(ASSIGNED_QA);
  });

  test("a QA's confirmation still stamps their own name", async () => {
    const sessionId = await createPendingSession();

    const res = await request(app)
      .post(`/api/verification/qa-queue/${sessionId}/manual-confirm`)
      .set("Cookie", qaCookie)
      .set(XHR)
      .send({});

    expect(res.status).toBe(200);
    expect(await readQaName(sessionId)).toBe(QA_NAME);
  });

  test("the session still reaches qa_confirmed either way", async () => {
    const sessionId = await createPendingSession();

    await request(app)
      .post(`/api/verification/qa-queue/${sessionId}/manual-confirm`)
      .set("Cookie", supervisorCookie)
      .set(XHR)
      .send({});

    const [row] = await db
      .select({ status: sessionsTable.status })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId));
    expect(row?.status).toBe("qa_confirmed");
  });
});
