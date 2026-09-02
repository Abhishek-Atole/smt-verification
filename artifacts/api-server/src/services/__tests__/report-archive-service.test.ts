import { mkdtemp, rm, stat, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Module 15 — report archival. Invariants:
//   • REPORT_ARCHIVE_ROOT unset → archival disabled (null sink) + loud error.
//   • Deduped per (report_type, related_entity_id): a second call for an
//     already-recorded entity returns null (no file, no row).
//   • Happy path tees to a file, then records path + size + sha256.
//   • Lost dedup race (insert conflict → 0 rows) unlinks the redundant file.

const mocks = vi.hoisted(() => ({
  selectResult: [] as Array<{ id: string }>,
  insertResult: [{ id: "rec-1" }] as Array<{ id: string }>,
  executeResult: { rows: [] as Array<{ data_directory?: string }> },
  insertedValues: undefined as unknown,
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(mocks.selectResult) }) }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        mocks.insertedValues = v;
        return { onConflictDoNothing: () => ({ returning: () => Promise.resolve(mocks.insertResult) }) };
      },
    }),
    execute: () => Promise.resolve(mocks.executeResult),
  },
}));
vi.mock("@workspace/db/schema", () => ({
  reportArchiveRecordTable: { id: {}, reportType: {}, relatedEntityId: {} },
}));
vi.mock("../../lib/logger", () => ({
  logger: { warn: mocks.warn, error: mocks.error, info: mocks.info, debug: vi.fn() },
}));
// Module 15b — the service now resolves its root through reportOutputStore
// (DB setting wins, env var is the fallback). These tests are about the sink,
// not that precedence, so stub the store down to the env var: every test below
// still drives behaviour purely via REPORT_ARCHIVE_ROOT. Precedence itself is
// covered in lib/__tests__/reportOutputStore.test.ts.
vi.mock("../../lib/reportOutputStore", () => ({
  getEffectiveArchiveRoot: () => Promise.resolve(process.env.REPORT_ARCHIVE_ROOT?.trim() || null),
}));

const { beginReportArchive } = await import("../report-archive-service");

let dir = "";

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.selectResult = [];
  mocks.insertResult = [{ id: "rec-1" }];
  mocks.executeResult = { rows: [] };
  mocks.insertedValues = undefined;
  dir = await mkdtemp(path.join(os.tmpdir(), "rpt-arch-"));
  process.env.REPORT_ARCHIVE_ROOT = dir;
  delete process.env.REPORT_ARCHIVE_ALLOW_SAME_DISK;
});

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  delete process.env.REPORT_ARCHIVE_ROOT;
});

describe("beginReportArchive", () => {
  test("returns null and logs loudly when REPORT_ARCHIVE_ROOT is unset", async () => {
    delete process.env.REPORT_ARCHIVE_ROOT;
    const sink = await beginReportArchive("session", "42");
    expect(sink).toBeNull();
    expect(mocks.error).toHaveBeenCalled();
  });

  test("returns null when the entity is already archived (dedup)", async () => {
    mocks.selectResult = [{ id: "existing" }];
    const sink = await beginReportArchive("session", "42");
    expect(sink).toBeNull();
    // No file should have been created under the root.
    const entries = await readdir(dir);
    expect(entries).toHaveLength(0);
  });

  test("happy path: tees to {root}/{year}/{month}/session/{id}_{ts}.pdf and records size + sha256", async () => {
    const sink = await beginReportArchive("session", "42");
    expect(sink).not.toBeNull();
    expect(sink!.filePath.startsWith(dir)).toBe(true);
    expect(sink!.filePath).toContain(`${path.sep}session${path.sep}42_`);
    expect(sink!.filePath.endsWith(".pdf")).toBe(true);

    sink!.stream.write(Buffer.from("%PDF-1.4 fake report bytes"));
    sink!.stream.end();
    await sink!.finalize();

    const st = await stat(sink!.filePath);
    expect(st.size).toBeGreaterThan(0);
    const values = mocks.insertedValues as { reportType: string; relatedEntityId: string; fileSizeBytes: number; checksum: string };
    expect(values.reportType).toBe("session");
    expect(values.relatedEntityId).toBe("42");
    expect(values.fileSizeBytes).toBe(st.size);
    expect(values.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  test("lost dedup race (insert conflict → 0 rows) unlinks the redundant file", async () => {
    mocks.insertResult = [];
    const sink = await beginReportArchive("session", "42");
    sink!.stream.write(Buffer.from("dup"));
    sink!.stream.end();
    await sink!.finalize();
    await expect(stat(sink!.filePath)).rejects.toThrow();
  });

  test("same-disk with acknowledgement logs info, not warn", async () => {
    process.env.REPORT_ARCHIVE_ALLOW_SAME_DISK = "true";
    // Point the reported data_directory at the archive dir so dev ids match.
    mocks.executeResult = { rows: [{ data_directory: dir }] };
    const sink = await beginReportArchive("session", "42");
    expect(sink).not.toBeNull();
    expect(mocks.info).toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
    sink!.stream.end();
    await sink!.finalize();
  });
});
