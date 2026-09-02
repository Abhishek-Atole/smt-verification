import request from "supertest";
import { randomUUID } from "crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Module 14 — admin notification broadcast endpoint. Admin routes are
// IP-allowlisted (empty = allow all) and cookie-authed with a SEPARATE secret
// from user JWTs. Set both before importing the app.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "api-server-broadcast-test-secret";
process.env.JWT_ADMIN_SECRET = "api-server-broadcast-test-ADMIN-secret"; // must differ from JWT_SECRET
process.env.ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:3000";
process.env.NODE_ENV = "development";
process.env.ADMIN_IP_ALLOWLIST = "";

const mocks = vi.hoisted(() => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
  verifyAuditChain: vi.fn().mockResolvedValue({ total: 0, brokenAt: null }),
  pushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    select: vi.fn(),
  },
  pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
}));

vi.mock("../lib/auditLogger", () => ({
  auditLog: mocks.auditLog,
  verifyAuditChain: mocks.verifyAuditChain,
}));

vi.mock("../lib/notify", () => ({
  pushNotification: mocks.pushNotification,
}));

const app = (await import("../app")).default;
const { signAdminToken } = await import("../middleware/adminAuth");

app.set("trust proxy", 1);

function adminCookie(): string {
  const token = signAdminToken({ adminId: randomUUID(), username: "admin1", mustChange: false });
  return `smt_admin_token=${token}`;
}

const csrf = "XMLHttpRequest";

beforeEach(() => {
  mocks.auditLog.mockClear();
  mocks.pushNotification.mockClear();
});

describe("POST /api/admin/notifications/broadcast", () => {
  test("global broadcast (no targetRole) → 201, pushes un-targeted, audits", async () => {
    const res = await request(app)
      .post("/api/admin/notifications/broadcast")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf)
      .send({ message: "System maintenance at 6pm" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, targetRole: "all" });
    expect(mocks.pushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "System maintenance at 6pm",
        eventClass: "broadcast",
        type: "info",
        targetRole: undefined,
      }),
    );
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "NOTIFICATION_BROADCAST" }),
    );
  });

  test("role-scoped broadcast → 201, pushes with that targetRole", async () => {
    const res = await request(app)
      .post("/api/admin/notifications/broadcast")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf)
      .send({ message: "QA queue is backed up", type: "warning", targetRole: "qa" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, targetRole: "qa" });
    expect(mocks.pushNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "warning", targetRole: "qa", eventClass: "broadcast" }),
    );
  });

  test("invalid targetRole → 400, no push, no audit", async () => {
    const res = await request(app)
      .post("/api/admin/notifications/broadcast")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf)
      .send({ message: "hi", targetRole: "root" });

    expect(res.status).toBe(400);
    expect(mocks.pushNotification).not.toHaveBeenCalled();
    expect(mocks.auditLog).not.toHaveBeenCalled();
  });

  test("empty message → 400", async () => {
    const res = await request(app)
      .post("/api/admin/notifications/broadcast")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf)
      .send({ message: "   " });

    expect(res.status).toBe(400);
    expect(mocks.pushNotification).not.toHaveBeenCalled();
  });

  test("message over 500 chars → 400", async () => {
    const res = await request(app)
      .post("/api/admin/notifications/broadcast")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf)
      .send({ message: "x".repeat(501) });

    expect(res.status).toBe(400);
    expect(mocks.pushNotification).not.toHaveBeenCalled();
  });

  test("no admin cookie → not 201 (auth-guarded)", async () => {
    const res = await request(app)
      .post("/api/admin/notifications/broadcast")
      .set("X-Requested-With", csrf)
      .send({ message: "hi" });

    expect(res.status).not.toBe(201);
    expect(mocks.pushNotification).not.toHaveBeenCalled();
  });
});
