import { describe, expect, test } from "vitest";
import { checkProxyCookieSafety } from "../validateEnv";

// Security audit Item 2 — the boot guard that refuses to start when the server
// trusts X-Forwarded-For (TRUST_PROXY active) AND serves cookies over plaintext
// HTTP (COOKIE_SECURE=false). Tested via the pure checkProxyCookieSafety(env)
// helper so we assert the decision without spawning/exiting a process.

describe("checkProxyCookieSafety — dangerous combinations block startup", () => {
  test("TRUST_PROXY=true + COOKIE_SECURE=false → error message", () => {
    const msg = checkProxyCookieSafety({ TRUST_PROXY: "true", COOKIE_SECURE: "false" });
    expect(msg).not.toBeNull();
    expect(msg).toContain("Refusing to start");
  });

  test("TRUST_PROXY=<hop count> + COOKIE_SECURE=false → error message", () => {
    expect(checkProxyCookieSafety({ TRUST_PROXY: "1", COOKIE_SECURE: "false" })).not.toBeNull();
    expect(checkProxyCookieSafety({ TRUST_PROXY: "2", COOKIE_SECURE: "false" })).not.toBeNull();
  });

  test("TRUST_PROXY=<subnet spec> + COOKIE_SECURE=false → error message", () => {
    // A subnet/IP trust value still enables XFF trust; combined with plaintext
    // cookies it is the same dangerous shape.
    expect(checkProxyCookieSafety({ TRUST_PROXY: "10.0.0.0/8", COOKIE_SECURE: "false" })).not.toBeNull();
  });
});

describe("checkProxyCookieSafety — safe combinations start normally", () => {
  test("both unset → null", () => {
    expect(checkProxyCookieSafety({})).toBeNull();
  });

  test("TRUST_PROXY active but COOKIE_SECURE not 'false' → null", () => {
    expect(checkProxyCookieSafety({ TRUST_PROXY: "true" })).toBeNull();
    expect(checkProxyCookieSafety({ TRUST_PROXY: "true", COOKIE_SECURE: "true" })).toBeNull();
  });

  test("COOKIE_SECURE=false alone (no proxy trust) → null", () => {
    expect(checkProxyCookieSafety({ COOKIE_SECURE: "false" })).toBeNull();
  });

  test("TRUST_PROXY=false / '0' are not active → null even with COOKIE_SECURE=false", () => {
    // "false" = no proxy; "0" = trust 0 hops (req.ip stays the socket IP).
    expect(checkProxyCookieSafety({ TRUST_PROXY: "false", COOKIE_SECURE: "false" })).toBeNull();
    expect(checkProxyCookieSafety({ TRUST_PROXY: "0", COOKIE_SECURE: "false" })).toBeNull();
  });

  test("whitespace-only TRUST_PROXY is treated as unset → null", () => {
    expect(checkProxyCookieSafety({ TRUST_PROXY: "  ", COOKIE_SECURE: "false" })).toBeNull();
  });
});
