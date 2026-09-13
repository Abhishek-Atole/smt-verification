import request from "supertest";
import { randomUUID } from "crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Admin user/device edit routes exercised through the REAL request pipeline
// (admin cookie + CSRF header + IP allowlist) with a MOCKED @workspace/db, so
// the self/last-admin guards and the employee-id uniqueness check are asserted
// without touching a live database. Mirrors report-output-settings.test.ts.

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "api-server-admin-test-secret-0123456789";
process.env.JWT_ADMIN_SECRET = "api-server-admin-jwt-secret-0123456789";
process.env.ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:3000";
process.env.NODE_ENV = "development";
process.env.ADMIN_IP_ALLOWLIST = "";

const XHR = "XMLHttpRequest";

const mocks = vi.hoisted(() => ({
  // Each `where(...)` in a route consumes the next entry. Undefined → [].
  queue: [] as unknown[][],
  execute: vi.fn().mockResolvedValue({ rows: [] }),
  auditLog: vi.fn().mockResolvedValue(undefined),
  verifyAuditChain: vi.fn().mockResolvedValue({ total: 0, brokenAt: null }),
  revokeUser: vi.fn(),
  revokeAllForUser: vi.fn(),
}));

function consume(): unknown[] {
  return mocks.queue.length ? mocks.queue.shift()! : [];
}

// A drizzle query builder that is await-able and exposes the chained methods the
// admin routes call (.limit / .orderBy / .returning), all resolving to the same
// queued value.
function res() {
  const value = consume();
  const p = Promise.resolve(value);
  const q: any = {
    then: (a: unknown, b: unknown) => p.then(a as never, b as never),
    catch: (a: unknown) => p.catch(a as never),
    finally: p.finally.bind(p),
  };
  q.limit = () => q;
  q.orderBy = () => q;
  q.offset = () => q;
  q.returning = () => q;
  return q;
}

vi.mock("@workspace/db", () => ({
  db: {
    pool: null,
    select: () => ({ from: () => ({ where: () => res() }) }),
    update: () => ({ set: () => ({ where: () => res() }) }),
    delete: () => ({ where: () => res() }),
    insert: () => ({ values: () => ({ returning: () => res() }) }),
    execute: mocks.execute,
  },
}));

vi.mock("../lib/auditLogger", () => ({
  auditLog: mocks.auditLog,
  verifyAuditChain: mocks.verifyAuditChain,
}));
vi.mock("../lib/tokenBlacklist", () => ({ revokeUser: mocks.revokeUser }));
vi.mock("../lib/refreshStore", () => ({ revokeAllForUser: mocks.revokeAllForUser }));

const app = (await import("../app")).default;
const { signAdminToken } = await import("../middleware/adminAuth");

app.set("trust proxy", 1);

function adminCookie(adminId = randomUUID()) {
  return `smt_admin_token=${signAdminToken({ adminId, username: "admin1", mustChange: false })}`;
}

// This supertest version's request(app) returns per-HTTP-method helpers, so a
// real Test (which carries .set/.send) is created by calling the method + url.
function authed(method: "get" | "post" | "patch" | "delete", url: string, cookie = adminCookie()) {
  return (request(app) as unknown as Record<string, (u: string) => import("supertest").Test>)[method](url)
    .set("X-Requested-With", XHR)
    .set("Cookie", cookie);
}

const operatorRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: "Op",
  role: "operator",
  employeeId: "OP1",
  isActive: true,
  ...overrides,
});
const adminRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: "Adm",
  role: "admin",
  employeeId: "ADM1",
  isActive: true,
  ...overrides,
});

beforeEach(() => {
  mocks.queue = [];
  mocks.execute.mockReset();
  mocks.execute.mockResolvedValue({ rows: [] });
  mocks.auditLog.mockClear();
  mocks.revokeUser.mockClear();
  mocks.revokeAllForUser.mockClear();
});

