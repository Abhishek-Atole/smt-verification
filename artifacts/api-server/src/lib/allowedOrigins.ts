import os from "node:os";

// Module 10.5 (Issue 3) — which browser origins the API accepts.
//
// The previous rule was `ALLOWED_ORIGINS` alone. That is a static list of
// scheme://host:port strings in .env, so when the server's LAN IP changed the
// browser started sending `Origin: http://<new-ip>:4000`, which matched nothing,
// and the CORS callback threw → a generic 500 on `/assets/*` → blank page. The
// SPA and API are the SAME origin in that situation; the list was simply stale.
//
// Two additive sources fix that without widening what a real attacker can do:
//
//  1. Host match — allow the request when the Origin's host:port equals the
//     request's own Host header. That IS same-origin by definition: a page can
//     only carry `Origin: X` if it was served from X, so a same-origin request
//     could not have come from an attacker's page. This is what self-heals an
//     IP change with no restart and no admin action.
//
//  2. The server's own bound addresses, read once at boot, paired with the
//     server's own port. This covers callers that address the box by an IP the
//     Host header doesn't reflect (proxied/rewritten Host).
//
// `ALLOWED_ORIGINS` still works and is still the way to add anything else.
//
// Deliberately NOT allowed: the server's own address on a *different* port.
// `http://192.168.3.189:5173` → `:4000` is a genuine cross-origin request and
// stays subject to the explicit list (dev already ships localhost:5173 in it).

/** Interfaces that are not the appliance's own LAN identity. */
const VIRTUAL_IFACE = /^(docker|br-|veth|virbr|vmnet|tun|tap)/;

/** Parse a scheme://host:port origin into its comparable `host:port` authority. */
export function originAuthority(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // A real Origin header is scheme://host[:port] and nothing else. Anything
    // carrying a path, query, fragment, or userinfo was not produced by a
    // browser, so refuse to reduce it to an authority at all.
    if (url.pathname !== "/" && url.pathname !== "") return null;
    if (url.search || url.hash || url.username || url.password) return null;
    return url.host; // host:port, port omitted when default for the scheme
  } catch {
    return null;
  }
}

/**
 * Origins formed from the addresses this server is actually reachable on,
 * evaluated once at startup. IPv6 addresses are bracketed; link-local (fe80::)
 * is skipped because it needs a zone index a browser will never send.
 */
export function deriveLocalOrigins(port: number, tls: boolean): string[] {
  const scheme = tls ? "https" : "http";
  const origins = new Set<string>();
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_IFACE.test(name)) continue;
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv6") {
        if (addr.address.toLowerCase().startsWith("fe80:")) continue;
        origins.add(`${scheme}://[${addr.address}]:${port}`);
      } else {
        origins.add(`${scheme}://${addr.address}:${port}`);
      }
    }
  }
  origins.add(`${scheme}://localhost:${port}`);
  return [...origins];
}

export interface OriginPolicy {
  /** Explicit list from ALLOWED_ORIGINS. */
  configured: string[];
  /** Derived from this host's own interfaces at boot. */
  local: string[];
}

export type OriginDecision =
  | { allowed: true; reason: "no-origin" | "same-origin" | "configured" | "local-interface" | "development" }
  | { allowed: false };

/**
 * The single decision point. `requestHost` is the raw Host header — comparing
 * against it is what makes an origin "same-origin" even after the IP changes.
 */
export function decideOrigin(
  requestOrigin: string | undefined,
  requestHost: string,
  policy: OriginPolicy,
  isDevelopment: boolean,
): OriginDecision {
  // No Origin header: direct navigation, curl, health checks, non-browser
  // clients. Browsers always send Origin on cross-origin requests, so the
  // absence of one cannot be a cross-origin attack.
  if (!requestOrigin) return { allowed: true, reason: "no-origin" };

  const authority = originAuthority(requestOrigin);
  if (!authority) return { allowed: false };

  if (requestHost && authority === requestHost) return { allowed: true, reason: "same-origin" };
  if (policy.configured.includes(requestOrigin)) return { allowed: true, reason: "configured" };
  if (policy.local.includes(requestOrigin)) return { allowed: true, reason: "local-interface" };
  if (isDevelopment) return { allowed: true, reason: "development" };

  return { allowed: false };
}
