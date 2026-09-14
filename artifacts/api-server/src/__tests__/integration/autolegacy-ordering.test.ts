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

// AUTO_LEGACY locks the next un-verified feeder from the order of GET /api/bom/:id, and
// the client uses the session's bomItemCount as its progress denominator. Both were wrong
// (raw row order; a non-distinct count), and the scan handler rejected MPNs that the
// client offered for feeders carrying more than one BOM row. These are the regressions.
describe.runIf(runIntegration)("AUTO_LEGACY ordering, progress count and multi-row scans", () => {
  let app: any;
  let db: any;
  let bomsTable: any;
  let bomItemsTable: any;
  let sessionsTable: any;
  let scanRecordsTable: any;
  let usersTable: any;

  let qaId = "";
  let qaCookie = "";
  const bomIds: number[] = [];
  const sessionIds: number[] = [];

  const XHR = { "X-Requested-With": "XMLHttpRequest" };

  async function createBom(
    label: string,
    items: Array<Record<string, unknown> & { feederNumber: string }>,
  ): Promise<number> {
    const [bom] = await db
      .insert(bomsTable)
      .values({ name: `it-autolegacy-${label}-${Date.now()}` })
      .returning({ id: bomsTable.id });
    bomIds.push(bom.id);

    for (const item of items) {
      await db.insert(bomItemsTable).values({ bomId: bom.id, quantity: 1, ...item });
    }
    return bom.id;
  }

  async function createSession(bomId: number): Promise<number> {
    const [session] = await db
      .insert(sessionsTable)
      .values({
        bomId,
        companyName: "IT Co",
        panelName: `it-autolegacy-${Date.now()}`,
        supervisorName: "IT Supervisor",
        operatorName: "IT Operator",
        shiftName: "A",
        shiftDate: "2026-01-01",
        verificationMode: "AUTO_LEGACY",
        status: "active",
      })
      .returning({ id: sessionsTable.id });
    sessionIds.push(session.id);
    return session.id;
  }

  beforeAll(async () => {
    app = (await import("../../app")).default;
    db = (await import("@workspace/db")).db;

    const schema: any = await import("@workspace/db/schema");
    bomsTable = schema.bomsTable;
    bomItemsTable = schema.bomItemsTable;
    sessionsTable = schema.sessionsTable;
    scanRecordsTable = schema.scanRecordsTable;
    usersTable = schema.usersTable;

    const stamp = Date.now();
    const [qa] = await db
      .insert(usersTable)
      .values({
        name: `it-autolegacy-qa-${stamp}`,
        employee_id: `it-autolegacy-qa-${stamp}`,
        password_hash: "testpass",
        role: "qa",
      })
      .returning({ id: usersTable.id });
    qaId = qa.id;

    // QA bypasses requireLegacySessionOwnership, so the test needs no ownership rows.
    const token = jwt.sign(
      {
        userId: qaId,
        username: "it-autolegacy-qa",
        name: "it-autolegacy-qa",
        role: "qa",
        mustChangePassword: false,
        jti: randomUUID(),
      },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" },
    );
    qaCookie = `smt_token=${token}`;
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
      await db.delete(bomItemsTable).where(inArray(bomItemsTable.bomId, bomIds));
      await db.delete(bomsTable).where(inArray(bomsTable.id, bomIds));
    }
    if (qaId) {
      await db.delete(usersTable).where(eq(usersTable.id, qaId));
    }
  });

  test("GET /bom/:id leads with sr_no '00' even when that row was inserted last", async () => {
    // Insertion order deliberately NOT the BOM order — this is BOM 3's real shape, where
    // sr_no "00" (the true first feeder) sits 13th by row id.
    const bomId = await createBom("srno", [
      { feederNumber: "YSMF021", srNo: "1" },
      { feederNumber: "YSMF022", srNo: "2" },
      { feederNumber: "YSMF030", srNo: "10" },
      { feederNumber: "YSMF020", srNo: "00" },
    ]);

    const res = await request(app).get(`/api/bom/${bomId}`).set("Cookie", qaCookie);

    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.feederNumber)).toEqual([
      "YSMF020",
      "YSMF021",
      "YSMF022",
      "YSMF030",
    ]);
  });

  test("GET /bom/:id falls back to a natural feeder order when sr_no is blank", async () => {
    const bomId = await createBom("blanksrno", [
      { feederNumber: "F10" },
      { feederNumber: "F2" },
      { feederNumber: "F8" },
    ]);

    const res = await request(app).get(`/api/bom/${bomId}`).set("Cookie", qaCookie);

    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.feederNumber)).toEqual(["F2", "F8", "F10"]);
  });

  test("session bomItemCount counts DISTINCT feeders, matching the pending_qa transition", async () => {
    // Two rows share F18. The auto-transition needs 2 distinct feeders, so a count of 3
    // would make the client's progress bar unreachable at 100%.
    const bomId = await createBom("dupfeeder", [
      { feederNumber: "F18", mpn1: "MPN-F18-A" },
      { feederNumber: "F18", mpn1: "MPN-F18-B" },
      { feederNumber: "F19", mpn1: "MPN-F19" },
    ]);
    const sessionId = await createSession(bomId);

    const res = await request(app)
      .get(`/api/sessions/${sessionId}`)
      .set("Cookie", qaCookie);

    expect(res.status).toBe(200);
    expect(res.body.bomItemCount).toBe(2);
  });

  test("a scan matching a NON-first row of a feeder is accepted", async () => {
    // The client offers every row's MPNs for a feeder (buildLegacyCandidates). Validating
    // only the first row rejected those scans and left AUTO_LEGACY stuck on that feeder.
    const bomId = await createBom("multirow", [
      { feederNumber: "F20", mpn1: "MPN-F20-PRIMARY" },
      { feederNumber: "F20", mpn1: "MPN-F20-ALT" },
    ]);
    const sessionId = await createSession(bomId);

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/scans`)
      .set("Cookie", qaCookie)
      .set(XHR)
      .send({
        sessionId,
        feederNumber: "F20",
        mpnOrInternalId: "MPN-F20-ALT",
        internalIdType: "mpn",
        verificationMode: "AUTO",
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  test("a genuinely wrong MPN is still rejected", async () => {
    const bomId = await createBom("reject", [{ feederNumber: "F21", mpn1: "MPN-F21" }]);
    const sessionId = await createSession(bomId);

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/scans`)
      .set("Cookie", qaCookie)
      .set(XHR)
      .send({
        sessionId,
        feederNumber: "F21",
        mpnOrInternalId: "SOMETHING-ELSE",
        internalIdType: "mpn",
        verificationMode: "AUTO",
      });

    expect(res.body.status).toBe("reject");
  });

  test("a slash-separated internal part number token is accepted", async () => {
    // The client's buildCandidates splits on [\s/]+; the server only split on whitespace.
    const bomId = await createBom("ipnslash", [
      { feederNumber: "F22", internalPartNumber: "RDSCAP0353/RDSCAP0312 YAGEO" },
    ]);
    const sessionId = await createSession(bomId);

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/scans`)
      .set("Cookie", qaCookie)
      .set(XHR)
      .send({
        sessionId,
        feederNumber: "F22",
        mpnOrInternalId: "RDSCAP0312",
        internalIdType: "internal_id",
        verificationMode: "AUTO",
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
