import request from "supertest";
import { randomUUID } from "crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Admin routes are IP-allowlisted (empty = allow all) and cookie-authed with a
// SEPARATE secret from user JWTs. Set both before importing the app.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "api-server-admin-audit-test-secret";
process.env.JWT_ADMIN_SECRET = "api-server-admin-audit-test-ADMIN-secret"; // must differ from JWT_SECRET
process.env.ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:3000";
process.env.NODE_ENV = "development";
// Admin routes sit behind an optional IP allowlist (requireAdminIp). An
// inherited non-empty ADMIN_IP_ALLOWLIST would 404 every admin request from
// the supertest client IP. Empty = allow all — the correct unit-test posture.
process.env.ADMIN_IP_ALLOWLIST = "";

const TARGET_ID = "11111111-1111-1111-1111-111111111111";

// Chainable Drizzle mocks — each admin mutation route resolves through one of
// these. `.returning()` and `.execute()` both yield a single row so the
// happy-path (success) branch runs and reaches the auditLog() call.
const mocks = vi.hoisted(() => {
  const returning = vi.fn(() => Promise.resolve([{ id: "11111111-1111-1111-1111-111111111111" }]));
  return {
    auditLog: vi.fn().mockResolvedValue(undefined),
    verifyAuditChain: vi.fn().mockResolvedValue({ total: 0, brokenAt: null }),
    insert: vi.fn(() => ({ values: () => ({ returning }) })),
    update: vi.fn(() => ({ set: () => ({ where: () => ({ returning }) }) })),
    del: vi.fn(() => ({ where: () => ({ returning }) })),
    execute: vi.fn(() => Promise.resolve({ rows: [{ id: "11111111-1111-1111-1111-111111111111" }] })),
    select: vi.fn(),
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    insert: mocks.insert,
    update: mocks.update,
    delete: mocks.del,
    execute: mocks.execute,
    select: mocks.select,
  },
  pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
}));

vi.mock("../lib/auditLogger", () => ({
  auditLog: mocks.auditLog,
  verifyAuditChain: mocks.verifyAuditChain,
}));

const app = (await import("../app")).default;
const { signAdminToken } = await import("../middleware/adminAuth");

app.set("trust proxy", 1);

function adminCookie(): string {
  const token = signAdminToken({ adminId: randomUUID(), username: "admin1" });
  return `smt_admin_token=${token}`;
}

beforeEach(() => {
  mocks.auditLog.mockClear();
});

// Regression guard for the audit-event mislabeling fixed 2026-08-10: every
// admin user-management action previously logged LOGIN_SUCCESS (and session
// revoke logged UNAUTHORIZED_ACCESS), corrupting the audit taxonomy. The June
// 25 E2E sweep passed because it only asserted HTTP status, never the event.
describe("admin routes write the correct audit event", () => {
  const csrf = "XMLHttpRequest";

  test("POST /users → USER_CREATED", async () => {
    const res = await request(app)
      .post("/api/admin/users")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf)
      .send({ name: "New User", employeeId: "emp-new", role: "operator", password: "password123" });

    expect(res.status).toBe(201);
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "USER_CREATED" }));
  });

  test("PATCH /users/:id → USER_UPDATED", async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${TARGET_ID}`)
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf)
      .send({ name: "Renamed" });

    expect(res.status).toBe(200);
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "USER_UPDATED" }));
  });

  test("POST /users/:id/reset-password → USER_PASSWORD_RESET", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${TARGET_ID}/reset-password`)
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf)
      .send({ password: "password123" });

    expect(res.status).toBe(200);
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "USER_PASSWORD_RESET" }));
  });

  test("DELETE /users/:id → USER_DELETED", async () => {
    const res = await request(app)
      .delete(`/api/admin/users/${TARGET_ID}`)
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf);

    expect(res.status).toBe(200);
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "USER_DELETED" }));
  });

  test("DELETE /sessions/:userId → SESSION_REVOKED (not UNAUTHORIZED_ACCESS)", async () => {
    const res = await request(app)
      .delete(`/api/admin/sessions/${TARGET_ID}`)
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf);

    expect(res.status).toBe(200);
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "SESSION_REVOKED" }));
    expect(mocks.auditLog).not.toHaveBeenCalledWith(expect.objectContaining({ event: "UNAUTHORIZED_ACCESS" }));
  });
});

// The in-portal audit viewer (GET /admin/audit/logs), added alongside the
// frontend wiring. It is a pure read over the audit_logs table: it must return
// the rows and must NOT append to the HMAC chain (reads are unaudited — no
// auditLog() call). Chain: db.select({...}).from().orderBy().limit().
describe("GET /admin/audit/logs (read-only viewer)", () => {
  test("returns 200 with a logs array and does not audit the read", async () => {
    mocks.select.mockImplementationOnce(() => ({
      from: () => ({
        orderBy: () => ({
          limit: () =>
            Promise.resolve([
              {
                id: 1,
                action: "USER_CREATED",
                entityId: TARGET_ID,
                changedBy: TARGET_ID,
                description: "created user emp-new",
                createdAt: "2026-08-10 12:00:00",
              },
            ]),
        }),
      }),
    }));

    const res = await request(app)
      .get("/api/admin/audit/logs?limit=50")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", "XMLHttpRequest");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(res.body.logs[0]).toMatchObject({ action: "USER_CREATED" });
    expect(mocks.auditLog).not.toHaveBeenCalled();
  });
});
