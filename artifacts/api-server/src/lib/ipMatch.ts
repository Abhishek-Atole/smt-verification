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
 * A prefix length: digits only, no sign, no whitespace, no leading zeros beyond
 * "0" itself. Deliberately NOT `Number()` — `Number("")` is 0 and `Number(" 24")`
 * is 24, which is exactly how "192.168.1.0/" used to be read as /0 (allow-all).
 */
const PREFIX_RE = /^(?:0|[1-9]\d*)$/;

type ParsedEntry =
  | { family: "ipv4"; value: number; bits: number }
  | { family: "ipv6"; value: bigint; bits: number };

/**
 * Parse an allow-list entry (single address or CIDR) into its numeric form.
 * Returns null on anything malformed — the single strict gate that both
 * matchesIp() and isValidIpOrCidr() go through, so they cannot drift apart.
 */
function parseEntry(entry: string): ParsedEntry | null {
  if (typeof entry !== "string" || entry === "") return null;
  // Any whitespace at all — leading, trailing, or inside the prefix.
  if (/\s/.test(entry)) return null;

  const slashes = entry.split("/").length - 1;
  if (slashes > 1) return null; // "192.168.1.0/24/8"

  let address = entry;
  let prefixRaw: string | null = null;
  if (slashes === 1) {
    const idx = entry.indexOf("/");
    address = entry.slice(0, idx);
    prefixRaw = entry.slice(idx + 1);
    // "/24" (no address) and "192.168.1.0/" (no prefix) are both malformed.
    if (!address || !prefixRaw) return null;
    if (!PREFIX_RE.test(prefixRaw)) return null;
  }

  const normalized = normalizeIp(address);

  const v4 = ipv4ToInt(normalized);
  if (v4 !== null) {
    // No prefix means a single host, i.e. an implicit /32.
    const bits = prefixRaw === null ? 32 : Number(prefixRaw);
    if (bits > 32) return null;
    return { family: "ipv4", value: v4, bits };
  }

  const v6 = ipv6ToBigInt(normalized);
  if (v6 !== null) {
    const bits = prefixRaw === null ? 128 : Number(prefixRaw);
    if (bits > 128) return null;
    return { family: "ipv6", value: v6, bits };
  }

  return null;
}

/**
 * Does `incomingIp` match the allow-list `entry` (a single IP or a CIDR range)?
 * Returns false on any parse failure — fail closed.
 */
export function matchesIp(incomingIp: string, entry: string): boolean {
  const target = parseEntry((entry ?? "").trim());
  if (!target) return false;
  // The incoming side comes from the socket, not from admin input, so it is only
  // ever a bare address; a prefix here would be meaningless.
  const source = parseEntry(normalizeIp(incomingIp));
  if (!source) return false;
  if (source.family !== target.family) return false;

  if (target.family === "ipv4") {
    const ip = source.value as number;
    const range = target.value;
    if (target.bits === 0) return true; // an explicit, deliberate 0.0.0.0/0
    const mask = target.bits === 32 ? 0xffffffff : (0xffffffff << (32 - target.bits)) >>> 0;
    return (ip & mask) === (range & mask);
  }

  const ip = source.value as bigint;
  const range = target.value as bigint;
  if (target.bits === 0) return true; // an explicit, deliberate ::/0
  const mask = ((1n << BigInt(target.bits)) - 1n) << BigInt(128 - target.bits);
  return (ip & mask) === (range & mask);
}

/**
 * Validate an admin-supplied allow-list entry: a bare IPv4/IPv6 address or a
 * CIDR range. Used by the device admin routes to reject garbage before it
 * reaches the allow-list.
 *
 * Strict by design. A malformed entry that gets stored is worse than a rejected
 * one in both directions: it either never matches (the device is 403d forever
 * while the admin believes it is registered) or — for the trailing-slash case
 * this guards — it is read as /0 and silently admits every address on the
 * network. See decision.md 2026-08-30.
 */
export function isValidIpOrCidr(entry: string): boolean {
  return parseEntry(entry ?? "") !== null;
}

/** Loopback (the host administering itself) is always trusted. */
export function isLoopback(ip: string): boolean {
  const n = normalizeIp(ip);
  return n === "127.0.0.1" || n === "::1" || n.startsWith("127.");
}
