import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// Module 14 — notification feed role-scoping + per-user seen. The visibility
// filter (GET /notifications) and the per-user notification_seen join can only
// be exercised against real rows, so this is gated on DATABASE_URL_TEST and
// skipped otherwise (mirrors the existing integration harness). Asserts the
// scoping contract:
//   global (no target)      → everyone
//   target_role = R         → role R, plus supervisor/admin oversight
//   target_user_id = U      → user U, plus supervisor/admin oversight
// and that `seen` is tracked per user (marking seen for A never affects B),
// and that a caller cannot mark a notification they cannot see.
const testDatabaseUrl = process.env.DATABASE_URL_TEST;
const runIntegration = Boolean(testDatabaseUrl);

process.env.DATABASE_URL = testDatabaseUrl ?? process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "api-server-notif-scope-secret-0123456789";
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? "api-server-notif-scope-ADMIN-secret-0123456789";
process.env.AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET ?? "api-server-notif-scope-audit-hmac-secret";
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "http://localhost:5173";
process.env.NODE_ENV = "development";
process.env.ADMIN_IP_ALLOWLIST = "";

const RUN = `m14-${Date.now()}`;
const opAId = randomUUID();
const opBId = randomUUID();

let app: import("express").Express;
let db: typeof import("@workspace/db")["db"];
let inArray: typeof import("drizzle-orm")["inArray"];
let notificationsTable: typeof import("@workspace/db/schema")["notificationsTable"];
let notificationSeenTable: typeof import("@workspace/db/schema")["notificationSeenTable"];
let signAccessToken: typeof import("../../lib/authTokens")["signAccessToken"];

// attachActor decodes the JWT without a DB lookup, so no user rows are needed.
function cookie(role: string, userId: string): string {
  const token = signAccessToken({
    userId, username: `${role}-${userId.slice(0, 8)}`, name: `${role} ${userId.slice(0, 4)}`,
    role: role as never, mustChangePassword: false, jti: randomUUID(),
  });
  return `smt_token=${token}`;
}

let ids: { global: number; qaRole: number; userA: number; opRole: number };
let cookieOpA: string, cookieOpB: string, cookieQA: string, cookieSup: string;

describe.runIf(runIntegration)("notification feed scoping + per-user seen (real DB)", () => {
  beforeAll(async () => {
    app = (await import("../../app")).default;
    ({ db } = await import("@workspace/db"));
    ({ inArray } = await import("drizzle-orm"));
    const schema = await import("@workspace/db/schema");
    notificationsTable = schema.notificationsTable;
    notificationSeenTable = schema.notificationSeenTable;
    ({ signAccessToken } = await import("../../lib/authTokens"));
    app.set("trust proxy", 1);

    const rows = await db
      .insert(notificationsTable)
      .values([
        { type: "info", message: `${RUN} global` },
        { type: "info", message: `${RUN} qaRole`, targetRole: "qa" },
        { type: "info", message: `${RUN} userA`, targetUserId: opAId },
        { type: "info", message: `${RUN} opRole`, targetRole: "operator" },
      ])
      .returning({ id: notificationsTable.id, message: notificationsTable.message });

    const byTag = (tag: string) => rows.find((r) => r.message === `${RUN} ${tag}`)!.id;
    ids = { global: byTag("global"), qaRole: byTag("qaRole"), userA: byTag("userA"), opRole: byTag("opRole") };

    cookieOpA = cookie("operator", opAId);
    cookieOpB = cookie("operator", opBId);
    cookieQA = cookie("qa", randomUUID());
    cookieSup = cookie("supervisor", randomUUID());
  });

  afterAll(async () => {
    if (!db) return;
    const all = Object.values(ids);
    await db.delete(notificationSeenTable).where(inArray(notificationSeenTable.notificationId, all));
    await db.delete(notificationsTable).where(inArray(notificationsTable.id, all));
  });

  // Fetch the caller's feed and return only the rows this run seeded, keyed by id.
  async function feed(cookieStr: string): Promise<Map<number, { seen: boolean }>> {
    const res = await request(app).get("/api/notifications?limit=100").set("Cookie", cookieStr);
    expect(res.status).toBe(200);
    const mine = (res.body.notifications as Array<{ id: number; seen: boolean }>).filter((n) =>
      Object.values(ids).includes(n.id),
    );
    return new Map(mine.map((n) => [n.id, { seen: n.seen }]));
  }

  describe("GET /notifications visibility", () => {
    test("operator A sees global + own-user + operator-role, NOT qa-role", async () => {
      const f = await feed(cookieOpA);
      expect(f.has(ids.global)).toBe(true);
      expect(f.has(ids.userA)).toBe(true);
      expect(f.has(ids.opRole)).toBe(true);
      expect(f.has(ids.qaRole)).toBe(false);
    });

    test("operator B sees global + operator-role, NOT A's user-target, NOT qa-role", async () => {
      const f = await feed(cookieOpB);
      expect(f.has(ids.global)).toBe(true);
      expect(f.has(ids.opRole)).toBe(true);
      expect(f.has(ids.userA)).toBe(false);
      expect(f.has(ids.qaRole)).toBe(false);
    });

    test("qa sees global + qa-role, NOT operator-role, NOT A's user-target", async () => {
      const f = await feed(cookieQA);
      expect(f.has(ids.global)).toBe(true);
      expect(f.has(ids.qaRole)).toBe(true);
      expect(f.has(ids.opRole)).toBe(false);
      expect(f.has(ids.userA)).toBe(false);
    });

    test("supervisor sees everything (oversight)", async () => {
      const f = await feed(cookieSup);
      expect(f.has(ids.global)).toBe(true);
      expect(f.has(ids.qaRole)).toBe(true);
      expect(f.has(ids.opRole)).toBe(true);
      expect(f.has(ids.userA)).toBe(true);
    });
  });

  describe("POST /notifications/seen (per-user)", () => {
    async function markSeen(cookieStr: string, seenIds: number[]) {
      const res = await request(app)
        .post("/api/notifications/seen")
        .set("Cookie", cookieStr)
        .set("X-Requested-With", "XMLHttpRequest")
        .send({ ids: seenIds });
      expect(res.status).toBe(200);
      return res.body.marked as number;
    }

    test("marking seen is scoped to the caller — A's seen does not affect B", async () => {
      // Precondition: global is unseen for both A and B.
      expect((await feed(cookieOpA)).get(ids.global)?.seen).toBe(false);
      expect((await feed(cookieOpB)).get(ids.global)?.seen).toBe(false);

      const marked = await markSeen(cookieOpA, [ids.global]);
      expect(marked).toBe(1);

      expect((await feed(cookieOpA)).get(ids.global)?.seen).toBe(true);
      expect((await feed(cookieOpB)).get(ids.global)?.seen).toBe(false);
    });

    test("cannot mark a notification the caller cannot see (marked: 0)", async () => {
      // operator A cannot see the qa-role notification, so the mark is a no-op.
      const marked = await markSeen(cookieOpA, [ids.qaRole]);
      expect(marked).toBe(0);
      expect((await feed(cookieQA)).get(ids.qaRole)?.seen).toBe(false);
    });

    test("re-marking an already-seen notification is idempotent", async () => {
      const marked = await markSeen(cookieOpA, [ids.global]);
      expect(marked).toBe(1); // still resolves to the visible row; insert is onConflictDoNothing
      expect((await feed(cookieOpA)).get(ids.global)?.seen).toBe(true);
    });
  });
});

