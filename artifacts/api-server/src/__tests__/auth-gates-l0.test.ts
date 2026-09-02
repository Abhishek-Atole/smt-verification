import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

// L0 — Auth & tokens. Fills the gaps the co-located unit tests leave open:
//   - the must-change 423 gate in attachActor (+ its change-password/logout exits)
//   - requireRole 403 wrong-role rejection
//   - verifyAccessToken role/jti validation
//   - verifyAdminToken absolute-TTL + secret separation
//   - the admin 409 first-login hard gate (requireCredentialsChanged)
//   - /api/auth/login rejecting the admin role (domain separation)
// Mirrors the mocked-DB, real-pipeline posture of security-hardening.test.ts.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "api-server-auth-gates-l0-secret-0123456789";
process.env.JWT_ADMIN_SECRET = "api-server-auth-gates-l0-ADMIN-secret-0123456789"; // must differ from JWT_SECRET
process.env.ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:3000";
process.env.NODE_ENV = "development";
process.env.ADMIN_IP_ALLOWLIST = ""; // empty = allow all (supertest client IP would 404 otherwise)

const csrf = "XMLHttpRequest";

const mocks = vi.hoisted(() => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
  verifyAuditChain: vi.fn().mockResolvedValue({ total: 0, brokenAt: null }),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
    query: { usersTable: { findFirst: vi.fn() } },
  },
  pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
}));

vi.mock("../lib/auditLogger", () => ({
  auditLog: mocks.auditLog,
  verifyAuditChain: mocks.verifyAuditChain,
}));

const app = (await import("../app")).default;
const { signAccessToken, verifyAccessToken, accessTokenExpirySec } = await import("../lib/authTokens");
const { signAdminToken, verifyAdminToken } = await import("../middleware/adminAuth");

app.set("trust proxy", 1);

// A user access-token cookie. mustChange defaults false so attachActor's 423
// gate stays open; pass mustChange:true to exercise the gate.
function userCookie(role: string, mustChange = false): string {
  const token = signAccessToken({
    userId: randomUUID(),
    username: `${role}1`,
    name: `${role} one`,
    role: role as never,
    mustChangePassword: mustChange,
    jti: randomUUID(),
  });
  return `smt_token=${token}`;
}

function adminCookie(mustChange = false): string {
  const token = signAdminToken({ adminId: randomUUID(), username: "admin1", mustChange });
  return `smt_admin_token=${token}`;
}

beforeEach(() => {
  mocks.auditLog.mockClear();
});

// ── attachActor: forced-first-login 423 gate (APP-FLOW §5) ───────────────────
describe("L0 must-change 423 gate", () => {
  test("protected route with a must-change token → 423", async () => {
    const res = await request(app)
      .get("/api/bom")
      .set("Cookie", userCookie("supervisor", true));
    expect(res.status).toBe(423);
    expect(res.body).toEqual(expect.objectContaining({ error: "locked_must_change_password" }));
  });

  test("/auth/change-password is exempt (400 policy, not 423)", async () => {
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", userCookie("operator", true))
      .set("X-Requested-With", csrf)
      .send({}); // empty body → 400 password policy, proving the gate let it through
    expect(res.status).toBe(400);
  });

  test("/auth/logout is exempt (200, session abandoned)", async () => {
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", userCookie("operator", true))
      .set("X-Requested-With", csrf);
    expect(res.status).toBe(200);
  });
});

// ── requireRole ──────────────────────────────────────────────────────────────
describe("L0 requireRole", () => {
  test("operator hitting an admin-only route → 403", async () => {
    const res = await request(app)
      .get("/api/audit/recent")
      .set("Cookie", userCookie("operator", false));
    expect(res.status).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ error: "Forbidden: insufficient permissions" }));
  });
});

// ── /api/auth/login domain separation ────────────────────────────────────────
describe("L0 login rejects the admin role", () => {
  test("role:admin at the user login endpoint → 400 (admin uses /api/admin)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Requested-With", csrf)
      .set("Origin", "http://localhost:5173")
      .send({ username: "admin1", password: "whatever", role: "admin" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(expect.objectContaining({ error: "auth_invalid_payload" }));
  });
});

// ── verifyAccessToken unit ────────────────────────────────────────────────────
describe("L0 verifyAccessToken", () => {
  test("valid token round-trips every claim", () => {
    const jti = randomUUID();
    const userId = randomUUID();
    const token = signAccessToken({ userId, username: "qa1", name: "QA One", role: "qa", mustChangePassword: true, jti });
    expect(verifyAccessToken(token)).toEqual({ userId, username: "qa1", name: "QA One", role: "qa", mustChangePassword: true, jti });
  });

  test("unknown role → null", () => {
    const token = jwt.sign({ userId: "u", username: "x", name: "x", role: "root", jti: "j" }, process.env.JWT_SECRET!, { expiresIn: "1h" });
    expect(verifyAccessToken(token)).toBeNull();
  });

  test("missing jti → null", () => {
    const token = jwt.sign({ userId: "u", username: "x", name: "x", role: "operator" }, process.env.JWT_SECRET!, { expiresIn: "1h" });
    expect(verifyAccessToken(token)).toBeNull();
  });

  test("signed with the admin secret → null (secret separation)", () => {
    const token = jwt.sign({ userId: "u", username: "x", name: "x", role: "operator", jti: "j" }, process.env.JWT_ADMIN_SECRET!, { expiresIn: "1h" });
    expect(verifyAccessToken(token)).toBeNull();
  });
});

