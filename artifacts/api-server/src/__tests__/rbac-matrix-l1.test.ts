import request from "supertest";
import { randomUUID } from "crypto";
import { describe, expect, test, vi } from "vitest";

// L1 — RBAC matrix. One canonical route per distinct guard tier; asserts every
// role's allow/deny decision. Deny → 403 is deterministic (requireRole rejects
// before the handler). Allow → we assert NOT 401/403: the role cleared the guard;
// whatever the (mocked) handler then returns is out of scope for the RBAC layer.
// Ownership-dependent guards (operator-owns-THIS-session) are L3, not here.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "api-server-rbac-l1-secret-0123456789";
process.env.JWT_ADMIN_SECRET = "api-server-rbac-l1-ADMIN-secret-0123456789";
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
    query: { usersTable: { findFirst: vi.fn() } },
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

const ALL_ROLES = ["operator", "qa", "supervisor", "admin", "storekeeper"] as const;
const csrf = "XMLHttpRequest";

function cookie(role: string): string {
  const token = signAccessToken({
    userId: randomUUID(), username: `${role}1`, name: `${role} one`,
    role: role as never, mustChangePassword: false, jti: randomUUID(),
  });
  return `smt_token=${token}`;
}

interface Tier {
  name: string;
  method: "get" | "post";
  path: string;
  allowed: readonly string[];
}

// Each tier lists the roles the guard admits; the rest are expected to 403.
const TIERS: Tier[] = [
  { name: "operator+ read (GET /api/bom)", method: "get", path: "/api/bom",
    allowed: ["operator", "qa", "supervisor", "admin"] },
  { name: "qa/sup/admin write (POST /api/bom/:id/items)", method: "post", path: "/api/bom/1/items",
    allowed: ["qa", "supervisor", "admin"] },
  { name: "qa/sup/admin analytics (GET /api/analytics/overview)", method: "get", path: "/api/analytics/overview",
    allowed: ["qa", "supervisor", "admin"] },
  { name: "reports router-gate (GET /api/reports/fpy)", method: "get", path: "/api/reports/fpy",
    allowed: ["qa", "supervisor", "admin"] },
  { name: "admin-only user role (GET /api/audit/recent)", method: "get", path: "/api/audit/recent",
    allowed: ["admin"] },
  // Module 11.4/11.7 — store Reel/Lot Master. Read is widened to supervisor so
  // they can see stock without a store login; receive/issue stays store-side.
  { name: "store read (GET /api/reels)", method: "get", path: "/api/reels",
    allowed: ["storekeeper", "supervisor", "admin"] },
  { name: "store write (POST /api/reels)", method: "post", path: "/api/reels",
    allowed: ["storekeeper", "admin"] },
];

function fire(tier: Tier, role: string) {
  const req = tier.method === "get"
    ? request(app).get(tier.path)
    : request(app).post(tier.path).set("X-Requested-With", csrf).send({});
  return req.set("Cookie", cookie(role));
}

describe.each(TIERS)("RBAC $name", (tier) => {
  for (const role of ALL_ROLES) {
    const isAllowed = tier.allowed.includes(role);
    test(`${role} → ${isAllowed ? "passes the guard" : "403"}`, async () => {
      const res = await fire(tier, role);
      if (isAllowed) {
        // Cleared attachActor + requireRole; handler result is out of RBAC scope.
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      } else {
        expect(res.status).toBe(403);
      }
    });
  }
});
