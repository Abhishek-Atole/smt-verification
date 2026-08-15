import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Env before importing the app (mirrors admin-audit-events.test.ts). A distinct
// JWT_SECRET / JWT_ADMIN_SECRET pair is required — they must differ.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "api-server-auth-revocation-test-secret";
process.env.JWT_ADMIN_SECRET = "api-server-auth-revocation-test-ADMIN-secret";
process.env.ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:3000";
process.env.NODE_ENV = "development";
process.env.ADMIN_IP_ALLOWLIST = "";

const USER_ID = "22222222-2222-2222-2222-222222222222";

const mocks = vi.hoisted(() => {
  // information_schema.columns rows read by getUserTableColumns(); presence of
  // employee_id / password_hash / name selects the modern column set.
  const COLUMNS = [
    { column_name: "id" },
    { column_name: "employee_id" },
    { column_name: "password_hash" },
    { column_name: "name" },
    { column_name: "role" },
    { column_name: "is_active" },
    { column_name: "must_change_password" },
  ];
  // The user SELECT is aliased (… AS display_name / username / …); keys here
  // match what the login handler reads off the row. must_change_password:true
  // simulates the just-reset account (admin set a temp password, re-armed it).
  const USER_ROW = {
    id: "22222222-2222-2222-2222-222222222222",
    display_name: "Operator One",
    username: "operator1",
    role: "operator",
    password_hash: "$2a$10$mockedhashvaluethatisnotcompared",
    is_active: true,
    must_change_password: true,
  };

  // getUserTableColumns() memoises its result in a module-level promise, so the
  // information_schema query fires exactly ONCE across this file — always the
  // first execute() call. Every later execute() is the per-login user lookup.
  let executeCalls = 0;

  return {
    auditLog: vi.fn().mockResolvedValue(undefined),
    verifyAuditChain: vi.fn().mockResolvedValue({ total: 0, brokenAt: null }),
    compare: vi.fn().mockResolvedValue(true),
    hash: vi.fn().mockResolvedValue("$2a$10$mockedhashvaluethatisnotcompared"),
    execute: vi.fn(() => {
      executeCalls += 1;
      return Promise.resolve(executeCalls === 1 ? { rows: COLUMNS } : { rows: [USER_ROW] });
    }),
    insert: vi.fn(() => ({ values: () => Promise.resolve(undefined) })),
    issueRefresh: vi.fn().mockResolvedValue({ id: "refresh-jti", token: "refresh-token" }),
  };
});

vi.mock("@workspace/db", () => ({
  db: { execute: mocks.execute, insert: mocks.insert },
  pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
}));

vi.mock("../lib/auditLogger", () => ({
  auditLog: mocks.auditLog,
  verifyAuditChain: mocks.verifyAuditChain,
}));

// issueRefresh normally hits the DB (refresh_tokens); stub the whole store so
// login stays a pure in-memory path. The other exports are used by sibling
// routes we don't exercise here, but the import must resolve.
vi.mock("../lib/refreshStore", () => ({
  issueRefresh: mocks.issueRefresh,
  revokeAllForUser: vi.fn().mockResolvedValue(undefined),
  revokeByHash: vi.fn().mockResolvedValue(undefined),
  rotateRefresh: vi.fn(),
}));

// Password verification is not what this test covers — force the compare result.
vi.mock("bcryptjs", () => ({
  default: { compare: mocks.compare, hash: mocks.hash },
}));

const app = (await import("../app")).default;
// The real (unmocked) blacklist — the login route and this test share its map.
const { revokeUser, isRevoked, unrevoke } = await import("../lib/tokenBlacklist");

app.set("trust proxy", 1);

// U17 regression — an admin reset / force-logout calls revokeUser(id), which is
// keyed by userId to kill the user's EXISTING token on its next request. Without
// unrevoke(user.id) in the login handler, the fresh token minted by a later
// successful login is rejected for the full 8h TTL — trapping the user even on
// the /change-password escape hatch after a reset. These assert login clears it,
// and only on a credential-verified login.
describe("POST /auth/login clears stale userId revocation (U17)", () => {
  beforeEach(() => {
    unrevoke(USER_ID); // clean slate between runs
    mocks.auditLog.mockClear();
    mocks.issueRefresh.mockClear();
    mocks.compare.mockResolvedValue(true);
  });

  test("a successful login unrevokes the user so the fresh token is accepted", async () => {
    revokeUser(USER_ID); // admin reset / force-logout moments ago
    expect(isRevoked(USER_ID)).toBe(true);

    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ username: "operator1", password: "TempPass2026", role: "operator" });

    expect(res.status).toBe(200);
    // The regression assertion: false only because the handler called unrevoke().
    expect(isRevoked(USER_ID)).toBe(false);
    // Reset re-armed the flag, so the client is still told to change it.
    expect(res.body.mustChangePassword).toBe(true);
  });

  test("a failed login (bad password) does NOT unrevoke", async () => {
    revokeUser(USER_ID);
    mocks.compare.mockResolvedValue(false); // password mismatch

    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ username: "operator1", password: "wrong", role: "operator" });

    expect(res.status).toBe(401);
    // Revocation must survive a failed attempt — only a verified login clears it.
    expect(isRevoked(USER_ID)).toBe(true);
  });
});
