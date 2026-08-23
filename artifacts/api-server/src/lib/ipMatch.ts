// Module 10.2 — IP / CIDR matching for the device allow-list.
//
// Devices store either a single IP ("192.168.1.20") or a CIDR range
// ("192.168.1.0/24", "2001:db8::/48"). matchesIp() tests whether an incoming
// request IP falls inside a given allow-entry. Supports IPv4, IPv6, and the
// IPv4-mapped IPv6 form ("::ffff:192.168.1.20") that Node reports on a
// dual-stack socket.

/** Strip an IPv4-mapped IPv6 prefix so "::ffff:192.168.1.20" compares as IPv4. */
export function normalizeIp(ip: string): string {
  const trimmed = (ip ?? "").trim();
  const mapped = trimmed.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mapped ? mapped[1] : trimmed;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/** Expand an IPv6 address to its 8 16-bit groups as a BigInt, or null if invalid. */
function ipv6ToBigInt(ip: string): bigint | null {
  // Reject anything that clearly isn't IPv6.
  if (!ip.includes(":")) return null;
  let head = ip;
  let tail = "";
  if (ip.includes("::")) {
    const [h, t, ...rest] = ip.split("::");
    if (rest.length > 0) return null; // more than one "::"
    head = h;
    tail = t;
  }
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = 8 - (headGroups.length + tailGroups.length);
  if (missing < 0) return null;
  const groups = ip.includes("::")
    ? [...headGroups, ...Array(missing).fill("0"), ...tailGroups]
    : headGroups;
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) + BigInt(parseInt(group, 16));
  }
  return value;
}

/**
 * Does `incomingIp` match the allow-list `entry` (a single IP or a CIDR range)?
 * Returns false on any parse failure — fail closed.
 */
export function matchesIp(incomingIp: string, entry: string): boolean {
  const ip = normalizeIp(incomingIp);
  const target = normalizeIp((entry ?? "").trim());
  if (!ip || !target) return false;

  if (!target.includes("/")) {
    return ip === target; // exact single-IP match
  }

  const [range, bitsRaw] = target.split("/");
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0) return false;

  // IPv4 CIDR
  const ipV4 = ipv4ToInt(ip);
  const rangeV4 = ipv4ToInt(range);
  if (ipV4 !== null && rangeV4 !== null) {
    if (bits > 32) return false;
    if (bits === 0) return true;
    const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
    return (ipV4 & mask) === (rangeV4 & mask);
  }

  // IPv6 CIDR
  const ipV6 = ipv6ToBigInt(ip);
  const rangeV6 = ipv6ToBigInt(range);
  if (ipV6 !== null && rangeV6 !== null) {
    if (bits > 128) return false;
    if (bits === 0) return true;
    const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
    return (ipV6 & mask) === (rangeV6 & mask);
  }

  return false; // family mismatch or unparseable
}

/**
 * Validate an admin-supplied allow-list entry: a bare IPv4/IPv6 address or a
 * CIDR range. Used by the device admin routes to reject garbage before it
 * reaches the allow-list (where a malformed entry would silently never match).
 */
export function isValidIpOrCidr(entry: string): boolean {
  const value = normalizeIp((entry ?? "").trim());
  if (!value) return false;

  if (value.includes("/")) {
    const [range, bitsRaw] = value.split("/");
    const bits = Number(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0) return false;
    if (ipv4ToInt(range) !== null) return bits <= 32;
    if (ipv6ToBigInt(range) !== null) return bits <= 128;
    return false;
  }

  return ipv4ToInt(value) !== null || ipv6ToBigInt(value) !== null;
}

/** Loopback (the host administering itself) is always trusted. */
export function isLoopback(ip: string): boolean {
  const n = normalizeIp(ip);
  return n === "127.0.0.1" || n === "::1" || n.startsWith("127.");
}