describe("PATCH /api/admin/users/:id — edit name/role/employee id", () => {
  test("updates name, role and employee id for a non-admin target", async () => {
    const targetId = randomUUID();
    mocks.queue.push([operatorRow(targetId)], []); // fetch target, then dup-check finds nothing
    const res = await authed("patch", `/api/admin/users/${targetId}`).send({
      name: "New Name", role: "qa", employeeId: "OP2",
    });
    expect(res.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalled();
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "USER_UPDATED" }),
    );
  });

  test("rejects a duplicate employee id (case-insensitive)", async () => {
    const targetId = randomUUID();
    mocks.queue.push([operatorRow(targetId)], [{ id: randomUUID() }]);
    const res = await authed("patch", `/api/admin/users/${targetId}`).send({ employeeId: "op1" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("conflict_employee_id");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  test("returns 404 when the target does not exist", async () => {
    mocks.queue.push([]);
    const res = await authed("patch", `/api/admin/users/${randomUUID()}`).send({ name: "X" });
    expect(res.status).toBe(404);
  });

  test("rejects 400 for an invalid role", async () => {
    mocks.queue.push([operatorRow(randomUUID())]);
    const res = await authed("patch", `/api/admin/users/${randomUUID()}`).send({ role: "nope" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_role");
  });
});

describe("self + last-admin guards", () => {
  test("an admin cannot demote their own account", async () => {
    const actorId = randomUUID();
    mocks.queue.push([adminRow(actorId)]);
    const res = await authed("patch", `/api/admin/users/${actorId}`, adminCookie(actorId))
      .send({ role: "operator" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("self_modification");
  });

  test("an admin cannot disable their own account", async () => {
    const actorId = randomUUID();
    mocks.queue.push([adminRow(actorId)]);
    const res = await authed("patch", `/api/admin/users/${actorId}`, adminCookie(actorId))
      .send({ isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("self_modification");
  });

  test("demoting the LAST active admin is rejected", async () => {
    const targetId = randomUUID();
    mocks.queue.push([adminRow(targetId)], [{ c: 0 }]); // fetch, then no other active admins
    const res = await authed("patch", `/api/admin/users/${targetId}`).send({ role: "operator" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("last_admin");
  });

  test("demotion is allowed when another active admin remains", async () => {
    const targetId = randomUUID();
    mocks.queue.push([adminRow(targetId)], [{ c: 1 }]);
    const res = await authed("patch", `/api/admin/users/${targetId}`).send({ role: "operator" });
    expect(res.status).toBe(200);
  });

  test("DELETE of the actor's own account is rejected", async () => {
    const actorId = randomUUID();
    mocks.queue.push([adminRow(actorId)]);
    const res = await authed("delete", `/api/admin/users/${actorId}`, adminCookie(actorId));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("self_modification");
  });

  test("DELETE of the last active admin is rejected", async () => {
    const targetId = randomUUID();
    mocks.queue.push([adminRow(targetId)], [{ c: 0 }]);
    const res = await authed("delete", `/api/admin/users/${targetId}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("last_admin");
  });
});

describe("PATCH /api/admin/devices/:id — edit device (regression)", () => {
  test("updates editable device fields", async () => {
    const deviceId = randomUUID();
    mocks.queue.push([{
      id: deviceId, deviceType: "end_device", deviceName: "Line 1 scanner v2",
      allowedIp: "192.168.1.0/24", macAddress: null, status: "blocked",
      createdBy: null, createdAt: new Date(), lastModifiedBy: randomUUID(), lastModifiedAt: new Date(),
    }]);
    const res = await authed("patch", `/api/admin/devices/${deviceId}`).send({
      deviceName: "Line 1 scanner v2",
      allowedIp: "192.168.1.0/24",
      status: "blocked",
    });
    expect(res.status).toBe(200);
    expect(res.body.deviceName).toBe("Line 1 scanner v2");
  });

  test("rejects an invalid allowed IP without touching the DB", async () => {
    const res = await authed("patch", `/api/admin/devices/${randomUUID()}`).send({
      allowedIp: "not-an-ip",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_allowed_ip");
    expect(mocks.queue.length).toBe(0);
  });
});

describe("backup storage + file download endpoints", () => {
  test("storage reports configured:false when BACKUP_DIR is unset (no DB call)", async () => {
    delete process.env.BACKUP_DIR;
    const res = await authed("get", "/api/admin/backups/storage");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.dir).toBeNull();
  });

  test("file download 404 for an unknown run", async () => {
    mocks.queue.push([]);
    const res = await authed("get", `/api/admin/backups/${randomUUID()}/file`);
    expect(res.status).toBe(404);
  });

  test("file download 404 while the run is not a completed success", async () => {
    mocks.queue.push([{ status: "running", filePath: null }]);
    const res = await authed("get", `/api/admin/backups/${randomUUID()}/file`);
    expect(res.status).toBe(404);
  });
});

describe("estimateNextBackupAt", () => {
  test("returns tomorrow when today's scheduled hour has already passed", async () => {
    const { estimateNextBackupAt } = await import("../services/backup-service");
    const from = new Date(2026, 8, 9, 10, 0, 0).getTime(); // 10:00 local
    expect(estimateNextBackupAt(2, from).getDate()).toBe(10);
  });

  test("returns today when the scheduled hour is still ahead", async () => {
    const { estimateNextBackupAt } = await import("../services/backup-service");
    const from = new Date(2026, 8, 9, 1, 59, 0).getTime(); // just before 02:00
    expect(estimateNextBackupAt(2, from).getDate()).toBe(9);
    expect(estimateNextBackupAt(2, from).getHours()).toBe(2);
  });
});
