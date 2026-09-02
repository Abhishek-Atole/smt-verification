import { beforeEach, describe, expect, test, vi } from "vitest";

// Module 10.2 — the store decides WHICH failures are safe to treat as
// "no devices registered". Getting that wrong in either direction is serious:
// too lenient and a DB outage silently disables IP restriction; too strict and a
// fresh install can never register its first device. The guard tests mock this
// module out, so its logic is only covered here.

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: { select: () => ({ from: mocks.from }) } }));
vi.mock("@workspace/db/schema", () => ({ devicesTable: {}, securitySettingsTable: { id: {} } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("../lib/logger", () => ({
  logger: { warn: mocks.warn, error: mocks.error, info: vi.fn(), debug: vi.fn() },
}));

const { getDevices, getActiveDevices, invalidateDeviceCache, DeviceLookupUnavailableError } =
  await import("../lib/deviceStore");

const ACTIVE = { id: "d1", allowedIp: "192.168.10.0/24", status: "active" };
const BLOCKED = { id: "d2", allowedIp: "192.168.20.5", status: "blocked" };

function undefinedTable() {
  // Postgres 42P01 — what drizzle surfaces before the migration is applied.
  return Object.assign(new Error('relation "devices" does not exist'), { code: "42P01" });
}
function connectionFailed() {
  return Object.assign(new Error("connection terminated unexpectedly"), { code: "57P01" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  invalidateDeviceCache();
});

describe("getDevices — the fail-open case that must stay fail-open", () => {
  test("a missing table is bootstrap allow-all, because no allow-list can exist yet", async () => {
    mocks.from.mockRejectedValue(undefinedTable());
    await expect(getDevices()).resolves.toEqual([]);
    expect(mocks.warn).toHaveBeenCalled();
  });

  test("an empty table is bootstrap allow-all", async () => {
    mocks.from.mockResolvedValue([]);
    await expect(getDevices()).resolves.toEqual([]);
  });
});

describe("getDevices — the fail-closed case", () => {
  test("a connection failure with no cache throws rather than returning []", async () => {
    // The whole point of task #40: an unreadable allow-list is NOT an empty one.
    mocks.from.mockRejectedValue(connectionFailed());
    await expect(getDevices()).rejects.toThrow(DeviceLookupUnavailableError);
    expect(mocks.error).toHaveBeenCalled();
  });

  test("an error with no pg code at all is treated as unavailable, not as empty", async () => {
    // Only 42P01 is special-cased; anything unrecognised must fail closed.
    mocks.from.mockRejectedValue(new Error("something unexpected"));
    await expect(getDevices()).rejects.toThrow(DeviceLookupUnavailableError);
  });

  test("the original error is retained as the cause for diagnosis", async () => {
    const original = connectionFailed();
    mocks.from.mockRejectedValue(original);
    await expect(getDevices()).rejects.toMatchObject({ cause: original });
  });
});

describe("getDevices — stale-cache grace window", () => {
  test("a DB blip after a good load keeps serving the last known allow-list", async () => {
    vi.useFakeTimers();
    mocks.from.mockResolvedValue([ACTIVE]);
    await expect(getDevices()).resolves.toEqual([ACTIVE]);

    // Past the 10s TTL, so the cache is consulted only because the query fails.
    mocks.from.mockRejectedValue(connectionFailed());
    vi.advanceTimersByTime(11_000);
    await expect(getDevices()).resolves.toEqual([ACTIVE]);
    expect(mocks.warn).toHaveBeenCalled();
  });

  test("once the grace window lapses the stale list is abandoned and access is denied", async () => {
    vi.useFakeTimers();
    mocks.from.mockResolvedValue([ACTIVE]);
    await getDevices();

    mocks.from.mockRejectedValue(connectionFailed());
    vi.advanceTimersByTime(11_000);
    await getDevices(); // still inside the grace window
    vi.advanceTimersByTime(6 * 60_000); // now past it
    await expect(getDevices()).rejects.toThrow(DeviceLookupUnavailableError);
  });

  test("recovery re-reads the DB and picks up allow-list changes", async () => {
    vi.useFakeTimers();
    mocks.from.mockResolvedValue([ACTIVE]);
    await getDevices();
    mocks.from.mockRejectedValue(connectionFailed());
    vi.advanceTimersByTime(11_000);
    await getDevices();

    mocks.from.mockResolvedValue([ACTIVE, BLOCKED]);
    vi.advanceTimersByTime(2_000); // past the failure backoff
    await expect(getDevices()).resolves.toEqual([ACTIVE, BLOCKED]);
  });

  test("an admin mutation clears the stale copy, so a de-registration takes effect at once", async () => {
    // Otherwise a device removed during a DB blip could keep working for the
    // whole grace window.
    vi.useFakeTimers();
    mocks.from.mockResolvedValue([ACTIVE]);
    await getDevices();

    invalidateDeviceCache();
    mocks.from.mockRejectedValue(connectionFailed());
    await expect(getDevices()).rejects.toThrow(DeviceLookupUnavailableError);
  });
});

describe("getActiveDevices", () => {
  test("filters out non-active rows", async () => {
    mocks.from.mockResolvedValue([ACTIVE, BLOCKED]);
    await expect(getActiveDevices()).resolves.toEqual([ACTIVE]);
  });

  test("propagates the unavailable error instead of reporting 'no active devices'", async () => {
    // If this returned [] the guard would 403 every device with reason
    // "unregistered_device" — a lie, and the wrong status code.
    mocks.from.mockRejectedValue(connectionFailed());
    await expect(getActiveDevices()).rejects.toThrow(DeviceLookupUnavailableError);
  });
});
