import { mkdtemp, writeFile, readdir, utimes, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Item 2 (Module 12) — backup hardening. Two headline invariants:
//   Bug A: prune must NEVER delete the most-recent successful backup (§12.2).
//   Bug B: BACKUP_DIR must be explicit and off-disk; misconfig disables backups
//          loudly rather than silently writing to ./backups next to the DB (§12.1).
// A third strand wires each run + each prune deletion into the audit log (§12.3).

const mocks = vi.hoisted(() => ({
  selectResult: [] as Array<{ filePath: string | null }>,
  executeResult: { rows: [] as Array<{ data_directory?: string }> },
  executeThrows: false,
  auditLog: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve(mocks.selectResult) }),
        }),
      }),
    }),
    execute: () =>
      mocks.executeThrows ? Promise.reject(new Error("permission denied")) : Promise.resolve(mocks.executeResult),
  },
}));
vi.mock("@workspace/db/schema", () => ({ backupRunsTable: { status: {}, filePath: {}, finishedAt: {} } }));
vi.mock("../../lib/logger", () => ({
  logger: { warn: mocks.warn, error: mocks.error, info: mocks.info, debug: vi.fn() },
}));
vi.mock("../../lib/auditLogger", () => ({ auditLog: mocks.auditLog }));

const { pruneOldBackups, verifyBackupStorage } = await import("../backup-service");

let dir = "";
const OLD = new Date("2020-01-01T00:00:00Z"); // well outside any retention window

async function makeBackup(name: string, old: boolean): Promise<string> {
  const full = path.join(dir, name);
  await writeFile(full, "-- dump");
  if (old) await utimes(full, OLD, OLD);
  return full;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.selectResult = [];
  mocks.executeResult = { rows: [] };
  mocks.executeThrows = false;
  dir = await mkdtemp(path.join(os.tmpdir(), "bkp-test-"));
  process.env.BACKUP_DIR = dir;
  delete process.env.BACKUP_ALLOW_SAME_DISK;
});

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("pruneOldBackups — retention floor (§12.2)", () => {
  test("never deletes the most-recent successful backup even when it is past the window", async () => {
    const newest = await makeBackup("backup-2020-01-01-newest.sql", true); // old mtime, but it IS the latest success
    await makeBackup("backup-2020-01-01-stale.sql", true);
    mocks.selectResult = [{ filePath: newest }]; // DB says this is the latest successful run

    await pruneOldBackups(30);

    const remaining = (await readdir(dir)).sort();
    expect(remaining).toEqual(["backup-2020-01-01-newest.sql"]); // stale pruned, protected survives
  });

  test("audit-logs each pruned file (§12.3)", async () => {
    const newest = await makeBackup("backup-newest.sql", true);
    await makeBackup("backup-old-a.sql", true);
    await makeBackup("backup-old-b.sql", true);
    mocks.selectResult = [{ filePath: newest }];

    await pruneOldBackups(30);

    const pruned = mocks.auditLog.mock.calls.filter((c) => c[0]?.event === "BACKUP_PRUNED");
    expect(pruned).toHaveLength(2);
  });

  test("leaves in-window backups alone; ignores non-backup files", async () => {
    await makeBackup("backup-fresh.sql", false); // recent — inside window
    await writeFile(path.join(dir, "notes.txt"), "x"); // not a backup file
    mocks.selectResult = [{ filePath: path.join(dir, "does-not-exist.sql") }];

    await pruneOldBackups(30);

    expect((await readdir(dir)).sort()).toEqual(["backup-fresh.sql", "notes.txt"]);
    expect(mocks.auditLog).not.toHaveBeenCalled();
  });

  test("retentionDays<=0 is a no-op", async () => {
    await makeBackup("backup-old.sql", true);
    await pruneOldBackups(0);
    expect(await readdir(dir)).toContain("backup-old.sql");
  });

  test("skips pruning entirely if the latest successful backup cannot be resolved", async () => {
    // Simulate a DB read failure by pointing select at a rejecting chain via override.
    await makeBackup("backup-old.sql", true);
    const orig = mocks.selectResult;
    // Force the try/catch in pruneOldBackups: make orderBy().limit() reject.
    void orig;
    const dbMod = await import("@workspace/db");
    const spy = vi.spyOn(dbMod.db, "select").mockReturnValue({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.reject(new Error("db down")) }) }) }),
    } as never);

    await pruneOldBackups(30);

    expect(await readdir(dir)).toContain("backup-old.sql"); // nothing deleted
    expect(mocks.warn).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("verifyBackupStorage — off-disk guard (§12.1)", () => {
  test("BACKUP_DIR unset → not ok, loud error, backups disabled", async () => {
    delete process.env.BACKUP_DIR;
    const r = await verifyBackupStorage();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("BACKUP_DIR unset");
    expect(mocks.error).toHaveBeenCalled();
  });

  test("cannot resolve DB data dir (query throws) → ok (treated off-disk, cannot prove same)", async () => {
    mocks.executeThrows = true;
    const r = await verifyBackupStorage();
    expect(r.ok).toBe(true);
  });

  test("DB data dir not locally visible → ok (remote DB, different disk)", async () => {
    mocks.executeResult = { rows: [{ data_directory: path.join(dir, "no-such-remote-datadir") }] };
    const r = await verifyBackupStorage();
    expect(r.ok).toBe(true);
  });

  test("same physical disk without override → not ok, backups disabled", async () => {
    // Point the DB data dir at a sibling under the same tmpfs → identical st_dev.
    const dataDir = path.join(dir, "pgdata");
    await mkdir(dataDir, { recursive: true });
    mocks.executeResult = { rows: [{ data_directory: dataDir }] };

    const r = await verifyBackupStorage();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("BACKUP_DIR on same disk as DB");
    expect(mocks.error).toHaveBeenCalled();
  });

  test("same physical disk WITH BACKUP_ALLOW_SAME_DISK=true → ok but warns", async () => {
    const dataDir = path.join(dir, "pgdata");
    await mkdir(dataDir, { recursive: true });
    mocks.executeResult = { rows: [{ data_directory: dataDir }] };
    process.env.BACKUP_ALLOW_SAME_DISK = "true";

    const r = await verifyBackupStorage();
    expect(r.ok).toBe(true);
    expect(mocks.warn).toHaveBeenCalled();
  });
});
