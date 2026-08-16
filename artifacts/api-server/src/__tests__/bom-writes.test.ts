import request from "supertest";
import { randomUUID } from "crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Env before importing the app (mirrors admin-audit-events.test.ts). JWT_SECRET
// must be ≥32 chars and differ from JWT_ADMIN_SECRET.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "api-server-bom-writes-test-secret-value";
process.env.JWT_ADMIN_SECRET = "api-server-bom-writes-test-ADMIN-secret-value";
process.env.ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:3000";
process.env.NODE_ENV = "development";
process.env.ADMIN_IP_ALLOWLIST = "";

const USER_ID = "33333333-3333-3333-3333-333333333333";

const mocks = vi.hoisted(() => {
  return {
    auditLog: vi.fn().mockResolvedValue(undefined),
    verifyAuditChain: vi.fn().mockResolvedValue({ total: 0, brokenAt: null }),
    pushNotification: vi.fn().mockResolvedValue(undefined),
    compare: vi.fn().mockResolvedValue(true),
    // verify-password: db.select({...}).from().where() → [{ password_hash }].
    // Also serves the BOM status/session routes which read name/deletedAt/status
    // off the same shape (status defaults to active unless a test overrides it).
    select: vi.fn(() => ({
      from: () => ({ where: () => Promise.resolve([{ password_hash: "$2a$10$mockhash", name: "Test BOM", deletedAt: null, status: "active" }]) }),
    })),
    // db.update().set().where().returning() → [row]
    update: vi.fn(() => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([{ id: 1, name: "Test BOM", status: "locked" }]),
        }),
      }),
    })),
    // POST /bom: db.insert().values().returning() → [row]
    insert: vi.fn(() => ({
      values: () => ({
        returning: () =>
          Promise.resolve([
            {
              id: 1,
              name: "Test BOM",
              description: null,
              revisionLabel: null,
              revisionNotes: null,
              createdAt: "2026-08-15T00:00:00.000Z",
            },
          ]),
      }),
    })),
  };
});

vi.mock("@workspace/db", () => ({
  db: { select: mocks.select, insert: mocks.insert, update: mocks.update },
  pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
}));

vi.mock("../lib/auditLogger", () => ({
  auditLog: mocks.auditLog,
  verifyAuditChain: mocks.verifyAuditChain,
}));

vi.mock("../lib/notify", () => ({
  pushNotification: mocks.pushNotification,
}));

vi.mock("bcryptjs", () => ({
  default: { compare: mocks.compare },
}));

const app = (await import("../app")).default;
const { signAccessToken } = await import("../lib/authTokens");

app.set("trust proxy", 1);

// A valid supervisor access-token cookie (mustChangePassword:false so attachActor
// doesn't 423). The token is verified with the real JWT_SECRET set above.
function supervisorCookie(): string {
  const token = signAccessToken({
    userId: USER_ID,
    username: "engineer1",
    name: "Engineer One",
    role: "supervisor",
    mustChangePassword: false,
    jti: randomUUID(),
  });
  return `smt_token=${token}`;
}

const csrf = "XMLHttpRequest";

beforeEach(() => {
  mocks.auditLog.mockClear();
  mocks.pushNotification.mockClear();
  mocks.compare.mockReset().mockResolvedValue(true);
  mocks.select.mockClear();
  mocks.insert.mockClear();
  mocks.update.mockClear();
});

describe("POST /auth/verify-password (step-up self-confirm)", () => {
  test("correct password → 200 { valid: true }", async () => {
    mocks.compare.mockResolvedValue(true);
    const res = await request(app)
      .post("/api/auth/verify-password")
      .set("Cookie", supervisorCookie())
      .set("X-Requested-With", csrf)
      .send({ password: "correct-horse" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true });
  });

  test("wrong password → 401", async () => {
    mocks.compare.mockResolvedValue(false);
    const res = await request(app)
      .post("/api/auth/verify-password")
      .set("Cookie", supervisorCookie())
      .set("X-Requested-With", csrf)
      .send({ password: "wrong" });

    expect(res.status).toBe(401);
  });

  test("missing password → 400", async () => {
    const res = await request(app)
      .post("/api/auth/verify-password")
      .set("Cookie", supervisorCookie())
      .set("X-Requested-With", csrf)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe("BOM writes emit audit + notification", () => {
  test("POST /bom → 201, BOM_CREATED audit event, and a notification", async () => {
    const res = await request(app)
      .post("/api/bom")
      .set("Cookie", supervisorCookie())
      .set("X-Requested-With", csrf)
      .send({ name: "Test BOM" });

    expect(res.status).toBe(201);
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "BOM_CREATED" }));
    expect(mocks.pushNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success", entityId: "1" }),
    );
  });
});

describe("PATCH /bom/:id/status (revision lock/release/hold)", () => {
  test("lock → 200, BOM_LOCKED audit event + notification", async () => {
    const res = await request(app)
      .patch("/api/bom/1/status")
      .set("Cookie", supervisorCookie())
      .set("X-Requested-With", csrf)
      .send({ status: "locked" });

    expect(res.status).toBe(200);
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "BOM_LOCKED" }));
    expect(mocks.pushNotification).toHaveBeenCalledWith(expect.objectContaining({ entityId: "1" }));
  });

  test("release → BOM_RELEASED audit event", async () => {
    const res = await request(app)
      .patch("/api/bom/1/status")
      .set("Cookie", supervisorCookie())
      .set("X-Requested-With", csrf)
      .send({ status: "active" });

    expect(res.status).toBe(200);
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "BOM_RELEASED" }));
  });

  test("invalid status → 400, no audit event", async () => {
    const res = await request(app)
      .patch("/api/bom/1/status")
      .set("Cookie", supervisorCookie())
      .set("X-Requested-With", csrf)
      .send({ status: "bogus" });

    expect(res.status).toBe(400);
    expect(mocks.auditLog).not.toHaveBeenCalled();
  });
});

describe("POST /sessions rejects a locked BOM", () => {
  test("locked BOM → 409, no session created", async () => {
    // Next db.select (the session route's status lookup) returns a locked BOM.
    mocks.select.mockReturnValueOnce({
      from: () => ({ where: () => Promise.resolve([{ status: "locked" }]) }),
    } as any);

    const res = await request(app)
      .post("/api/sessions")
      .set("Cookie", supervisorCookie())
      .set("X-Requested-With", csrf)
      .send({
        bomId: 1,
        companyName: "Acme",
        panelName: "P1",
        supervisorName: "Sup",
        operatorName: "Op",
        shiftName: "A",
        shiftDate: "2026-08-15",
      });

    expect(res.status).toBe(409);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
