import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, describe, expect, test, vi } from "vitest";

// L2 — non-per-role gates. The guards here are NOT keyed on role (L1 covered
// those); they gate on a second factor (step-up), request volume (rate limit),
// or environment (production). Also pins the unauthenticated-by-design surface
// so a future "lock everything down" change can't silently 401 the health probe.
//   - requireStepUp: 403 reauth_required when the smt_reauth proof cookie is absent
//   - the deliberate step-up GAPS on BOM item/hard-delete writes (documented, not fixed)
//   - loginLimiter: outer per-IP 429 cap independent of the per-username lockout
//   - public surface: /health + /timestamp answer without a cookie (200, not 401)
//   - every /api/test seed route carries the productionGuard → 404 in production
//     (seed-quick and seed-boms-with-items were previously missing it; now fixed)
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "api-server-sec-gates-l2-secret-0123456789";
process.env.JWT_ADMIN_SECRET = "api-server-sec-gates-l2-ADMIN-secret-0123456789";
process.env.ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:3000";
process.env.NODE_ENV = "development";
process.env.ADMIN_IP_ALLOWLIST = "";

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
    query: { usersTable: { findFirst: vi.fn() }, bomsTable: { findMany: vi.fn() } },
  },
  pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
}));

vi.mock("../lib/auditLogger", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
  verifyAuditChain: vi.fn().mockResolvedValue({ total: 0, brokenAt: null }),
}));

vi.mock("../lib/notify", () => ({ pushNotification: vi.fn().mockResolvedValue(undefined) }));

const app = (await import("../app")).default;
const { signAccessToken } = await import("../lib/authTokens");

app.set("trust proxy", 1);

const csrf = "XMLHttpRequest";

function cookie(role: string): string {
  const token = signAccessToken({
    userId: randomUUID(), username: `${role}1`, name: `${role} one`,
    role: role as never, mustChangePassword: false, jti: randomUUID(),
  });
  return `smt_token=${token}`;
}

// ── requireStepUp (second-factor gate, role-independent) ─────────────────────
describe("L2 step-up enforcement", () => {
  test("POST /api/bom (step-up route) without smt_reauth → 403 reauth_required", async () => {
    const res = await request(app)
      .post("/api/bom")
      .set("Cookie", cookie("supervisor"))
      .set("X-Requested-With", csrf)
      .send({ name: "x" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ error: "reauth_required" }));
  });

  // Documents the current (asymmetric) design: adding items and hard-deleting a
  // BOM clear requireRole but are NOT behind step-up. If step-up were present the
  // no-reauth request would 403 reauth_required — it does not, so the guard is absent.
  test("POST /api/bom/:id/items has NO step-up (not 403 reauth_required without smt_reauth)", async () => {
    const res = await request(app)
      .post("/api/bom/1/items")
      .set("Cookie", cookie("supervisor"))
      .set("X-Requested-With", csrf)
      .send({});
    expect(res.body?.error).not.toBe("reauth_required");
    expect(res.status).not.toBe(403);
  });

  test("DELETE /api/bom/:id has NO step-up (not 403 reauth_required without smt_reauth)", async () => {
    const res = await request(app)
      .delete("/api/bom/1")
      .set("Cookie", cookie("supervisor"))
      .set("X-Requested-With", csrf);
    expect(res.body?.error).not.toBe("reauth_required");
    expect(res.status).not.toBe(403);
  });
});

// ── unauthenticated-by-design surface ────────────────────────────────────────
// healthRouter is mounted FIRST in routes/index.ts, ahead of every router that
// carries a router-level `router.use(attachActor)`. That ordering is what keeps
// /health reachable without a cookie — mount it after any attachActor router and
// the probe would 401. (/timestamp, mounted later, is in fact shadowed to 401
// for cookie-less callers — it is NOT part of the public surface.)
describe("L2 public surface stays public", () => {
  test("GET /api/health → 200 without a cookie", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
  });
});

// ── test-seed routes all carry the production guard ──────────────────────────
// Every /api/test route calls productionGuard() → 404 when NODE_ENV=production.
// GET /test/seed-quick and POST /test/seed-boms-with-items were previously
// missing it (a live-in-production destructive-seed gap); the guard has since
// been added to both. All three requests below carry the SAME (operator) cookie
// — needed only to clear the router-level attachActor gates that sit ahead of
// testRouter — so the ONLY variable is the guard itself. testRouter has no
// requireRole, so any logged-in role (operator included) reaches these: without
// the guard they would run their destructive seed logic in production. These
// tests assert the guard is present on all three.
describe("L2 test-route production guard", () => {
  afterEach(() => {
    process.env.NODE_ENV = "development";
  });

  test("guarded sibling POST /api/test/seed-simple → 404 in production", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app)
      .post("/api/test/seed-simple")
      .set("Cookie", cookie("operator"))
      .set("X-Requested-With", csrf)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual(expect.objectContaining({ error: "Not found" }));
  });

  test("GET /api/test/seed-quick → 404 in production (guard present)", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app)
      .get("/api/test/seed-quick")
      .set("Cookie", cookie("operator"));
    expect(res.status).toBe(404);
    expect(res.body).toEqual(expect.objectContaining({ error: "Not found" }));
  });

  test("POST /api/test/seed-boms-with-items → 404 in production (guard present)", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app)
      .post("/api/test/seed-boms-with-items")
      .set("Cookie", cookie("operator"))
      .set("X-Requested-With", csrf)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual(expect.objectContaining({ error: "Not found" }));
  });
});

// ── loginLimiter outer per-IP cap (representative rate-limit wiring) ──────────
// Runs LAST: it trips the 20/15min login bucket for this file's app instance.
// Distinct usernames avoid the per-username 5/15min handler lockout, isolating
// the OUTER IP limiter. scanLimiter (60/min) and apiLimiter (200/min) share the
// same express-rate-limit wiring; not fired here to keep the request budget small.
describe("L2 loginLimiter per-IP cap", () => {
  test("21st login from one IP → 429 rate_limit_login (cap is 20/15min)", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .set("X-Requested-With", csrf)
        .set("Origin", "http://localhost:5173")
        .send({ username: `nobody${i}`, password: "wrong", role: "operator" });
      expect(res.status).not.toBe(429); // still under the cap
    }
    const capped = await request(app)
      .post("/api/auth/login")
      .set("X-Requested-With", csrf)
      .set("Origin", "http://localhost:5173")
      .send({ username: "nobody-final", password: "wrong", role: "operator" });
    expect(capped.status).toBe(429);
    expect(capped.body).toEqual(expect.objectContaining({ error: "rate_limit_login" }));
  });
});
