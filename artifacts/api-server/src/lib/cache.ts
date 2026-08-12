// PRD §2.7 / TRD §8 — in-memory LRU caches for BOM, users, and machines.
//
// Three distinct instances per TRD §8.1, each with its own size cap and TTL.
// Cache keys follow TRD §8.2: `{resource}:{role}:{id-or-query-hash}` — role
// is in the key so the BOM operator-projection (no cost / lead time) is
// stored separately from the QA full-projection. Without that, a QA read
// could leak into a later operator read on a cache hit.
//
// Writes happen at the route layer (no service layer for BOM/users in this
// codebase). Every write calls `invalidatePrefix(cache, 'bom:')` or the
// equivalent. Per TRD §8.3, we NEVER cache session-scoped data — only
// the three lookup tables above.
//
// Hit/miss counters surface at /admin/metrics/latest (TRD §8.4). The
// dashboard targets > 70 % hit rate after warmup; we report it as
// observability, not a hard enforcement.

import { LRUCache } from "lru-cache";
import crypto from "node:crypto";

export const bomCache     = new LRUCache<string, object>({ max: 500, ttl: 60 * 1000 });
export const userCache    = new LRUCache<string, object>({ max: 200, ttl: 30 * 1000 });
export const machineCache = new LRUCache<string, object>({ max:  50, ttl: 5 * 60 * 1000 });

export type CacheName = "bom" | "user" | "machine";

const CACHES: Record<CacheName, LRUCache<string, object>> = {
  bom: bomCache,
  user: userCache,
  machine: machineCache,
};

interface Counters {
  hits: Record<CacheName, number>;
  misses: Record<CacheName, number>;
}

const counters: Counters = {
  hits:   { bom: 0, user: 0, machine: 0 },
  misses: { bom: 0, user: 0, machine: 0 },
};

// TRD §8.2 — key format. queryDescriptor is anything that uniquely identifies
// the request: an id, or a structured query object that gets hashed below.
export function buildKey(resource: CacheName, role: string, queryDescriptor: string | Record<string, unknown>): string {
  const tail = typeof queryDescriptor === "string"
    ? queryDescriptor
    : hashQuery(queryDescriptor);
  return `${resource}:${role}:${tail}`;
}

function hashQuery(q: Record<string, unknown>): string {
  // Sort keys so structurally equivalent queries map to the same hash.
  const sorted = Object.keys(q).sort().reduce<Record<string, unknown>>((acc, k) => {
    acc[k] = q[k];
    return acc;
  }, {});
  return crypto.createHash("sha1").update(JSON.stringify(sorted)).digest("hex").slice(0, 16);
}

// TRD §8.3 — invalidate every key under a prefix. Returns count for tests.
export function invalidatePrefix(cache: LRUCache<string, object>, prefix: string): number {
  let n = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      n++;
    }
  }
  return n;
}

// Typed read helpers. Increment hit/miss counters; route handlers don't
// touch the LRUCache directly.
export function getCached<T>(cache: CacheName, key: string): T | undefined {
  const hit = CACHES[cache].get(key) as T | undefined;
  if (hit !== undefined) counters.hits[cache]++;
  else                   counters.misses[cache]++;
  return hit;
}

export function setCached<T>(cache: CacheName, key: string, value: T): void {
  // The LRUCache generic enforces `object`; callers only ever cache JSON-
  // serialisable response bodies, so the cast is safe in practice.
  CACHES[cache].set(key, value as unknown as object);
}

// TRD §8.4 — counter snapshot for /admin/metrics. Numerator/denominator are
// surfaced as well so the dashboard can show "300/420 (71 %)" without doing
// the division on the client.
export function getCacheStats(): {
  hits: Record<CacheName, number>;
  misses: Record<CacheName, number>;
  hitRate: Record<CacheName, number>;
} {
  const hitRate: Record<CacheName, number> = { bom: 0, user: 0, machine: 0 };
  for (const name of Object.keys(CACHES) as CacheName[]) {
    const total = counters.hits[name] + counters.misses[name];
    hitRate[name] = total > 0 ? counters.hits[name] / total : 0;
  }
  return {
    hits:   { ...counters.hits },
    misses: { ...counters.misses },
    hitRate,
  };
}

// Test-only.
export function _resetCachesForTests(): void {
  bomCache.clear();
  userCache.clear();
  machineCache.clear();
  counters.hits   = { bom: 0, user: 0, machine: 0 };
  counters.misses = { bom: 0, user: 0, machine: 0 };
}
