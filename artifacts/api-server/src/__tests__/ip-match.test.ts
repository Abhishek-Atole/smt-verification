import { describe, expect, test } from "vitest";
import { isLoopback, isValidIpOrCidr, matchesIp, normalizeIp } from "../lib/ipMatch";

// Module 10.2 — this is the function standing between the operators and a
// locked-out production line: a wrong result either admits an unregistered
// device or 403s every client including the admin portal (recoverable only via
// `DELETE FROM devices;` against the DB). It had no coverage before this file.

describe("normalizeIp", () => {
  test("strips the IPv4-mapped IPv6 prefix Node reports on dual-stack sockets", () => {
    expect(normalizeIp("::ffff:192.168.10.108")).toBe("192.168.10.108");
    expect(normalizeIp("::FFFF:192.168.10.108")).toBe("192.168.10.108");
  });

  test("passes through plain addresses and trims whitespace", () => {
    expect(normalizeIp("192.168.10.108")).toBe("192.168.10.108");
    expect(normalizeIp("  192.168.10.108  ")).toBe("192.168.10.108");
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1");
  });

  test("tolerates empty input", () => {
    expect(normalizeIp("")).toBe("");
  });
});

describe("matchesIp — single address", () => {
  test("matches an exact IPv4 address", () => {
    expect(matchesIp("192.168.10.108", "192.168.10.108")).toBe(true);
    expect(matchesIp("192.168.10.109", "192.168.10.108")).toBe(false);
  });

  test("matches through the IPv4-mapped form on both sides", () => {
    expect(matchesIp("::ffff:192.168.10.108", "192.168.10.108")).toBe(true);
    expect(matchesIp("192.168.10.108", "::ffff:192.168.10.108")).toBe(true);
  });

  test("does not treat a single address as a prefix", () => {
    // "192.168.1.2" must not match "192.168.1.20" — a substring bug here would
    // silently widen the allow-list.
    expect(matchesIp("192.168.1.20", "192.168.1.2")).toBe(false);
  });
});

describe("matchesIp — CIDR ranges", () => {
  test("the /24 rule that covers a dual-homed client at either address", () => {
    // The real case this feature exists for: DHCP moves the client between
    // .108 and .114, and one subnet rule covers both.
    expect(matchesIp("192.168.10.108", "192.168.10.0/24")).toBe(true);
    expect(matchesIp("192.168.10.114", "192.168.10.0/24")).toBe(true);
    expect(matchesIp("192.168.10.1", "192.168.10.0/24")).toBe(true);
    expect(matchesIp("192.168.10.255", "192.168.10.0/24")).toBe(true);
  });

  test("a /24 excludes neighbouring subnets", () => {
    expect(matchesIp("192.168.11.108", "192.168.10.0/24")).toBe(false);
    expect(matchesIp("192.168.9.108", "192.168.10.0/24")).toBe(false);
    expect(matchesIp("10.0.0.5", "192.168.10.0/24")).toBe(false);
  });

  test("respects non-octet-aligned prefix lengths", () => {
    // /25 splits the subnet in half: .0-.127 in, .128-.255 out.
    expect(matchesIp("192.168.10.127", "192.168.10.0/25")).toBe(true);
    expect(matchesIp("192.168.10.128", "192.168.10.0/25")).toBe(false);
    // /23 spans two /24s.
    expect(matchesIp("192.168.11.5", "192.168.10.0/23")).toBe(true);
    expect(matchesIp("192.168.12.5", "192.168.10.0/23")).toBe(false);
  });

  test("/32 behaves as a single host", () => {
    expect(matchesIp("192.168.10.108", "192.168.10.108/32")).toBe(true);
    expect(matchesIp("192.168.10.109", "192.168.10.108/32")).toBe(false);
  });

  test("/0 matches every address of that family — an admin foot-gun worth knowing", () => {
    expect(matchesIp("8.8.8.8", "0.0.0.0/0")).toBe(true);
    expect(matchesIp("192.168.10.108", "0.0.0.0/0")).toBe(true);
  });

  test("ignores host bits set in the range operand", () => {
    // An admin typing the device's own address with a prefix still gets the subnet.
    expect(matchesIp("192.168.10.5", "192.168.10.108/24")).toBe(true);
  });

  test("matches IPv6 CIDR including compressed forms", () => {
    expect(matchesIp("2001:db8::1", "2001:db8::/48")).toBe(true);
    expect(matchesIp("2001:db8:0:0:0:0:0:1", "2001:db8::/48")).toBe(true);
    expect(matchesIp("2001:db9::1", "2001:db8::/48")).toBe(false);
    expect(matchesIp("::1", "::1/128")).toBe(true);
  });
});

