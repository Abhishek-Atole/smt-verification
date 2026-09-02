import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Module 15b — getEffectiveArchiveRoot() is the only thing that decides whether
// report archival runs at all, and it has to satisfy two conflicting needs:
//   • an admin toggling "Archive on the server" off must actually stop it, and
//   • installs that configured REPORT_ARCHIVE_ROOT before this table existed
//     must keep archiving without anyone visiting the admin page.
// Hence the rule under test: the DB setting wins once a root has ever been
// saved; before that, the env var is the fallback.

const mocks = vi.hoisted(() => ({
  selectResult: [] as Array<Record<string, unknown>>,
  selectError: null as Error | null,
  warn: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () =>
          mocks.selectError ? Promise.reject(mocks.selectError) : Promise.resolve(mocks.selectResult),
      }),
    }),
  },
}));
vi.mock("@workspace/db/schema", () => ({
  reportOutputSettingsTable: { id: {} },
}));
vi.mock("../logger", () => ({
  logger: { warn: mocks.warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { getEffectiveArchiveRoot, getReportOutputSettings, invalidateReportOutputSettingsCache } =
  await import("../reportOutputStore");

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: true,
    clientFolderEnabled: false,
    folderLabel: null,
    organizeSubfolders: true,
    archiveEnabled: false,
    archiveRoot: null,
    updatedBy: null,
    updatedAt: new Date(0),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateReportOutputSettingsCache();
  mocks.selectResult = [];
  mocks.selectError = null;
  delete process.env.REPORT_ARCHIVE_ROOT;
});

afterEach(() => {
  delete process.env.REPORT_ARCHIVE_ROOT;
});

describe("getEffectiveArchiveRoot precedence", () => {
  test("enabled with a root → that root, even when the env var says otherwise", async () => {
    process.env.REPORT_ARCHIVE_ROOT = "/env/root";
    mocks.selectResult = [row({ archiveEnabled: true, archiveRoot: "/db/root" })];
    expect(await getEffectiveArchiveRoot()).toBe("/db/root");
  });

  test("disabled but a root was configured → null (an explicit off switch)", async () => {
    process.env.REPORT_ARCHIVE_ROOT = "/env/root";
    mocks.selectResult = [row({ archiveEnabled: false, archiveRoot: "/db/root" })];
    expect(await getEffectiveArchiveRoot()).toBeNull();
  });

  test("no root ever configured → env var still archives (pre-existing deploys)", async () => {
    process.env.REPORT_ARCHIVE_ROOT = "/env/root";
    mocks.selectResult = [row()];
    expect(await getEffectiveArchiveRoot()).toBe("/env/root");
  });

  test("no root and no env var → null (archival off)", async () => {
    mocks.selectResult = [row()];
    expect(await getEffectiveArchiveRoot()).toBeNull();
  });

  test("enabled but the root is blank → falls through to the env var", async () => {
    process.env.REPORT_ARCHIVE_ROOT = "/env/root";
    mocks.selectResult = [row({ archiveEnabled: true, archiveRoot: "   " })];
    expect(await getEffectiveArchiveRoot()).toBe("/env/root");
  });

  test("missing row (migration not run) → defaults, so the env var wins", async () => {
    process.env.REPORT_ARCHIVE_ROOT = "/env/root";
    mocks.selectResult = [];
    expect(await getEffectiveArchiveRoot()).toBe("/env/root");
  });
});

describe("getReportOutputSettings", () => {
  test("a failed lookup warns and degrades to defaults rather than throwing", async () => {
    mocks.selectError = new Error("relation does not exist");
    const settings = await getReportOutputSettings();
    expect(settings.clientFolderEnabled).toBe(false);
    expect(settings.archiveEnabled).toBe(false);
    expect(mocks.warn).toHaveBeenCalled();
  });

  test("a failed lookup is not cached — the next call retries the DB", async () => {
    mocks.selectError = new Error("blip");
    await getReportOutputSettings();
    mocks.selectError = null;
    mocks.selectResult = [row({ clientFolderEnabled: true })];
    expect((await getReportOutputSettings()).clientFolderEnabled).toBe(true);
  });

  test("a successful read is cached until invalidated", async () => {
    mocks.selectResult = [row({ clientFolderEnabled: true })];
    expect((await getReportOutputSettings()).clientFolderEnabled).toBe(true);

    // Row changes underneath us; the cache should still answer.
    mocks.selectResult = [row({ clientFolderEnabled: false })];
    expect((await getReportOutputSettings()).clientFolderEnabled).toBe(true);

    invalidateReportOutputSettingsCache();
    expect((await getReportOutputSettings()).clientFolderEnabled).toBe(false);
  });
});
