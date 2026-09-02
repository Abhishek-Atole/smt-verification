import { describe, expect, test } from "vitest";
import { decideOrigin, deriveLocalOrigins, originAuthority, type OriginPolicy } from "../lib/allowedOrigins";

// Module 10.5 (Issue 3) — the origin decision. The bug being fixed: a static
// ALLOWED_ORIGINS list went stale when the server's LAN IP changed, so the
// browser's `Origin: http://<new-ip>:4000` matched nothing, the CORS callback
// threw, and every /assets/* request returned a bare 500 → blank SPA. The fix
// must heal that WITHOUT accepting an origin a real attacker could set.

const policy: OriginPolicy = {
  configured: ["http://localhost:5173", "http://192.168.1.108:4000"],
  local: ["http://192.168.3.189:4000", "http://localhost:4000"],
};

const PROD = false; // isDevelopment = false

describe("originAuthority", () => {
  test("reduces an origin to its comparable host:port", () => {
    expect(originAuthority("http://192.168.3.189:4000")).toBe("192.168.3.189:4000");
    expect(originAuthority("https://smt.example.com")).toBe("smt.example.com");
  });

  test("rejects anything that is not a bare http(s) origin", () => {
    // A browser never sends these as Origin; accepting them would mean the
    // host-match comparison could be fed a crafted string.
    expect(originAuthority("file://")).toBeNull();
    expect(originAuthority("null")).toBeNull();
    expect(originAuthority("")).toBeNull();
    expect(originAuthority("javascript:alert(1)")).toBeNull();
    expect(originAuthority("http://192.168.3.189:4000/path")).toBeNull();
    expect(originAuthority("not a url")).toBeNull();
  });

  test("rejects userinfo, query, and fragment — a real Origin has none of them", () => {
    // `http://user:pw@192.168.3.189:4000` parses to host `192.168.3.189:4000`,
    // so without this guard a crafted value would satisfy the host match.
    expect(originAuthority("http://user:pw@192.168.3.189:4000")).toBeNull();
    expect(originAuthority("http://192.168.3.189:4000?x=1")).toBeNull();
    expect(originAuthority("http://192.168.3.189:4000#f")).toBeNull();
  });
});

describe("decideOrigin — the drift case this fix exists for", () => {
  test("a same-origin request is allowed even though the IP is in no list", () => {
    // This is the blank-page scenario: server moved to .77, both Host and
    // Origin reflect .77, neither list mentions it.
    const d = decideOrigin("http://192.168.1.77:4000", "192.168.1.77:4000", policy, PROD);
    expect(d).toEqual({ allowed: true, reason: "same-origin" });
  });

  test("same-origin over IPv6 and over a hostname works the same way", () => {
    expect(decideOrigin("http://[fd01::1]:4000", "[fd01::1]:4000", policy, PROD).allowed).toBe(true);
    expect(decideOrigin("http://smt-line1:4000", "smt-line1:4000", policy, PROD).allowed).toBe(true);
  });

  test("an origin on a DIFFERENT port than the Host is not same-origin", () => {
    // http://host:5173 → http://host:4000 is genuinely cross-origin. Dev needs
    // it, and dev gets it from the explicit list, not from the host match.
    const d = decideOrigin("http://192.168.1.77:5173", "192.168.1.77:4000", policy, PROD);
    expect(d.allowed).toBe(false);
  });

  test("an origin on a different scheme than the Host is not same-origin", () => {
    // Host carries no scheme, so authority equality is all we can compare; an
    // https origin against the same host:port is deliberately still allowed
    // only when the authority matches, which encodes the port.
    expect(decideOrigin("https://192.168.1.77:4443", "192.168.1.77:4000", policy, PROD).allowed).toBe(false);
  });
});