describe("matchesIp — fails closed", () => {
  test("rejects empty or missing operands", () => {
    expect(matchesIp("", "192.168.10.0/24")).toBe(false);
    expect(matchesIp("192.168.10.108", "")).toBe(false);
    expect(matchesIp("192.168.10.108", undefined as unknown as string)).toBe(false);
  });

  test("rejects malformed addresses rather than guessing", () => {
    expect(matchesIp("192.168.10.999", "192.168.10.0/24")).toBe(false);
    expect(matchesIp("not-an-ip", "192.168.10.0/24")).toBe(false);
    expect(matchesIp("192.168.10.108", "192.168.10.0/abc")).toBe(false);
    expect(matchesIp("192.168.10.108", "192.168.10.0/-1")).toBe(false);
  });

  test("rejects out-of-range prefix lengths", () => {
    expect(matchesIp("192.168.10.108", "192.168.10.0/33")).toBe(false);
    expect(matchesIp("2001:db8::1", "2001:db8::/129")).toBe(false);
  });

  test("rejects a cross-family comparison", () => {
    expect(matchesIp("192.168.10.108", "2001:db8::/48")).toBe(false);
    expect(matchesIp("2001:db8::1", "192.168.10.0/24")).toBe(false);
  });

  test("rejects an IPv6 address with more than one '::'", () => {
    expect(matchesIp("2001::db8::1", "2001:db8::/48")).toBe(false);
  });
});

