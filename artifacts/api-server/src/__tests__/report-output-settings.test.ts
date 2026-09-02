import request from "supertest";
import { randomUUID } from "crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Module 15b — the two report-output endpoints, through the real Express
// pipeline (CSRF header, device guard, auth) with a mocked DB.
//
// What matters here is the split between them:
//   • /api/admin/report-output-settings — admin cookie, reads AND writes
//     everything including archiveRoot (a server filesystem path).
//   • /api/report-output-settings — any authenticated role, policy only.
//     It must NOT leak archiveRoot to the shop floor.
// Plus the archiveRoot validator: absolute-only, because a relative root
// resolves against the API's cwd, which differs between systemd and a dev
// shell — the same setting would mean two different folders.

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "api-server-report-output-test-secret-0123456789";
process.env.JWT_ADMIN_SECRET = "api-server-report-output-test-ADMIN-secret-0123456789";
process.env.ALLOWED_ORIGINS = "http://localhost:5173";
process.env.NODE_ENV = "development";
process.env.ADMIN_IP_ALLOWLIST = "";

const csrf = "XMLHttpRequest";

const mocks = vi.hoisted(() => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
  verifyAuditChain: vi.fn().mockResolvedValue({ total: 0, brokenAt: null }),
  select: vi.fn(),
  insert: vi.fn(),
  insertedValues: undefined as unknown,
  conflictSet: undefined as unknown,
}));

vi.mock("@workspace/db", () => ({
  db: { select: mocks.select, insert: mocks.insert, update: vi.fn(), delete: vi.fn(),
        execute: vi.fn(() => Promise.resolve({ rows: [] })) },
  pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
}));

vi.mock("../lib/auditLogger", () => ({
  auditLog: mocks.auditLog,
  verifyAuditChain: mocks.verifyAuditChain,
}));

const app = (await import("../app")).default;
const { signAdminToken } = await import("../middleware/adminAuth");
const { signAccessToken } = await import("../lib/authTokens");
const { invalidateReportOutputSettingsCache } = await import("../lib/reportOutputStore");

function adminCookie(): string {
  return `smt_admin_token=${signAdminToken({ adminId: randomUUID(), username: "admin1", mustChange: false })}`;
}

function userCookie(role = "operator"): string {
  const token = signAccessToken({
    userId: randomUUID(), username: `${role}1`, name: `${role} one`,
    role: role as never, mustChangePassword: false, jti: randomUUID(),
  });
  return `smt_token=${token}`;
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: true,
    clientFolderEnabled: false,
    folderLabel: null,
    organizeSubfolders: true,
    archiveEnabled: false,
    archiveRoot: null,
    updatedBy: null,
    updatedAt: new Date("2026-09-02T00:00:00Z"),
    ...over,
  };
}

/** Both GETs read db.select().from().where(). */
function stubSettingsRow(r: unknown | null) {
  mocks.select.mockImplementation(() => ({
    from: () => ({ where: () => Promise.resolve(r === null ? [] : [r]) }),
  }));
}

