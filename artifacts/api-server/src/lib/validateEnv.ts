import { logger } from "./logger";

const REQUIRED = ["DATABASE_URL", "JWT_SECRET", "ALLOWED_ORIGINS"];

// Security audit Item 2 — the one misconfiguration that actually defeats the
// Module 10 device model: trusting X-Forwarded-For without a real reverse proxy
// in front (so any client can spoof its source IP into the allow-list) while
// also serving session cookies over plaintext HTTP (COOKIE_SECURE=false).
//
// TRUST_PROXY is read here with the SAME semantics app.ts uses to call
// `app.set("trust proxy", …)`: proxy trust is ACTIVE for any value that is set,
// not "false", and not "0" (0 hops = don't trust XFF). That covers "true", a
// positive hop count, and an explicit IP/subnet/"loopback" spec. COOKIE_SECURE
// disables the Secure flag only on the exact string "false" (see routes/auth.ts).
//
// Returns a human-readable error string when the dangerous combination is
// present, else null. Pure (takes env explicitly) so it can be unit-tested
// without spawning a process.
export function checkProxyCookieSafety(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const trustProxy = (env.TRUST_PROXY ?? "").trim();
  const proxyTrustActive = trustProxy !== "" && trustProxy !== "false" && trustProxy !== "0";
  const cookieInsecure = env.COOKIE_SECURE === "false";
  if (proxyTrustActive && cookieInsecure) {
    return (
      `Refusing to start: TRUST_PROXY="${trustProxy}" trusts X-Forwarded-For, but ` +
      `COOKIE_SECURE=false serves session cookies over plaintext HTTP. Together, a client ` +
      `can spoof X-Forwarded-For to an allow-listed IP and bypass device restriction (Module 10), ` +
      `and session cookies are interceptable on the wire. Fix ONE of these: put a real reverse ` +
      `proxy in front (one that overwrites X-Forwarded-For) and set COOKIE_SECURE=true, OR leave ` +
      `TRUST_PROXY unset for a direct-LAN install.`
    );
  }
  return null;
}

export function validateEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    logger.error({ missing }, "Missing required env vars");
    process.exit(1);
  }

  // Item 2 — hard-fail (not warn) on the IP-spoofing + plaintext-cookie combo.
  const unsafe = checkProxyCookieSafety();
  if (unsafe) {
    logger.error(unsafe);
    process.exit(1);
  }
}
