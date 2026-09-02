import request from "supertest";
import { randomUUID } from "crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Module 10.2 — GET /admin/devices reports `allowedIpValid` per row so the admin
// UI badge and the save-time rejection share ONE validator. The frontend cannot
// import the server's validator (no shared workspace package), and duplicating
// it there would reintroduce exactly the validation/matching drift that caused
// the trailing-slash allow-all bug. See decision.md 2026-08-30.

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "api-server-devices-flag-test-secret";
process.env.JWT_ADMIN_SECRET = "api-server-devices-flag-test-ADMIN-secret";
process.env.ALLOWED_ORIGINS = "http://localhost:5173";
process.env.NODE_ENV = "development";
process.env.ADMIN_IP_ALLOWLIST = "";

const DEVICE_ID = "22222222-2222-2222-2222-222222222222";

const mocks = vi.hoisted(() => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
  verifyAuditChain: vi.fn().mockResolvedValue({ total: 0, brokenAt: null }),
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { select: mocks.select, update: mocks.update },
  pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
}));

vi.mock("../lib/auditLogger", () => ({
  auditLog: mocks.auditLog,
  verifyAuditChain: mocks.verifyAuditChain,
}));

const app = (await import("../app")).default;
const { signAdminToken } = await import("../middleware/adminAuth");

function adminCookie(): string {
  const token = signAdminToken({ adminId: randomUUID(), username: "admin1", mustChange: false });
  return `smt_admin_token=${token}`;
}

function device(allowedIp: string, over: Record<string, unknown> = {}) {
  return {
    id: DEVICE_ID,
    deviceType: "end_device",
    deviceName: "Line 1 Scanner",
    allowedIp,
    macAddress: null,
    status: "active",
    ...over,
  };
}

/** GET /devices reads db.select().from().orderBy(). */
function stubDeviceRows(rows: unknown[]) {
  mocks.select.mockImplementationOnce(() => ({
    from: () => ({ orderBy: () => Promise.resolve(rows) }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /admin/devices reports allowedIpValid", () => {
  test("flags a pre-fix malformed entry as invalid without altering the stored value", async () => {
    stubDeviceRows([device("192.168.1.0/")]);

    const res = await request(app)
      .get("/api/admin/devices")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", "XMLHttpRequest");

    expect(res.status).toBe(200);
    expect(res.body.devices[0]).toMatchObject({
      allowedIp: "192.168.1.0/", // returned exactly as stored — display-only flag
      allowedIpValid: false,
    });
    // A read must never repair the row.
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test("a well-formed entry reports valid, so no badge renders", async () => {
    stubDeviceRows([device("192.168.10.0/24")]);

    const res = await request(app)
      .get("/api/admin/devices")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", "XMLHttpRequest");

    expect(res.body.devices[0].allowedIpValid).toBe(true);
  });

  test("reports each row independently — one bad entry does not taint the others", async () => {
    stubDeviceRows([
      device("192.168.10.0/24", { id: "ok-1" }),
      device("192.168.1.0/", { id: "bad-1" }),
      device("192.168.10.108", { id: "ok-2" }),
      device("192.168.1.0/24/8", { id: "bad-2" }),
    ]);

    const res = await request(app)
      .get("/api/admin/devices")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", "XMLHttpRequest");

    expect(res.body.devices.map((d: { id: string; allowedIpValid: boolean }) => [d.id, d.allowedIpValid]))
      .toEqual([["ok-1", true], ["bad-1", false], ["ok-2", true], ["bad-2", false]]);
  });

  test("a deliberate 0.0.0.0/0 is valid — the badge must not shame a real admin choice", async () => {
    stubDeviceRows([device("0.0.0.0/0")]);

    const res = await request(app)
      .get("/api/admin/devices")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", "XMLHttpRequest");

    expect(res.body.devices[0].allowedIpValid).toBe(true);
  });
});

describe("correcting a flagged entry", () => {
  test("re-saving the same malformed value is rejected, so the badge cannot be cleared by a no-op", async () => {
    const res = await request(app)
      .patch(`/api/admin/devices/${DEVICE_ID}`)
      .set("Cookie", adminCookie())
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ allowedIp: "192.168.1.0/" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_allowed_ip");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test("saving a valid value succeeds and the row then reports valid", async () => {
    mocks.update.mockImplementationOnce(() => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([device("192.168.1.0/24")]) }) }),
    }));

    const patch = await request(app)
      .patch(`/api/admin/devices/${DEVICE_ID}`)
      .set("Cookie", adminCookie())
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ allowedIp: "192.168.1.0/24" });

    expect(patch.status).toBe(200);

    stubDeviceRows([device("192.168.1.0/24")]);
    const list = await request(app)
      .get("/api/admin/devices")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", "XMLHttpRequest");

    expect(list.body.devices[0].allowedIpValid).toBe(true);
  });
});
