import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Item 1 (Module 10.5) — end-to-end proof that the admin-configurable
// `failedAttemptThreshold` in security_settings actually drives per-username
// login lockout. Before the fix, lockoutStore hard-coded 5 and this setting was
// dead. Here we mock getSecuritySettings to a NON-default threshold and show the
// /auth/login lockout trips at exactly that count.

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "threshold-lockout-test-secret-0123456789";
process.env.JWT_ADMIN_SECRET = "threshold-lockout-test-ADMIN-secret-0123456789";
process.env.ALLOWED_ORIGINS = "http://localhost:5173";
process.env.NODE_ENV = "development";
process.env.ADMIN_IP_ALLOWLIST = "";

const mocks = vi.hoisted(() => ({
  getSecuritySettings: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    execute: vi.fn().mockResolvedValue({ rows: [] }), // no such user → unknown_user failure path
  },
  pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
}));

vi.mock("../lib/auditLogger", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
  verifyAuditChain: vi.fn().mockResolvedValue({ total: 0, brokenAt: null }),
}));

// Empty device allow-list = bootstrap allow-all; override only getSecuritySettings.
vi.mock("../lib/deviceStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/deviceStore")>()),
  getDevices: vi.fn().mockResolvedValue([]),
  getActiveDevices: vi.fn().mockResolvedValue([]),
  getSecuritySettings: mocks.getSecuritySettings,
}));

const app = (await import("../app")).default;
const { _resetForTests } = await import("../lib/lockoutStore");

const SETTINGS = (failedAttemptThreshold: number) => ({
  id: true as const,
  maintenanceMode: false,
  failedAttemptThreshold,
  sessionTimeoutEndDeviceSec: 1800,
  sessionTimeoutStoreDeviceSec: 1800,
  sessionTimeoutAdminDeviceSec: 900,
  updatedBy: null,
  updatedAt: new Date(),
});

function attempt(username: string) {
  return request(app)
    .post("/api/auth/login")
    .set("X-Requested-With", "XMLHttpRequest")
    .set("Origin", "http://localhost:5173")
    .send({ username, password: "wrong", role: "operator" });
}

beforeEach(() => {
  _resetForTests();
});

describe("failedAttemptThreshold drives login lockout end-to-end", () => {
  test("threshold=3 → the 4th attempt is locked out (429), not the 6th", async () => {
    mocks.getSecuritySettings.mockResolvedValue(SETTINGS(3));
    for (let i = 1; i <= 3; i++) {
      expect((await attempt("op-low")).status).toBe(401); // invalid creds, under threshold
    }
    const locked = await attempt("op-low"); // 4th: prior attempt already tripped lockout
    expect(locked.status).toBe(429);
    expect(locked.body).toEqual(expect.objectContaining({ error: "rate_limit_login" }));
  });

  test("threshold=8 → the 6th attempt is NOT locked (old hard-coded 5 no longer applies)", async () => {
    mocks.getSecuritySettings.mockResolvedValue(SETTINGS(8));
    for (let i = 1; i <= 5; i++) {
      expect((await attempt("op-high")).status).toBe(401);
    }
    const sixth = await attempt("op-high");
    expect(sixth.status).toBe(401); // would have been 429 under the old default of 5
  });
});
