// PRD §2.5 / TRD §6.6 — in-memory lockout store for login + password-change.
//
// `express-rate-limit` already gates raw IP throughput (loginLimiter on
// /auth/login, apiLimiter elsewhere). That stops scraper-style hammering but
// does NOT enforce the per-username "5 failed attempts → 15 min lockout" the
// PRD demands. This module supplies the missing state — a tiny Map keyed by
// username (or `${ip}:${username}` for admin) with fail count + lockedUntil.
//
// Single-instance only: the lockout state lives in this Node process. If we
// ever go multi-instance, swap the Map for Redis with the same surface.

export type LockoutBucket = "user-login" | "admin-login" | "password-change";

interface BucketConfig {
  maxAttempts: number;
  windowMs: number;
  lockoutMs: number;   // 0 = rate-only, no sticky lockout (password-change)
}

const CONFIG: Record<LockoutBucket, BucketConfig> = {
  // PRD line 306: 5 attempts / 15 min, 15-min lockout
  "user-login":      { maxAttempts: 5, windowMs: 15 * 60_000, lockoutMs: 15 * 60_000 },
  // PRD line 313: 3 attempts / 15 min, 30-min lockout
  "admin-login":     { maxAttempts: 3, windowMs: 15 * 60_000, lockoutMs: 30 * 60_000 },
  // PRD line 308: 3 / hour, no lockout (return 429 once the counter trips)
  "password-change": { maxAttempts: 3, windowMs: 60 * 60_000, lockoutMs: 0 },
};

interface Entry {
  failCount: number;
  firstFailureAt: number;
  lockedUntil: number;   // 0 when not locked
}

const store: Map<string, Entry> = new Map();

function bucketKey(bucket: LockoutBucket, key: string): string {
  return `${bucket}:${key}`;
}

// Wipe a stale entry whose window has rolled past. Called lazily on touch so
// we don't need a sweeper interval — memory stays bounded by max(unique keys
// in flight).
function gcIfExpired(entry: Entry, cfg: BucketConfig, now: number): boolean {
  if (entry.lockedUntil > 0 && entry.lockedUntil <= now) return true;     // lockout expired
  if (entry.lockedUntil === 0 && now - entry.firstFailureAt >= cfg.windowMs) return true; // window rolled
  return false;
}

export interface LockoutStatus {
  locked: boolean;
  until?: number;   // epoch ms when lockout expires (undefined if not locked)
}

export function checkLockout(bucket: LockoutBucket, key: string): LockoutStatus {
  const cfg = CONFIG[bucket];
  const k = bucketKey(bucket, key);
  const entry = store.get(k);
  if (!entry) return { locked: false };

  const now = Date.now();
  if (gcIfExpired(entry, cfg, now)) {
    store.delete(k);
    return { locked: false };
  }
  if (entry.lockedUntil > now) {
    return { locked: true, until: entry.lockedUntil };
  }
  return { locked: false };
}

export interface RecordFailureResult extends LockoutStatus {
  justLocked: boolean;   // true on the exact attempt that pushed the counter over the threshold
  failCount: number;
}

/**
 * `maxAttemptsOverride` lets the caller supply the admin-configurable
 * `failedAttemptThreshold` from `security_settings` (read via the cached
 * getSecuritySettings, so no per-attempt DB round-trip). Passed by the
 * user-login path only; admin-login / password-change keep their stricter
 * PRD defaults. An absent/invalid override falls back to the bucket default,
 * which is also the fresh-install case (no settings row yet).
 */
export function recordFailure(
  bucket: LockoutBucket,
  key: string,
  maxAttemptsOverride?: number,
): RecordFailureResult {
  const cfg = CONFIG[bucket];
  const maxAttempts =
    Number.isInteger(maxAttemptsOverride) && (maxAttemptsOverride as number) > 0
      ? (maxAttemptsOverride as number)
      : cfg.maxAttempts;
  const k = bucketKey(bucket, key);
  const now = Date.now();
  let entry = store.get(k);

  if (entry && gcIfExpired(entry, cfg, now)) {
    store.delete(k);
    entry = undefined;
  }

  if (!entry) {
    entry = { failCount: 1, firstFailureAt: now, lockedUntil: 0 };
    store.set(k, entry);
    return { locked: false, justLocked: false, failCount: 1 };
  }

  // Already locked — don't bump counter further, just report status.
  if (entry.lockedUntil > now) {
    return { locked: true, until: entry.lockedUntil, justLocked: false, failCount: entry.failCount };
  }

  entry.failCount += 1;

  if (entry.failCount >= maxAttempts) {
    // Trip the lockout. lockoutMs=0 (password-change) keeps lockedUntil=0
    // so further requests in-window still 429 via the failCount check on
    // the caller side, but no sticky lockout window.
    if (cfg.lockoutMs > 0) {
      entry.lockedUntil = now + cfg.lockoutMs;
    } else {
      // Rate-only mode: hold lockedUntil at the end of the window so caller
      // gets a `locked: true` signal without a real lockout extension.
      entry.lockedUntil = entry.firstFailureAt + cfg.windowMs;
    }
    return {
      locked: true,
      until: entry.lockedUntil,
      justLocked: true,
      failCount: entry.failCount,
    };
  }

  return { locked: false, justLocked: false, failCount: entry.failCount };
}

export function recordSuccess(bucket: LockoutBucket, key: string): void {
  store.delete(bucketKey(bucket, key));
}

// Test-only: drop all state. Exported under a leading underscore so it
// doesn't surface in IDE autocomplete for production code.
export function _resetForTests(): void {
  store.clear();
}

// Test-only: peek into the store. Used by rate-limit.test.ts to assert
// state without going through the public surface.
export function _peekForTests(bucket: LockoutBucket, key: string): Entry | undefined {
  return store.get(bucketKey(bucket, key));
}
