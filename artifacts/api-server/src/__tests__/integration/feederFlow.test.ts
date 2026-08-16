import { afterAll, beforeAll, describe, expect, test } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";

const testDatabaseUrl = process.env.DATABASE_URL_TEST;

if (testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl;
}

process.env.JWT_SECRET ??= "integration-test-secret";
process.env.ALLOWED_ORIGINS ??= "http://localhost:5173";

const runIntegration = Boolean(process.env.DATABASE_URL_TEST);

describe.runIf(runIntegration)("verification feeder flow integration", () => {
  let app: Awaited<typeof import("../../app")>["default"];
  let db: Awaited<typeof import("@workspace/db")>["db"];
  let usersTable: Awaited<typeof import("@workspace/db/schema")>["usersTable"];
  let bomsTable: Awaited<typeof import("@workspace/db/schema")>["bomsTable"];
  let bomItemsTable: Awaited<typeof import("@workspace/db/schema")>["bomItemsTable"];
  let changeoverSessionsTable: Awaited<typeof import("@workspace/db/schema")>["changeoverSessionsTable"];
  let feederScansTable: Awaited<typeof import("@workspace/db/schema")>["feederScansTable"];
  let generateSessionId: Awaited<typeof import("../../lib/generateSessionId")>["generateSessionId"];

  let operatorId = "";
  let otherOperatorId = "";
  let bomId = 0;
  let sessionId = "";
  let operatorCookie = "";
  let otherOperatorCookie = "";

  beforeAll(async () => {
    const appModule = await import("../../app");
    app = appModule.default;

    const dbModule = await import("@workspace/db");
    db = dbModule.db;

    const schemaModule = await import("@workspace/db/schema");
    usersTable = schemaModule.usersTable;
    bomsTable = schemaModule.bomsTable;
    bomItemsTable = schemaModule.bomItemsTable;
    changeoverSessionsTable = schemaModule.changeoverSessionsTable;
    feederScansTable = schemaModule.feederScansTable;

    const genModule = await import("../../lib/generateSessionId");
    generateSessionId = genModule.generateSessionId;

    const [operator] = await db
      .insert(usersTable)
      .values({
        name: `it-operator-${Date.now()}`,
        employee_id: `it-operator-${Date.now()}`,
        password_hash: "testpass",
        role: "operator",
      })
      .returning({ id: usersTable.id });

    const [otherOperator] = await db
      .insert(usersTable)
      .values({
        name: `it-operator-other-${Date.now()}`,
        employee_id: `it-operator-other-${Date.now()}`,
        password_hash: "testpass",
        role: "operator",
      })
      .returning({ id: usersTable.id });

    operatorId = operator.id;
    otherOperatorId = otherOperator.id;

    const [bom] = await db
      .insert(bomsTable)
      .values({
        name: `it-bom-${Date.now()}`,
        description: "Integration feeder flow BOM",
      })
      .returning({ id: bomsTable.id });

    bomId = bom.id;

    await db.insert(bomItemsTable).values({
      bomId,
      feederNumber: "YSM-001",
      itemName: "CAPACITOR",
      internalPartNumber: "RDSCAP0353 RDSCAP0312",
      make1: "KEMET",
      mpn1: "C0603C472K5RACAUTO",
      make2: "YAGEO",
      mpn2: "CC0603KRX7R9BB472",
      partNumber: "PN-IT-001",
      quantity: 1,
    });

    const [session] = await db
      .insert(changeoverSessionsTable)
      .values({
        id: await generateSessionId(),
        operatorId,
        bomId,
        status: "active",
      })
      .returning({ id: changeoverSessionsTable.id });

    sessionId = session.id;

    const token = jwt.sign(
      {
        userId: operatorId,
        username: "it-operator",
        role: "operator",
      },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" },
    );

    const otherToken = jwt.sign(
      {
        userId: otherOperatorId,
        username: "it-other-operator",
        role: "operator",
      },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" },
    );

    operatorCookie = `smt_token=${token}`;
    otherOperatorCookie = `smt_token=${otherToken}`;
  });

  afterAll(async () => {
    if (!db) {
      return;
    }

    if (sessionId) {
      await db
        .delete(feederScansTable)
        .where(eq(feederScansTable.sessionId, sessionId));

      await db
        .delete(changeoverSessionsTable)
        .where(eq(changeoverSessionsTable.id, sessionId));
    }

    if (bomId) {
      await db
        .delete(bomItemsTable)
        .where(eq(bomItemsTable.bomId, bomId));

      await db
        .delete(bomsTable)
        .where(eq(bomsTable.id, bomId));
    }

    if (operatorId) {
      await db.delete(usersTable).where(eq(usersTable.id, operatorId));
    }

    if (otherOperatorId) {
      await db.delete(usersTable).where(eq(usersTable.id, otherOperatorId));
    }
  });

  test("verifies valid scan, computes progress, and blocks non-owner scans", async () => {
    const scanRes = await request(app)
      .post("/api/verification/scan")
      .set("Cookie", [operatorCookie])
      .send({
        sessionId,
        feederNumber: "YSM-001",
        scannedValue: "C0603C472K5RACAUTO",
        lotCode: "LOT-001",
      });

    expect(scanRes.status).toBe(200);
    expect(scanRes.body.valid).toBe(true);
    expect(scanRes.body.matchedField).toBe("mpn1");
    expect(scanRes.body.progress).toEqual({ verified: 1, total: 1, percent: 100 });

    const progressRes = await request(app)
      .get(`/api/verification/sessions/${sessionId}/progress`)
      .set("Cookie", [operatorCookie]);

    expect(progressRes.status).toBe(200);
    expect(progressRes.body.verified).toBe(1);
    expect(progressRes.body.total).toBe(1);
    expect(progressRes.body.percent).toBe(100);
    expect(progressRes.body.verifiedFeeders).toContain("YSM-001");

    const duplicateRes = await request(app)
      .post("/api/verification/scan")
      .set("Cookie", [operatorCookie])
      .send({
        sessionId,
        feederNumber: "YSM-001",
        scannedValue: "C0603C472K5RACAUTO",
      });

    expect(duplicateRes.status).toBe(200);
    expect(duplicateRes.body.valid).toBe(false);
    expect(duplicateRes.body.errorCode).toBe("ALREADY_SCANNED");

    const forbiddenRes = await request(app)
      .post("/api/verification/scan")
      .set("Cookie", [otherOperatorCookie])
      .send({
        sessionId,
        feederNumber: "YSM-001",
        scannedValue: "CC0603KRX7R9BB472",
      });

    expect(forbiddenRes.status).toBe(403);
  });
});

test.skipIf(runIntegration)("requires DATABASE_URL_TEST to run real DB integration tests", () => {
  expect(process.env.DATABASE_URL_TEST).toBeUndefined();
});
