// @vitest-environment jsdom
// Module 13 — the shared session-expiry guard. These are the invariants that
// keep the "fixed in one place, still broken in another" bug from coming back:
// the 401 → login redirect must land on the *route's own* login surface, and it
// must not fire for a wrong password or for the logged-out mount probe (which
// would reload-loop).

import { beforeEach, describe, expect, test, vi } from "vitest";

import { STORE_ROUTE } from "../../store/config";
import { ADMIN_ROUTE } from "../../admin/config";
import {
  AUTH_SESSION_HINT_KEY,
  consumeSessionExpiredNotice,
  is401SessionExpiry,
  loginSurfaceForPath,
  redirectToLoginSurface,
  __resetRedirectLatchForTests,
} from "../session-guard";

// jsdom's window.location.assign is a "not implemented" stub, so swap the whole
// object for a plain one we can both drive (pathname) and observe (assign).
const assign = vi.fn();
function setPathname(pathname: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { origin: "http://localhost:3000", pathname, assign },
  });
}

beforeEach(() => {
  assign.mockClear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  __resetRedirectLatchForTests();
  setPathname("/");
});

describe("loginSurfaceForPath", () => {
  test("store routes resolve to the store login window", () => {
    expect(loginSurfaceForPath(STORE_ROUTE)).toBe(STORE_ROUTE);
    expect(loginSurfaceForPath(`${STORE_ROUTE}/receipts`)).toBe(STORE_ROUTE);
  });

  test("admin routes resolve to the admin portal, never the shop-floor login", () => {
    expect(loginSurfaceForPath(ADMIN_ROUTE)).toBe(ADMIN_ROUTE);
    expect(loginSurfaceForPath(`${ADMIN_ROUTE}/users`)).toBe(ADMIN_ROUTE);
  });

  test("everything else resolves to the main login", () => {
    expect(loginSurfaceForPath("/")).toBe("/login");
    expect(loginSurfaceForPath("/verification/42")).toBe("/login");
    // Prefix must not match a same-prefixed sibling route.
    expect(loginSurfaceForPath(`${STORE_ROUTE}keeping`)).toBe("/login");
  });
});

describe("is401SessionExpiry", () => {
  test("a 401 on a normal API call is an expired session", () => {
    expect(is401SessionExpiry("/api/sessions/12")).toBe(true);
    expect(is401SessionExpiry("/api/notifications?since=1")).toBe(true);
    expect(is401SessionExpiry("http://localhost:3000/api/admin/users")).toBe(true);
  });

  test("credential-check endpoints are exempt (401 there means wrong password)", () => {
    expect(is401SessionExpiry("/api/auth/login")).toBe(false);
    expect(is401SessionExpiry("/api/auth/verify-password")).toBe(false);
    expect(is401SessionExpiry("/api/auth/verify-override")).toBe(false);
    expect(is401SessionExpiry("/api/auth/change-password")).toBe(false);
    expect(is401SessionExpiry("/api/admin/auth/login")).toBe(false);
  });

  test("the mount-time session probe is exempt (else it reload-loops)", () => {
    expect(is401SessionExpiry("/api/auth/me")).toBe(false);
    expect(is401SessionExpiry("/api/admin/auth/me")).toBe(false);
  });

  test("refresh is exempt — the expiry timer owns that failure", () => {
    expect(is401SessionExpiry("/api/auth/refresh")).toBe(false);
  });

  test("non-API requests are ignored entirely", () => {
    expect(is401SessionExpiry("/login")).toBe(false);
    expect(is401SessionExpiry("/assets/index.js")).toBe(false);
  });
});

describe("redirectToLoginSurface", () => {
  test("navigates to the main login and records the notice", () => {
    window.localStorage.setItem(AUTH_SESSION_HINT_KEY, "true");
    setPathname("/verification/7");

    redirectToLoginSurface();

    expect(assign).toHaveBeenCalledWith("/login");
    // The hint gates AuthProvider's /auth/me probe — leaving it set makes the
    // reloaded app flash a loading state before showing the login.
    expect(window.localStorage.getItem(AUTH_SESSION_HINT_KEY)).toBeNull();
    expect(consumeSessionExpiredNotice()).toBe(true);
  });

  test("keeps a storekeeper in the store window", () => {
    setPathname(`${STORE_ROUTE}/issue`);
    redirectToLoginSurface();
    expect(assign).toHaveBeenCalledWith(STORE_ROUTE);
  });

  test("keeps an admin in the admin portal instead of the shop-floor login", () => {
    setPathname(`${ADMIN_ROUTE}/security`);
    redirectToLoginSurface();
    expect(assign).toHaveBeenCalledWith(ADMIN_ROUTE);
  });

  test("latches — a burst of failing polls produces exactly one navigation", () => {
    redirectToLoginSurface();
    redirectToLoginSurface();
    redirectToLoginSurface();
    expect(assign).toHaveBeenCalledTimes(1);
  });

  test("no-op when already on the main login form (don't wipe what's typed)", () => {
    setPathname("/login");
    redirectToLoginSurface();
    expect(assign).not.toHaveBeenCalled();
    expect(consumeSessionExpiredNotice()).toBe(false);
  });
});

describe("consumeSessionExpiredNotice", () => {
  test("returns true once, then false", () => {
    redirectToLoginSurface();
    expect(consumeSessionExpiredNotice()).toBe(true);
    expect(consumeSessionExpiredNotice()).toBe(false);
  });

  test("false when the user reached the login screen normally", () => {
    expect(consumeSessionExpiredNotice()).toBe(false);
  });
});
