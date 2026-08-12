// U17 — in-memory user-ID revocation list.
// When admin revokes a user, the user's ID lands here with a TTL = max JWT lifetime
// (8 h to match LOGIN_DURATION_MS). After that the natural JWT expiry kicks in,
// so the entry can be evicted without risk.
//
// Simple Map + periodic sweep is fine for our scale (<200 users). For larger
// fleets, swap for a real LRU library.

const TTL_MS = 8 * 60 * 60 * 1000;
const revoked = new Map<string, number>(); // userId -> revokedUntil (unix ms)

export function revokeUser(userId: string): void {
  revoked.set(userId, Date.now() + TTL_MS);
}

export function isRevoked(userId: string): boolean {
  const until = revoked.get(userId);
  if (!until) return false;
  if (Date.now() > until) {
    revoked.delete(userId);
    return false;
  }
  return true;
}

export function unrevoke(userId: string): void {
  revoked.delete(userId);
}

// Periodic eviction sweep — runs every 5 min, removes any expired entries.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [id, until] of revoked.entries()) {
    if (now > until) revoked.delete(id);
  }
}, 5 * 60 * 1000);
sweep.unref?.();
