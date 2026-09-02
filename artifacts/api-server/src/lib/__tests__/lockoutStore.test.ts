import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  checkLockout,
  recordFailure,
  recordSuccess,
  _resetForTests,
  _peekForTests,
} from "../lockoutStore";

beforeEach(() => {
  _resetForTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-30T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("user-login bucket (PRD §2.5: 5/15min, 15-min lockout)", () => {
  test("first failure does not lock", () => {
    const r = recordFailure("user-login", "operator1");
    expect(r.locked).toBe(false);
    expect(r.justLocked).toBe(false);
    expect(r.failCount).toBe(1);
    expect(checkLockout("user-login", "operator1").locked).toBe(false);
  });

  test("5th failure trips lockout with justLocked=true exactly once", () => {
    for (let i = 1; i <= 4; i++) {
      const r = recordFailure("user-login", "operator1");
      expect(r.locked).toBe(false);
      expect(r.justLocked).toBe(false);
    }
    const fifth = recordFailure("user-login", "operator1");
    expect(fifth.locked).toBe(true);
    expect(fifth.justLocked).toBe(true);
    expect(fifth.failCount).toBe(5);
    expect(fifth.until).toBeGreaterThan(Date.now());
  });

  test("further failures during lockout do not bump justLocked again", () => {
    for (let i = 0; i < 5; i++) recordFailure("user-login", "operator1");
    const sixth = recordFailure("user-login", "operator1");
    expect(sixth.locked).toBe(true);
    expect(sixth.justLocked).toBe(false);
    expect(sixth.failCount).toBe(5); // counter does not advance further during lock
  });

  test("checkLockout reports locked with until inside the 15-min window", () => {
    for (let i = 0; i < 5; i++) recordFailure("user-login", "operator1");
    const status = checkLockout("user-login", "operator1");
    expect(status.locked).toBe(true);
    expect(status.until).toBe(Date.now() + 15 * 60_000);
  });

  test("lockout expires 15 min later — caller sees fresh slate", () => {
    for (let i = 0; i < 5; i++) recordFailure("user-login", "operator1");
    expect(checkLockout("user-login", "operator1").locked).toBe(true);

    vi.advanceTimersByTime(15 * 60_000 + 1);
    expect(checkLockout("user-login", "operator1").locked).toBe(false);

    // Counter resets — next failure is the 1st in a new window.
    const r = recordFailure("user-login", "operator1");
    expect(r.failCount).toBe(1);
    expect(r.locked).toBe(false);
  });

  test("recordSuccess clears the counter mid-window", () => {
    recordFailure("user-login", "operator1");
    recordFailure("user-login", "operator1");
    recordSuccess("user-login", "operator1");
    expect(_peekForTests("user-login", "operator1")).toBeUndefined();
    // Next failure starts fresh.
    const r = recordFailure("user-login", "operator1");
    expect(r.failCount).toBe(1);
  });

  test("failures across different usernames do not interact", () => {
    for (let i = 0; i < 5; i++) recordFailure("user-login", "operator1");
    expect(checkLockout("user-login", "operator2").locked).toBe(false);
    expect(recordFailure("user-login", "operator2").failCount).toBe(1);
  });

  test("window rolls over before lockout when failures stop after a partial run", () => {
    // 4 failures inside the 15-min window, then idle for 16 min — counter resets.
    for (let i = 0; i < 4; i++) recordFailure("user-login", "operator1");
    vi.advanceTimersByTime(16 * 60_000);
    const r = recordFailure("user-login", "operator1");
    expect(r.failCount).toBe(1);
    expect(r.locked).toBe(false);
  });
});

describe("configurable failedAttemptThreshold (Module 10.5 — admin-settable)", () => {
  test("a lower threshold trips lockout at exactly that count, not the old default of 5", () => {
    // Admin set failedAttemptThreshold = 3 in the dashboard.
    for (let i = 1; i <= 2; i++) {
      const r = recordFailure("user-login", "operator1", 3);
      expect(r.locked).toBe(false);
      expect(r.justLocked).toBe(false);
    }
    const third = recordFailure("user-login", "operator1", 3);
    expect(third.locked).toBe(true);
    expect(third.justLocked).toBe(true);
    expect(third.failCount).toBe(3);
  });

  test("a higher threshold does NOT lock at the old default of 5", () => {
    for (let i = 1; i <= 5; i++) {
      expect(recordFailure("user-login", "operator1", 8).locked).toBe(false);
    }
    for (let i = 6; i <= 7; i++) recordFailure("user-login", "operator1", 8);
    const eighth = recordFailure("user-login", "operator1", 8);
    expect(eighth.locked).toBe(true);
    expect(eighth.justLocked).toBe(true);
    expect(eighth.failCount).toBe(8);
  });

  test("fresh-install fallback: no override → bucket default (5) still enforced", () => {
    // getSecuritySettings returns the default 5 when no row exists; but even an
    // undefined/invalid override must not disable lockout.
    for (let i = 1; i <= 4; i++) expect(recordFailure("user-login", "op", undefined).locked).toBe(false);
    expect(recordFailure("user-login", "op", undefined).justLocked).toBe(true);
  });

  test("an invalid override (0 / negative / non-integer) falls back to the default, never disables lockout", () => {
    for (const bad of [0, -3, 2.5, NaN]) {
      _resetForTests();
      for (let i = 1; i <= 4; i++) expect(recordFailure("user-login", "op", bad).locked).toBe(false);
      expect(recordFailure("user-login", "op", bad).justLocked).toBe(true); // trips at default 5
    }
  });
});

describe("admin-login bucket (PRD §2.5: 3/15min, 30-min lockout)", () => {
  test("3rd failure trips lockout", () => {
    recordFailure("admin-login", "10.0.0.1:admin1");
    recordFailure("admin-login", "10.0.0.1:admin1");
    const third = recordFailure("admin-login", "10.0.0.1:admin1");
    expect(third.locked).toBe(true);
    expect(third.justLocked).toBe(true);
    expect(third.until).toBe(Date.now() + 30 * 60_000); // 30-min lockout per PRD
  });

  test("lockout expires after 30 min", () => {
    for (let i = 0; i < 3; i++) recordFailure("admin-login", "10.0.0.1:admin1");
    expect(checkLockout("admin-login", "10.0.0.1:admin1").locked).toBe(true);
    vi.advanceTimersByTime(30 * 60_000 + 1);
    expect(checkLockout("admin-login", "10.0.0.1:admin1").locked).toBe(false);
  });
});

describe("password-change bucket (PRD §2.5: 3/hr, no sticky lockout)", () => {
  test("3rd failure trips the rate signal", () => {
    recordFailure("password-change", "user-uuid");
    recordFailure("password-change", "user-uuid");
    const third = recordFailure("password-change", "user-uuid");
    expect(third.locked).toBe(true);
    expect(third.justLocked).toBe(true);
  });

  test("rate signal expires at the end of the 1-hour window even though lockoutMs=0", () => {
    for (let i = 0; i < 3; i++) recordFailure("password-change", "user-uuid");
    expect(checkLockout("password-change", "user-uuid").locked).toBe(true);
    vi.advanceTimersByTime(60 * 60_000 + 1);
    expect(checkLockout("password-change", "user-uuid").locked).toBe(false);
  });
});