// ── Module 13 — client-readable expiry ────────────────────────────────────────
// The proactive silent-refresh timer schedules against this. verifyAccessToken
// deliberately drops `exp` (see the round-trip test above), so the expiry is a
// separate read and must be validated separately.
describe("L0 accessTokenExpirySec / GET /auth/me expiresAt", () => {
  test("returns the token's exp in seconds", () => {
    const before = Math.floor(Date.now() / 1000);
    const token = signAccessToken(
      { userId: randomUUID(), username: "op1", name: "Op One", role: "operator", mustChangePassword: false, jti: randomUUID() },
      600,
    );
    const exp = accessTokenExpirySec(token);
    expect(exp).not.toBeNull();
    // 600s TTL, allowing a second of clock drift on either side.
    expect(exp!).toBeGreaterThanOrEqual(before + 599);
    expect(exp!).toBeLessThanOrEqual(before + 601);
  });

  test("expired or forged tokens → null, never a far-future expiry", () => {
    const expired = jwt.sign(
      { userId: "u", username: "x", name: "x", role: "operator", jti: "j" },
      process.env.JWT_SECRET!,
      { expiresIn: -10 },
    );
    expect(accessTokenExpirySec(expired)).toBeNull();
    expect(accessTokenExpirySec("not-a-jwt")).toBeNull();
    const wrongSecret = jwt.sign(
      { userId: "u", username: "x", name: "x", role: "operator", jti: "j" },
      process.env.JWT_ADMIN_SECRET!,
      { expiresIn: "1h" },
    );
    expect(accessTokenExpirySec(wrongSecret)).toBeNull();
  });

  test("/auth/me exposes expiresAt in epoch ms, matching the cookie's token", async () => {
    const res = await request(app).get("/api/auth/me").set("Cookie", userCookie("qa"));
    expect(res.status).toBe(200);
    expect(typeof res.body.expiresAt).toBe("number");
    // Default access TTL is 30 min; assert it is in the future and sane rather
    // than pinning the exact value.
    expect(res.body.expiresAt).toBeGreaterThan(Date.now());
    expect(res.body.expiresAt).toBeLessThanOrEqual(Date.now() + 31 * 60 * 1000);
  });

  test("/auth/me without a cookie still 401s (no expiry leak)", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.expiresAt).toBeUndefined();
  });
});

// ── verifyAdminToken unit ─────────────────────────────────────────────────────
describe("L0 verifyAdminToken", () => {
  test("valid admin token round-trips + carries mustChange", () => {
    const adminId = randomUUID();
    const token = signAdminToken({ adminId, username: "admin1", mustChange: true });
    const decoded = verifyAdminToken(token);
    expect(decoded).toMatchObject({ adminId, username: "admin1", isAdmin: true, mustChange: true });
  });

  test("absolute-TTL exceeded → null even though the JWT itself is unexpired", () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const token = signAdminToken({ adminId: randomUUID(), username: "admin1", mustChange: false, absExp: past });
    expect(verifyAdminToken(token)).toBeNull();
  });

  test("isAdmin flag missing → null", () => {
    const token = jwt.sign({ adminId: "a", username: "admin1", absExp: Math.floor(Date.now() / 1000) + 3600 }, process.env.JWT_ADMIN_SECRET!, { expiresIn: "15m" });
    expect(verifyAdminToken(token)).toBeNull();
  });

  test("signed with the user secret → null (secret separation)", () => {
    const token = jwt.sign({ adminId: "a", username: "admin1", isAdmin: true, absExp: Math.floor(Date.now() / 1000) + 3600 }, process.env.JWT_SECRET!, { expiresIn: "15m" });
    expect(verifyAdminToken(token)).toBeNull();
  });
});

// ── admin 409 first-login hard gate (requireCredentialsChanged) ───────────────
describe("L0 admin 409 credentials-change gate", () => {
  test("gated admin route with a must-change token → 409", async () => {
    const res = await request(app)
      .get("/api/admin/users")
      .set("Cookie", adminCookie(true))
      .set("X-Requested-With", csrf);
    expect(res.status).toBe(409);
    expect(res.body).toEqual(expect.objectContaining({ error: "must_change_credentials" }));
  });

  test("/admin/auth/me stays reachable and reports mustChange:true", async () => {
    const res = await request(app)
      .get("/api/admin/auth/me")
      .set("Cookie", adminCookie(true))
      .set("X-Requested-With", csrf);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ mustChange: true }));
  });

  test("/admin/auth/change-credentials is NOT gated (400 validation, not 409)", async () => {
    const res = await request(app)
      .post("/api/admin/auth/change-credentials")
      .set("Cookie", adminCookie(true))
      .set("X-Requested-With", csrf)
      .send({}); // empty body → validation error, proving the gate let it through
    expect(res.status).not.toBe(409);
    expect(res.status).toBe(400);
  });
});