/** PATCH does insert().values().onConflictDoUpdate().returning(). */
function stubUpsert(returned: unknown) {
  mocks.insert.mockImplementation(() => ({
    values: (v: unknown) => {
      mocks.insertedValues = v;
      return {
        onConflictDoUpdate: (arg: { set?: unknown }) => {
          mocks.conflictSet = arg.set;
          return { returning: () => Promise.resolve([returned]) };
        },
      };
    },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insertedValues = undefined;
  mocks.conflictSet = undefined;
  invalidateReportOutputSettingsCache();
  delete process.env.REPORT_ARCHIVE_ROOT;
});

describe("GET /api/admin/report-output-settings", () => {
  test("returns the row plus the env archive root so the UI can show which wins", async () => {
    process.env.REPORT_ARCHIVE_ROOT = "/env/reports";
    stubSettingsRow(row({ archiveRoot: "/db/reports", archiveEnabled: true }));

    const res = await request(app)
      .get("/api/admin/report-output-settings")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf);

    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ archiveRoot: "/db/reports", archiveEnabled: true });
    expect(res.body.envArchiveRoot).toBe("/env/reports");
  });

  test("settings is null before the row exists — the page must render, not crash", async () => {
    stubSettingsRow(null);

    const res = await request(app)
      .get("/api/admin/report-output-settings")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf);

    expect(res.status).toBe(200);
    expect(res.body.settings).toBeNull();
    expect(res.body.envArchiveRoot).toBeNull();
  });

  test("no admin cookie → 401", async () => {
    const res = await request(app)
      .get("/api/admin/report-output-settings")
      .set("X-Requested-With", csrf);
    expect(res.status).toBe(401);
  });

  test("a user cookie is not an admin cookie → 401", async () => {
    const res = await request(app)
      .get("/api/admin/report-output-settings")
      .set("Cookie", userCookie("supervisor"))
      .set("X-Requested-With", csrf);
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/admin/report-output-settings", () => {
  test("saves the policy fields, stamps updatedBy, and audits the change", async () => {
    stubUpsert(row({ clientFolderEnabled: true, organizeSubfolders: false }));

    const res = await request(app)
      .patch("/api/admin/report-output-settings")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf)
      .send({ clientFolderEnabled: true, organizeSubfolders: false });

    expect(res.status).toBe(200);
    expect(res.body.settings.clientFolderEnabled).toBe(true);
    const set = mocks.conflictSet as Record<string, unknown>;
    expect(set.clientFolderEnabled).toBe(true);
    expect(set.organizeSubfolders).toBe(false);
    expect(set.updatedBy).toBeTruthy();
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "REPORT_OUTPUT_SETTINGS_UPDATED" }),
    );
  });

  test("rejects a relative archiveRoot — it would mean two folders on one install", async () => {
    stubUpsert(row());

    const res = await request(app)
      .patch("/api/admin/report-output-settings")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf)
      .send({ archiveRoot: "./reports" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_archive_root");
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test("accepts an absolute archiveRoot", async () => {
    stubUpsert(row({ archiveRoot: "/var/lib/smtverification/reports" }));

    const res = await request(app)
      .patch("/api/admin/report-output-settings")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf)
      .send({ archiveRoot: "/var/lib/smtverification/reports" });

    expect(res.status).toBe(200);
    expect((mocks.conflictSet as Record<string, unknown>).archiveRoot)
      .toBe("/var/lib/smtverification/reports");
  });

  test("a blank archiveRoot clears it to null rather than storing an empty string", async () => {
    stubUpsert(row());

    const res = await request(app)
      .patch("/api/admin/report-output-settings")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf)
      .send({ archiveRoot: "   " });

    expect(res.status).toBe(200);
    expect((mocks.conflictSet as Record<string, unknown>).archiveRoot).toBeNull();
  });

  test("rejects a folderLabel over 200 chars", async () => {
    const res = await request(app)
      .patch("/api/admin/report-output-settings")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf)
      .send({ folderLabel: "x".repeat(201) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_folder_label");
  });

  test("a body with no recognised field is a 400, not a silent no-op upsert", async () => {
    const res = await request(app)
      .patch("/api/admin/report-output-settings")
      .set("Cookie", adminCookie())
      .set("X-Requested-With", csrf)
      .send({ nonsense: true });

    expect(res.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test("missing X-Requested-With is refused before any DB work (CSRF guard)", async () => {
    const res = await request(app)
      .patch("/api/admin/report-output-settings")
      .set("Cookie", adminCookie())
      .send({ clientFolderEnabled: true });

    expect(res.status).toBe(403);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});

describe("GET /api/report-output-settings (any authenticated role)", () => {
  test("returns the policy an operator needs and nothing else — no archiveRoot", async () => {
    stubSettingsRow(row({
      clientFolderEnabled: true, folderLabel: "D:\\SMT Reports",
      organizeSubfolders: true, archiveEnabled: true, archiveRoot: "/var/lib/secret-path",
    }));

    const res = await request(app)
      .get("/api/report-output-settings")
      .set("Cookie", userCookie("operator"))
      .set("X-Requested-With", csrf);

    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({
      clientFolderEnabled: true,
      folderLabel: "D:\\SMT Reports",
      organizeSubfolders: true,
    });
    expect(JSON.stringify(res.body)).not.toContain("secret-path");
  });

  test("no cookie → 401 (the policy is not public)", async () => {
    const res = await request(app)
      .get("/api/report-output-settings")
      .set("X-Requested-With", csrf);
    expect(res.status).toBe(401);
  });

  test("a DB failure degrades to folder-off instead of failing the request", async () => {
    mocks.select.mockImplementation(() => ({
      from: () => ({ where: () => Promise.reject(new Error("relation does not exist")) }),
    }));

    const res = await request(app)
      .get("/api/report-output-settings")
      .set("Cookie", userCookie("operator"))
      .set("X-Requested-With", csrf);

    expect(res.status).toBe(200);
    expect(res.body.settings.clientFolderEnabled).toBe(false);
  });
});
