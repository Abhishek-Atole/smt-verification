import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Module 10.5 (Issue 3) — the HTTP behaviour of an origin rejection.
//
// Before: the CORS callback threw, the generic error handler caught it, and the
// caller got `500 {"error":"Internal Server Error"}`. On an /assets/* request
// that blanks the SPA and looks exactly like a crashed server, which is why the
// ALLOWED_ORIGINS-went-stale incident was misdiagnosed as a broken build.
//
// NODE_ENV=production here on purpose: development allows every origin, so the
// rejection path is only reachable in production.

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "cors-origin-test-secret";
process.env.JWT_ADMIN_SECRET = "cors-origin-test-ADMIN-secret";
process.env.PORT = "4000";
// A deliberately STALE list: the address the server used to have. The server's
// current address is not in it — that is the drift being reproduced.
process.env.ALLOWED_ORIGINS = "http://192.168.1.108:4000";
process.env.NODE_ENV = "production";
process.env.ADMIN_IP_ALLOWLIST = "";

const mocks = vi.hoisted(() => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
  verifyAuditChain: vi.fn().mockResolvedValue({ total: 0, brokenAt: null }),
}));

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), execute: vi.fn().mockResolvedValue({ rows: [] }) },
  pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
}));

vi.mock("../lib/auditLogger", () => ({
  auditLog: mocks.auditLog,
  verifyAuditChain: mocks.verifyAuditChain,
}));

// The device guard sits on /api/* too; empty allow-list = bootstrap mode, so it
// is not what these assertions are measuring.
vi.mock("../lib/deviceStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/deviceStore")>()),
  getDevices: vi.fn().mockResolvedValue([]),
  getActiveDevices: vi.fn().mockResolvedValue([]),
}));

const app = (await import("../app")).default;

beforeEach(() => vi.clearAllMocks());

describe("a stale ALLOWED_ORIGINS no longer blanks the SPA", () => {
  test("a same-origin request on an address in no list succeeds", async () => {
    const res = await request(app)
      .get("/api/health")
      .set("Host", "192.168.1.77:4000")
      .set("Origin", "http://192.168.1.77:4000");

    expect(res.status).toBe(200);
    expect(mocks.auditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "SECURITY_ORIGIN_REJECTED" }),
    );
  });

  test("the still-configured origin keeps working", async () => {
    const res = await request(app)
      .get("/api/health")
      .set("Host", "192.168.1.108:4000")
      .set("Origin", "http://192.168.1.108:4000");

    expect(res.status).toBe(200);
  });
});

describe("a genuinely foreign origin is rejected diagnosably", () => {
  test("403 with a machine-readable code and the offending origin, not a bare 500", async () => {
    const res = await request(app)
      .get("/api/health")
      .set("Host", "192.168.1.77:4000")
      .set("Origin", "http://evil.example.com");

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: "cors_origin_rejected",
      origin: "http://evil.example.com",
    });
    expect(res.body.message).toMatch(/ALLOWED_ORIGINS/);
  });

  test("the rejection is audited with the origin and the path", async () => {
    await request(app)
      .get("/api/programs")
      .set("Host", "192.168.1.77:4000")
      .set("Origin", "http://evil.example.com");

    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "SECURITY_ORIGIN_REJECTED",
        detail: expect.stringContaining("origin=http://evil.example.com"),
      }),
    );
  });

  test("a rejected origin gets NO Access-Control-Allow-Origin header", async () => {
    const res = await request(app)
      .get("/api/health")
      .set("Host", "192.168.1.77:4000")
      .set("Origin", "http://evil.example.com");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("rejection happens before the route, including on non-/api asset paths", async () => {
    // The blank page came from /assets/*, which is not under /api. The origin
    // check is mounted app-wide, so it must answer there too.
    const res = await request(app)
      .get("/assets/index-abc123.js")
      .set("Host", "192.168.1.77:4000")
      .set("Origin", "http://evil.example.com");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("cors_origin_rejected");
  });

  test("a rejected preflight is answered 403, not silently allowed through", async () => {
    const res = await request(app)
      .options("/api/auth/login")
      .set("Host", "192.168.1.77:4000")
      .set("Origin", "http://evil.example.com")
      .set("Access-Control-Request-Method", "POST");

    expect(res.status).toBe(403);
  });
});

describe("an allowed cross-origin caller still gets working CORS headers", () => {
  test("credentialed requests echo the origin and allow credentials", async () => {
    const res = await request(app)
      .get("/api/health")
      .set("Host", "192.168.1.108:4000")
      .set("Origin", "http://192.168.1.108:4000");

    expect(res.headers["access-control-allow-origin"]).toBe("http://192.168.1.108:4000");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  test("a preflight from an allowed origin advertises the methods and headers", async () => {
    const res = await request(app)
      .options("/api/auth/login")
      .set("Host", "192.168.1.108:4000")
      .set("Origin", "http://192.168.1.108:4000")
      .set("Access-Control-Request-Method", "POST");

    expect(res.status).toBeLessThan(300);
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
    expect(res.headers["access-control-allow-headers"]).toContain("X-Requested-With");
  });
});
