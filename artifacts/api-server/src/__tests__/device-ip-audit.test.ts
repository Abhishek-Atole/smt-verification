import { beforeEach, describe, expect, test, vi } from "vitest";

// Module 10.2 — the boot-time audit of stored allow-list entries. Rows written
// before the 2026-08-30 strict-validator fix can be malformed; the audit must
// REPORT them and change nothing, because a stored entry is the admin's stated
// intent and guessing at a correction would substitute ours for theirs.

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: mocks.from }), update: mocks.update, delete: mocks.del },
}));
vi.mock("@workspace/db/schema", () => ({ devicesTable: {} }));
vi.mock("../lib/logger", () => ({
  logger: { info: mocks.info, warn: mocks.warn, error: mocks.error, debug: vi.fn() },
}));

const { auditStoredDeviceIps, findMalformedEntries } = await import("../lib/deviceIpAudit");

function row(allowedIp: string, over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    deviceName: "Line 1 Scanner",
    allowedIp,
    status: "active",
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("findMalformedEntries", () => {
  test("passes well-formed entries, including a deliberate /0", () => {
    const rows = [
      row("192.168.10.0/24"),
      row("192.168.10.108"),
      row("2001:db8::/48"),
      row("0.0.0.0/0"), // explicit allow-all is a legitimate admin choice
    ];
    expect(findMalformedEntries(rows)).toEqual([]);
  });

  test("flags the pre-fix trailing-slash entry and marks it as having been allow-all", () => {
    const found = findMalformedEntries([row("192.168.1.0/", { id: "bad-1" })]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: "bad-1", allowedIp: "192.168.1.0/", wasAllowAll: true });
  });

  test("flags other malformed forms without claiming they were allow-all", () => {
    // "…/24/8" used to be silently read as /24 — wrong, but not wide open. The
    // distinction matters because only the allow-all rows mean the network was
    // actually unrestricted for that period.
    const found = findMalformedEntries([row("192.168.1.0/24/8"), row("192.168.1.0/ 24")]);
    expect(found).toHaveLength(2);
    expect(found.every((e) => e.wasAllowAll === false)).toBe(true);
  });

  test("reports every offending row, not just the first", () => {
    const found = findMalformedEntries([
      row("192.168.1.0/24", { id: "ok" }),
      row("192.168.2.0/", { id: "bad-1" }),
      row("garbage", { id: "bad-2" }),
    ]);
    expect(found.map((e) => e.id)).toEqual(["bad-1", "bad-2"]);
  });
});

describe("auditStoredDeviceIps", () => {
  test("logs at error level for a malformed row and names the device", async () => {
    mocks.from.mockResolvedValue([row("192.168.1.0/", { deviceName: "Store Terminal" })]);

    const found = await auditStoredDeviceIps();

    expect(found).toHaveLength(1);
    expect(mocks.error).toHaveBeenCalled();
    const logged = JSON.stringify(mocks.error.mock.calls);
    expect(logged).toContain("Store Terminal");
    expect(logged).toContain("192.168.1.0/");
  });

  test("the allow-all case says so, since that window was genuinely unrestricted", async () => {
    mocks.from.mockResolvedValue([row("192.168.1.0/")]);
    await auditStoredDeviceIps();
    expect(JSON.stringify(mocks.error.mock.calls)).toContain("EVERY address");
  });

  test("never writes to the DB — reporting only", async () => {
    mocks.from.mockResolvedValue([row("192.168.1.0/"), row("nonsense")]);
    await auditStoredDeviceIps();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.del).not.toHaveBeenCalled();
  });

  test("a clean table logs a single info line and no errors", async () => {
    mocks.from.mockResolvedValue([row("192.168.10.0/24")]);
    await expect(auditStoredDeviceIps()).resolves.toEqual([]);
    expect(mocks.info).toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  test("a lookup failure is a skipped audit, not a boot failure", async () => {
    // Includes the un-migrated 42P01 case. The device guard already fails closed
    // on an unreadable allow-list; the audit must not take the server down too.
    mocks.from.mockRejectedValue(Object.assign(new Error("no relation"), { code: "42P01" }));
    await expect(auditStoredDeviceIps()).resolves.toEqual([]);
    expect(mocks.warn).toHaveBeenCalled();
  });
});
