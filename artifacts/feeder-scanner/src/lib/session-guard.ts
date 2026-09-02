// Module 13 — session expiry → automatic redirect to the *correct* login screen.
//
// One shared guard, deliberately framework-free so both entry points can use it:
//   • the window.fetch patch in main.tsx (reactive: any 401 from any caller)
//   • the proactive expiry timer in context/auth-context.tsx (silent refresh)
//
// The spec requires this be "implemented once as a shared client-side
// interceptor/guard, not re-implemented per dashboard" — the previous behaviour
// lived in src/lib/api.ts and hardcoded window.location.assign("/login"), which
// would have thrown an admin or storekeeper out of their own portal entirely.
// Module 10.4 built three separate login surfaces; this module is the single
// place that knows which one a given route belongs to.

import { STORE_ROUTE } from "../store/config";
import { ADMIN_ROUTE } from "../admin/config";

// Survives the full page reload the redirect performs, so the login screen can
// explain *why* the user is suddenly looking at it. sessionStorage (not local)
// so it dies with the tab and cannot resurface days later.
const SESSION_EXPIRED_FLAG = "smt-session-expired";

// Gates whether AuthProvider bothers probing /api/auth/me on mount. Cleared on
// redirect so the reloaded provider renders the login screen immediately instead
// of flashing a loading state. Lives here (framework-free) rather than in
// auth-context so the guard and the provider cannot drift apart on the key name.
export const AUTH_SESSION_HINT_KEY = "feeder-scanner-auth-session";

// 401 from these endpoints is NOT an expired session:
//   • login / verify-password / verify-override / change-password — these return
//     401 `auth_invalid_credentials` for a *wrong password*. Redirecting here
//     would bounce the user off the form they are typing into. (change-password
//     also sits behind requireAuth, so a genuinely dead session there is caught
//     by the next request instead — the false positive is the worse failure.)
//   • auth/me and admin/auth/me — the mount-time "am I logged in?" probe. It
//     401s normally when logged out; the React layer already handles that by
//     rendering the login screen. Redirecting on it would reload-loop.
//   • auth/refresh — owned by the expiry timer, which decides what a failure
//     means.
const NON_EXPIRY_401_PATHS = [
  "/api/auth/login",
  "/api/auth/me",
  "/api/auth/refresh",
  "/api/auth/change-password",
  "/api/auth/verify-password",
  "/api/auth/verify-override",
  "/api/admin/auth/login",
  "/api/admin/auth/me",
  "/api/admin/auth/change-credentials",
];

/** The login surface that owns `pathname` (Module 10.4's three entry points). */
export function loginSurfaceForPath(pathname: string): string {
  if (pathname === STORE_ROUTE || pathname.startsWith(`${STORE_ROUTE}/`)) return STORE_ROUTE;
  if (pathname === ADMIN_ROUTE || pathname.startsWith(`${ADMIN_ROUTE}/`)) return ADMIN_ROUTE;
  return "/login";
}

/**
 * True when a 401 on `url` means "your session died", as opposed to "those
 * credentials are wrong" or "you were never logged in". Accepts absolute or
 * relative URLs; anything that is not an /api/* call is ignored outright.
 */
export function is401SessionExpiry(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url, window.location.origin).pathname;
  } catch {
    return false;
  }
  if (!pathname.startsWith("/api/")) return false;
  return !NON_EXPIRY_401_PATHS.some((p) => pathname === p);
}

// Latch. A dying session usually kills several in-flight requests at once (the
// 15s notification poll, the 30s handover poll, whatever the user just clicked),
// and each would otherwise fire its own navigation.
let redirecting = false;

/**
 * Clear local auth traces, record the "session expired" notice, and navigate to
 * the login surface for the current route. Idempotent — safe to call from every
 * failing request in a burst.
 */
export function redirectToLoginSurface(): void {
  if (typeof window === "undefined" || redirecting) return;

  const target = loginSurfaceForPath(window.location.pathname);

  // Already sitting on the main login form: reloading it would wipe whatever the
  // user has typed for no gain. (The store and admin surfaces render their login
  // inline at the same pathname, so they are deliberately NOT covered by this —
  // there the reload is what tears down the stale authed shell.) The old
  // redirect in lib/api.ts had this same guard; keep it.
  if (target === "/login" && window.location.pathname === "/login") return;

  redirecting = true;

  try { window.localStorage.removeItem(AUTH_SESSION_HINT_KEY); } catch { /* private mode */ }
  try { window.sessionStorage.setItem(SESSION_EXPIRED_FLAG, "1"); } catch { /* private mode */ }

  // A full navigation rather than a SPA route change: it guarantees every stale
  // poller, timer and cached query is torn down, which is the whole point of
  // "should not silently retry forever". Re-entering in-progress form data after
  // re-login is accepted by the spec; an unexplained jump is not — hence the
  // notice flag above.
  window.location.assign(target);
}

/**
 * Read-and-clear the "session expired" notice. Called by the three login
 * screens on mount; returns true at most once per expiry.
 */
export function consumeSessionExpiredNotice(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.sessionStorage.getItem(SESSION_EXPIRED_FLAG) !== "1") return false;
    window.sessionStorage.removeItem(SESSION_EXPIRED_FLAG);
    return true;
  } catch {
    return false;
  }
}

export const SESSION_EXPIRED_MESSAGE = "Session expired — please log in again.";

/** Test-only: reset the one-shot navigation latch. */
export function __resetRedirectLatchForTests(): void {
  redirecting = false;
}