describe("decideOrigin — the other allow paths", () => {
  test("no Origin header is allowed: curl, health checks, direct navigation", () => {
    expect(decideOrigin(undefined, "192.168.3.189:4000", policy, PROD)).toEqual({
      allowed: true,
      reason: "no-origin",
    });
  });

  test("ALLOWED_ORIGINS entries still work — this fix is additive", () => {
    expect(decideOrigin("http://localhost:5173", "192.168.3.189:4000", policy, PROD)).toEqual({
      allowed: true,
      reason: "configured",
    });
  });

  test("a boot-derived interface address is allowed when the Host does not match it", () => {
    // e.g. a proxy rewrote Host, or the client addressed a second NIC.
    expect(decideOrigin("http://192.168.3.189:4000", "smt-line1:4000", policy, PROD)).toEqual({
      allowed: true,
      reason: "local-interface",
    });
  });

  test("development still accepts anything, as before", () => {
    expect(decideOrigin("http://evil.example.com", "192.168.3.189:4000", policy, true)).toEqual({
      allowed: true,
      reason: "development",
    });
  });
});

describe("decideOrigin — what must stay rejected", () => {
  test("a foreign site is rejected in production", () => {
    expect(decideOrigin("http://evil.example.com", "192.168.3.189:4000", policy, PROD).allowed).toBe(false);
  });

  test("a lookalike host is rejected — matching is exact, not substring", () => {
    for (const origin of [
      "http://192.168.3.189.evil.com",
      "http://evil.com/192.168.3.189:4000",
      "http://192.168.3.1890:4000",
      "http://192.168.3.18:4000",
      // An IP-shaped lookalike with a prefixed label: `new URL()` rejects it
      // outright, so it never reaches the comparison at all.
      "http://x192.168.3.189:4000",
    ]) {
      expect(decideOrigin(origin, "192.168.3.189:4000", policy, PROD).allowed).toBe(false);
    }
  });

  test("a host that merely contains the origin's authority is not same-origin", () => {
    // Guards the reverse substring mistake: Host "a.192.168.3.189:4000"
    // contains "192.168.3.189:4000" but is a different host.
    expect(decideOrigin("http://168.3.189:4000", "192.168.3.189:4000", policy, PROD).allowed).toBe(false);
  });

  test("a subdomain of the Host is rejected — the comparison is equality, not suffix", () => {
    // The only shape where a substring comparison is actually reachable: an
    // IP-shaped lookalike fails URL parsing, but a NAME-based one parses fine.
    // `evil.smt-line1:4000` contains `smt-line1:4000` yet is a foreign host.
    expect(decideOrigin("http://evil.smt-line1:4000", "smt-line1:4000", policy, PROD).allowed).toBe(false);
    expect(decideOrigin("http://smt-line1.evil.com", "smt-line1:4000", policy, PROD).allowed).toBe(false);
  });

  test("an unparseable or opaque Origin is rejected, never treated as same-origin", () => {
    // "null" is what a sandboxed iframe or file:// page sends. If an empty Host
    // ever met an empty authority, a blank compare must not become an allow.
    expect(decideOrigin("null", "192.168.3.189:4000", policy, PROD).allowed).toBe(false);
    expect(decideOrigin("null", "", policy, PROD).allowed).toBe(false);
    expect(decideOrigin("http://evil.example.com", "", policy, PROD).allowed).toBe(false);
  });
});

describe("deriveLocalOrigins", () => {
  const origins = deriveLocalOrigins(4000, false);

  test("includes loopback and the port, and always includes localhost", () => {
    expect(origins).toContain("http://127.0.0.1:4000");
    expect(origins).toContain("http://localhost:4000");
  });

  test("excludes docker/bridge/veth interfaces — those are not the appliance's LAN identity", () => {
    expect(origins.some((o) => o.includes("172.17.0.1") || o.includes("172.18.0.1"))).toBe(false);
  });

  test("excludes IPv6 link-local, which a browser cannot send without a zone index", () => {
    expect(origins.some((o) => o.toLowerCase().includes("fe80"))).toBe(false);
  });

  test("uses https when TLS is terminated by this server", () => {
    expect(deriveLocalOrigins(4443, true)).toContain("https://localhost:4443");
  });
});
