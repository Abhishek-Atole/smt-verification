import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Response } from "express";
import type { Device, SecuritySettings } from "@workspace/db/schema";

// Module 10.2 — the enforcement paths of the device guard. Per .dev-docs the 403
// branch has never been exercised against a real client, so it is covered here
// at the middleware level: the guard is called directly with a stub req/res so
// the assertions are about ITS decisions, not about CSRF headers or rate limits.

const mocks = vi.hoisted(() => ({
  getDevices: vi.fn(),
  getActiveDevices: vi.fn(),
  getSecuritySettings: vi.fn(),
  auditLog: vi.fn().mockResolvedValue(undefined),
  warn: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: { select: vi.fn() } }));

// Only the three lookups are stubbed; DeviceLookupUnavailableError comes from
// the REAL module so the guard's `instanceof` check and this test's assertions
// cannot drift apart from the class the store actually throws.
vi.mock("../lib/deviceStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/deviceStore")>()),
  getDevices: mocks.getDevices,
  getActiveDevices: mocks.getActiveDevices,
  getSecuritySettings: mocks.getSecuritySettings,
}));

vi.mock("../lib/auditLogger", () => ({ auditLog: mocks.auditLog }));

vi.mock("../lib/logger", () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { deviceGuard } = await import("../middleware/deviceGuard");
const { DeviceLookupUnavailableError } = await import("../lib/deviceStore");
type DeviceRequest = Parameters<typeof deviceGuard>[0];

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    deviceType: "end_device",
    deviceName: "Line 1 Scanner",
    allowedIp: "192.168.10.0/24",
    macAddress: null,
    status: "active",
    createdBy: null,
    createdAt: new Date(),
    lastModifiedBy: null,
    lastModifiedAt: new Date(),
    ...overrides,
  };
}

const SETTINGS: SecuritySettings = {
  id: true,
  maintenanceMode: false,
  failedAttemptThreshold: 5,
  sessionTimeoutEndDeviceSec: 1800,
  sessionTimeoutStoreDeviceSec: 1800,
  sessionTimeoutAdminDeviceSec: 900,
  updatedBy: null,
  updatedAt: new Date(),
};

/** A request/response pair recording exactly what the guard did with it. */
function harness(ip: string, method = "GET", path = "/api/programs") {
  const req = { ip, method, path } as DeviceRequest;
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  } as unknown as Response;
  const next = vi.fn<(err?: unknown) => void>();
  return { req, res, next, sent };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSecuritySettings.mockResolvedValue(SETTINGS);
});

describe("deviceGuard — allowed paths", () => {
  test("loopback is trusted without consulting the allow-list at all", async () => {
    // The host administering itself must never be lockable-out; this is the
    // recovery path when a bad rule blocks every LAN device.
    mocks.getDevices.mockResolvedValue([device({ allowedIp: "10.9.9.9" })]);
    const { req, res, next, sent } = harness("127.0.0.1");

    await deviceGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(sent.status).toBeUndefined();
    expect(req.deviceType).toBe("server");
    expect(mocks.getDevices).not.toHaveBeenCalled();
  });

  test("an empty allow-list is bootstrap allow-all, and says so in the log", async () => {
    mocks.getDevices.mockResolvedValue([]);
    const { req, res, next, sent } = harness("192.168.10.108");

    await deviceGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(sent.status).toBeUndefined();
    expect(req.deviceType).toBeUndefined(); // nothing matched — no binding to enforce
    expect(mocks.warn).toHaveBeenCalled();
  });

  test("a /24 rule admits the dual-homed client at either of its addresses", async () => {
    // The actual deployment case: one subnet rule survives DHCP moving the
    // client between .108 and .114.
    const rows = [device({ allowedIp: "192.168.10.0/24" })];
    mocks.getDevices.mockResolvedValue(rows);
    mocks.getActiveDevices.mockResolvedValue(rows);

    for (const ip of ["192.168.10.108", "192.168.10.114", "::ffff:192.168.10.108"]) {
      const { req, res, next, sent } = harness(ip);
      await deviceGuard(req, res, next);
      expect(next, `expected ${ip} to be admitted`).toHaveBeenCalledOnce();
      expect(sent.status).toBeUndefined();
      expect(req.deviceType).toBe("end_device");
      expect(req.deviceId).toBe(rows[0].id);
    }
  });

  test("OPTIONS preflight passes through before any lookup", async () => {
    mocks.getDevices.mockResolvedValue([device({ allowedIp: "10.9.9.9" })]);
    const { req, res, next, sent } = harness("203.0.113.5", "OPTIONS");

    await deviceGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(sent.status).toBeUndefined();
    expect(mocks.getDevices).not.toHaveBeenCalled();
  });
});