describe("isValidIpOrCidr — admin input validation", () => {
  test("accepts what an admin is told to type", () => {
    // Both forms in the AccessControl placeholder text.
    expect(isValidIpOrCidr("192.168.1.20")).toBe(true);
    expect(isValidIpOrCidr("192.168.1.0/24")).toBe(true);
    expect(isValidIpOrCidr("2001:db8::/48")).toBe(true);
    expect(isValidIpOrCidr("::1")).toBe(true);
  });

  test("rejects entries that would silently never match", () => {
    // A malformed entry stored in the allow-list is worse than a rejected one:
    // the admin believes the device is registered and it is 403d forever.
    expect(isValidIpOrCidr("")).toBe(false);
    expect(isValidIpOrCidr("   ")).toBe(false);
    expect(isValidIpOrCidr("192.168.1")).toBe(false);
    expect(isValidIpOrCidr("192.168.1.256")).toBe(false);
    expect(isValidIpOrCidr("192.168.1.0/33")).toBe(false);
    expect(isValidIpOrCidr("2001:db8::/129")).toBe(false);
    expect(isValidIpOrCidr("line-1-scanner")).toBe(false);
  });

  test("KNOWN GAP CLOSED: a trailing slash is now rejected instead of meaning allow-all", () => {
    // Before 2026-08-30: `Number("")` is 0, `Number.isInteger(0)` passed, and
    // matchesIp short-circuited `bits === 0` to true — so one stray keystroke
    // turned a subnet rule into "permit every address of that family", with a
    // normal-looking row in the admin UI. Both sides now reject it.
    expect(isValidIpOrCidr("192.168.1.0/")).toBe(false);
    expect(matchesIp("8.8.8.8", "192.168.1.0/")).toBe(false);
    expect(isValidIpOrCidr("2001:db8::/")).toBe(false);
    expect(matchesIp("2001:db9::1", "2001:db8::/")).toBe(false);
    // Not even the address inside the intended subnet matches, so the failure is
    // loud (device blocked, admin investigates) rather than silent (allow-all).
    expect(matchesIp("192.168.1.5", "192.168.1.0/")).toBe(false);
  });

  test("KNOWN GAP CLOSED: trailing garbage after the prefix is rejected, not dropped", () => {
    // split("/") used to keep only the first two segments, so "…/24/8" and
    // "…/ 24" silently became /24 — narrower than allow-all, but still not what
    // the admin typed, and nothing told them so.
    expect(isValidIpOrCidr("192.168.1.0/24/8")).toBe(false);
    expect(matchesIp("192.168.1.5", "192.168.1.0/24/8")).toBe(false);
    expect(isValidIpOrCidr("192.168.1.0/ 24")).toBe(false);
    expect(isValidIpOrCidr("192.168.1.0/24abc")).toBe(false);
  });

  test("rejects every malformed prefix form individually", () => {
    // One assertion per rejected form named in the fix, so a regression points
    // at the exact form that came back.
    expect(isValidIpOrCidr("192.168.1.0/")).toBe(false); // trailing slash
    expect(isValidIpOrCidr("192.168.1.0//24")).toBe(false); // double slash
    expect(isValidIpOrCidr("192.168.1.0/2 4")).toBe(false); // whitespace inside
    expect(isValidIpOrCidr("192.168.1.0/ 24")).toBe(false); // leading space
    expect(isValidIpOrCidr("192.168.1.0/24 ")).toBe(false); // trailing space
    expect(isValidIpOrCidr("192.168.1.0/-1")).toBe(false); // negative
    expect(isValidIpOrCidr("192.168.1.0/+24")).toBe(false); // signed
    expect(isValidIpOrCidr("192.168.1.0/33")).toBe(false); // out of range v4
    expect(isValidIpOrCidr("2001:db8::/129")).toBe(false); // out of range v6
    expect(isValidIpOrCidr("192.168.1.0/abc")).toBe(false); // non-numeric
    expect(isValidIpOrCidr("192.168.1.0/24.5")).toBe(false); // non-integer
    expect(isValidIpOrCidr("192.168.1.0/0x18")).toBe(false); // hex
    expect(isValidIpOrCidr("192.168.1.0/024")).toBe(false); // leading zero
    expect(isValidIpOrCidr("/24")).toBe(false); // no address
    expect(isValidIpOrCidr("192.168.1.0/1e1")).toBe(false); // exponent notation
  });

  test("rejects surrounding whitespace rather than quietly trimming it", () => {
    // A value with stray whitespace is a typo the admin should see, and the
    // stored string must be exactly what matchesIp will later compare.
    expect(isValidIpOrCidr(" 192.168.1.0/24")).toBe(false);
    expect(isValidIpOrCidr("192.168.1.0/24\n")).toBe(false);
    expect(isValidIpOrCidr("192.168.1.20 ")).toBe(false);
  });

  test("a deliberate /0 is still accepted — this fix removes the accident, not the capability", () => {
    // An admin who types 0.0.0.0/0 on purpose has chosen allow-all and is
    // allowed to; what must not happen is arriving there via a stray keystroke.
    expect(isValidIpOrCidr("0.0.0.0/0")).toBe(true);
    expect(isValidIpOrCidr("::/0")).toBe(true);
    expect(matchesIp("8.8.8.8", "0.0.0.0/0")).toBe(true);
    expect(matchesIp("2001:db8::1", "::/0")).toBe(true);
    // Contrast with the accidental path, which is now rejected outright.
    expect(isValidIpOrCidr("0.0.0.0/")).toBe(false);
  });

  test("accepts every entry matchesIp can resolve, for the cases we care about", () => {
    // Guards against the two drifting apart: anything stored must be matchable.
    for (const entry of ["192.168.10.0/24", "192.168.10.108", "10.0.0.0/8", "::1/128"]) {
      expect(isValidIpOrCidr(entry)).toBe(true);
    }
  });
});

describe("isLoopback", () => {
  test("recognises the host administering itself", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("127.0.0.53")).toBe(true);
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
  });

  test("does not treat LAN addresses as loopback", () => {
    expect(isLoopback("192.168.10.108")).toBe(false);
    expect(isLoopback("10.0.0.1")).toBe(false);
    expect(isLoopback("")).toBe(false);
  });
});
