import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  bomCache,
  userCache,
  buildKey,
  getCached,
  setCached,
  invalidatePrefix,
  getCacheStats,
  _resetCachesForTests,
} from "../cache";

beforeEach(() => {
  _resetCachesForTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-30T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cache key construction (TRD §8.2)", () => {
  test("role is part of the key so operator and qa get separate buckets", () => {
    const operatorKey = buildKey("bom", "operator", { kind: "list" });
    const qaKey       = buildKey("bom", "qa",       { kind: "list" });
    expect(operatorKey).not.toBe(qaKey);
    expect(operatorKey.startsWith("bom:operator:")).toBe(true);
    expect(qaKey.startsWith("bom:qa:")).toBe(true);
  });

  test("structurally equivalent queries hash to the same key (key order-insensitive)", () => {
    const a = buildKey("bom", "qa", { showDeleted: false, kind: "list" });
    const b = buildKey("bom", "qa", { kind: "list", showDeleted: false });
    expect(a).toBe(b);
  });

  test("string descriptor passes through verbatim", () => {
    expect(buildKey("user", "admin", "list:all")).toBe("user:admin:list:all");
  });
});

describe("hit/miss counters (TRD §8.4)", () => {
  test("setCached then getCached increments hits", () => {
    setCached("bom", "bom:qa:list", { foo: "bar" });
    const hit = getCached<{ foo: string }>("bom", "bom:qa:list");
    expect(hit).toEqual({ foo: "bar" });
    const stats = getCacheStats();
    expect(stats.hits.bom).toBe(1);
    expect(stats.misses.bom).toBe(0);
    expect(stats.hitRate.bom).toBe(1);
  });

  test("getCached miss increments misses, hitRate reflects ratio", () => {
    getCached("bom", "bom:qa:does-not-exist");
    getCached("bom", "bom:qa:does-not-exist");
    setCached("bom", "bom:qa:does-not-exist", { foo: 1 });
    getCached("bom", "bom:qa:does-not-exist");
    const stats = getCacheStats();
    expect(stats.misses.bom).toBe(2);
    expect(stats.hits.bom).toBe(1);
    expect(stats.hitRate.bom).toBeCloseTo(1 / 3, 5);
  });
});

describe("invalidatePrefix (TRD §8.3)", () => {
  test("invalidates every key under the given prefix only", () => {
    setCached("bom", "bom:qa:item:1",       { id: 1 });
    setCached("bom", "bom:qa:item:2",       { id: 2 });
    setCached("bom", "bom:operator:list:0", { items: [] });
    setCached("user", "user:admin:list:all", { users: [] });

    const dropped = invalidatePrefix(bomCache, "bom:");
    expect(dropped).toBe(3);
    expect(getCached("bom", "bom:qa:item:1")).toBeUndefined();
    expect(getCached("user", "user:admin:list:all")).toEqual({ users: [] });
  });
});

// TTL behaviour (TRD §8.1: 60s bom / 30s user / 5min machine) is delegated
// to the LRUCache library, which uses performance.now() internally —
// vitest fake timers don't intercept that without extra configuration. The
// library's own test suite covers TTL eviction; we trust it here and only
// verify our own contract (keys, counters, prefix invalidation).