describe("deviceGuard — the 403 path", () => {
  test("an unregistered IP is blocked and audited as unregistered_device", async () => {
    const rows = [device({ allowedIp: "192.168.10.0/24" })];
    mocks.getDevices.mockResolvedValue(rows);
    mocks.getActiveDevices.mockResolvedValue(rows);
    const { req, res, next, sent } = harness("192.168.99.7");

    await deviceGuard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(sent.status).toBe(403);
    expect(sent.body).toMatchObject({ error: "device_not_allowed" });
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "SECURITY_DEVICE_BLOCKED", ip: "192.168.99.7" }),
    );
    const detail = mocks.auditLog.mock.calls[0][0].detail as string;
    expect(detail).toContain("reason=unregistered_device");
  });

  test("a registered but non-active device is blocked with its status in the audit trail", async () => {
    // "blocked"/"pending" must be distinguishable from "unknown" when an admin
    // reads the audit log to explain why a terminal stopped working.
    for (const status of ["blocked", "pending"] as const) {
      vi.clearAllMocks();
      mocks.getSecuritySettings.mockResolvedValue(SETTINGS);
      const rows = [device({ status, allowedIp: "192.168.10.0/24" })];
      mocks.getDevices.mockResolvedValue(rows);
      mocks.getActiveDevices.mockResolvedValue([]); // status filter removes it

      const { req, res, next, sent } = harness("192.168.10.108");
      await deviceGuard(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(sent.status).toBe(403);
      expect(mocks.auditLog.mock.calls[0][0].detail).toContain(`reason=device_${status}`);
    }
  });

  test("the 403 body leaks no allow-list detail to the blocked client", async () => {
    const rows = [device({ allowedIp: "192.168.10.0/24", deviceName: "Admin Terminal" })];
    mocks.getDevices.mockResolvedValue(rows);
    mocks.getActiveDevices.mockResolvedValue(rows);
    const { req, res, next, sent } = harness("203.0.113.5");

    await deviceGuard(req, res, next);

    const body = JSON.stringify(sent.body);
    expect(body).not.toContain("192.168.10");
    expect(body).not.toContain("Admin Terminal");
  });
});

describe("deviceGuard — maintenance mode (10.3)", () => {
  test("blocks a non-admin device with 503 and audits it", async () => {
    const rows = [device({ deviceType: "end_device" })];
    mocks.getDevices.mockResolvedValue(rows);
    mocks.getActiveDevices.mockResolvedValue(rows);
    mocks.getSecuritySettings.mockResolvedValue({ ...SETTINGS, maintenanceMode: true });
    const { req, res, next, sent } = harness("192.168.10.108");

    await deviceGuard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(sent.status).toBe(503);
    expect(sent.body).toMatchObject({ error: "maintenance_mode" });
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "SECURITY_MAINTENANCE_BLOCK" }),
    );
  });

  test("lets an admin device through so maintenance mode can be switched back off", async () => {
    const rows = [device({ deviceType: "admin_device" })];
    mocks.getDevices.mockResolvedValue(rows);
    mocks.getActiveDevices.mockResolvedValue(rows);
    mocks.getSecuritySettings.mockResolvedValue({ ...SETTINGS, maintenanceMode: true });
    const { req, res, next, sent } = harness("192.168.10.108");

    await deviceGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(sent.status).toBeUndefined();
    expect(req.deviceType).toBe("admin_device");
  });
});

describe("deviceGuard — behaviour when the device lookup fails", () => {
  test("an unreadable allow-list is 503, not bootstrap allow-all", async () => {
    // Task #40. getDevices() used to swallow every DB error and return [],
    // which the guard could not distinguish from a genuinely un-migrated
    // install — so a dropped Postgres connection silently disabled IP
    // restriction. It now throws DeviceLookupUnavailableError instead.
    mocks.getDevices.mockRejectedValue(new DeviceLookupUnavailableError(new Error("boom")));
    const { req, res, next, sent } = harness("203.0.113.5");

    await deviceGuard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(sent.status).toBe(503);
    expect(sent.body).toMatchObject({ error: "device_check_unavailable" });
  });

  test("the outage response does not claim the device was de-registered", async () => {
    // 503 rather than 403 on purpose: an operator seeing "device not permitted"
    // calls an admin about a de-registration that never happened.
    mocks.getDevices.mockRejectedValue(new DeviceLookupUnavailableError(new Error("boom")));
    const { req, res, next, sent } = harness("203.0.113.5");

    await deviceGuard(req, res, next);

    expect(sent.status).not.toBe(403);
    expect(JSON.stringify(sent.body)).not.toContain("device_not_allowed");
  });

  test("the outage is audited so the blocked window is reconstructable", async () => {
    mocks.getDevices.mockRejectedValue(new DeviceLookupUnavailableError(new Error("boom")));
    const { req, res, next } = harness("203.0.113.5");

    await deviceGuard(req, res, next);

    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "SECURITY_DEVICE_LOOKUP_UNAVAILABLE", ip: "203.0.113.5" }),
    );
  });

  test("loopback still gets in during an outage, so the server can be recovered", async () => {
    mocks.getDevices.mockRejectedValue(new DeviceLookupUnavailableError(new Error("boom")));
    const { req, res, next, sent } = harness("127.0.0.1");

    await deviceGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(sent.status).toBeUndefined();
    expect(req.deviceType).toBe("server");
  });

  test("a genuinely empty table is still bootstrap allow-all", async () => {
    // The fail-closed change must not brick a fresh install: an empty list is a
    // successful query returning no rows, which is a different signal entirely.
    mocks.getDevices.mockResolvedValue([]);
    const { req, res, next, sent } = harness("192.168.10.108");

    await deviceGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(sent.status).toBeUndefined();
  });

  test("an unexpected error still propagates rather than silently allowing", async () => {
    // Only DeviceLookupUnavailableError becomes a 503. Anything else reaches
    // Express's error handler as a 500 — never next() with no device bound.
    mocks.getDevices.mockRejectedValue(new Error("programmer error"));
    const { req, res, next } = harness("203.0.113.5");

    await expect(deviceGuard(req, res, next)).rejects.toThrow("programmer error");
    expect(next).not.toHaveBeenCalled();
  });
});
