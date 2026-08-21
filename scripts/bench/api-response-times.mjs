#!/usr/bin/env node
// API response-time benchmark for the SMT Verification api-server.
//
// Measures per-endpoint latency (min / median / avg / p95 / max) over N samples
// against a RUNNING server (default http://localhost:3000). Scope: safe,
// idempotent GET endpoints only — no mutating verbs, so it never corrupts data.
//
// Auth: logs in as the seeded QA test account, clears the forced
// must_change_password flag via the real /auth/change-password flow to obtain an
// unblocked token, benchmarks, then RESTORES the original password. QA role
// satisfies requireRole(...) on nearly every read route (admin-only routes are
// skipped). Cookies (smt_token / smt_refresh) are tracked manually.
//
// Usage:
//   node scripts/bench/api-response-times.mjs [--base URL] [--samples N] [--warmup W]
//   env: BENCH_USER, BENCH_PASS, BENCH_ROLE  (default qa1 / qa123 / qa)

const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};

const BASE = (getArg("--base", process.env.BENCH_BASE || "http://localhost:3000")).replace(/\/$/, "");
const SAMPLES = Number(getArg("--samples", "12"));
const WARMUP = Number(getArg("--warmup", "2"));
const USER = process.env.BENCH_USER || "qa1";
const PASS = process.env.BENCH_PASS || "qa123";
const ROLE = process.env.BENCH_ROLE || "qa";
const XHR = { "X-Requested-With": "XMLHttpRequest" };

// The server applies apiLimiter = 200 requests / 60s / IP on /api/*. A naive
// burst trips it and every excess request 429s, so we pace ourselves under the
// cap with a sliding-window governor: never send more than MAX_PER_WINDOW in
// any WINDOW_MS; when the budget is spent, sleep until the oldest send ages out.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 185; // headroom under 200
const sendTimes = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function governor() {
  const now = Date.now();
  while (sendTimes.length && now - sendTimes[0] > WINDOW_MS) sendTimes.shift();
  if (sendTimes.length >= MAX_PER_WINDOW) {
    const waitMs = WINDOW_MS - (now - sendTimes[0]) + 20;
    await sleep(waitMs);
    return governor();
  }
  sendTimes.push(Date.now());
}

// --- tiny cookie jar (name -> value) -------------------------------------
const jar = new Map();
function absorb(res) {
  // Node fetch exposes combined Set-Cookie via getSetCookie() (undici).
  const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const c of cookies) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

async function req(method, path, body) {
  const headers = { ...XHR, Cookie: cookieHeader() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  absorb(res);
  return res;
}

// --- auth: login + unblock -------------------------------------------------
async function login(pass) {
  await governor();
  const res = await req("POST", "/api/auth/login", { username: USER, password: pass, role: ROLE });
  const json = await res.json().catch(() => ({}));
  if (res.status !== 200) throw new Error(`login failed HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json; // { mustChangePassword, ... }
}

// --- percentile helpers ----------------------------------------------------
const pct = (sorted, p) => {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
};

async function timeOnce(path) {
  await governor(); // wait for rate budget BEFORE timing so the pause isn't counted
  const t0 = performance.now();
  const res = await req("GET", path);
  // Drain body so time reflects full response, not just headers.
  await res.arrayBuffer().catch(() => {});
  const ms = performance.now() - t0;
  return { ms, status: res.status };
}

async function benchmark(path) {
  for (let i = 0; i < WARMUP; i++) await timeOnce(path);
  const times = [];
  let status = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const r = await timeOnce(path);
    times.push(r.ms);
    status = r.status;
  }
  times.sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  return {
    path,
    status,
    min: times[0],
    median: pct(times, 50),
    avg: sum / times.length,
    p95: pct(times, 95),
    max: times[times.length - 1],
  };
}

// Discover a real id for :param routes; returns first item's field or null.
async function firstId(path, field = "id") {
  try {
    await governor();
    const res = await req("GET", path);
    if (res.status !== 200) return null;
    const j = await res.json();
    const arr = Array.isArray(j) ? j : j.data || j.items || j.rows || j.sessions || j.boms || [];
    return arr.length ? (arr[0][field] ?? null) : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`# API response-time benchmark`);
  console.log(`base=${BASE} samples=${SAMPLES} warmup=${WARMUP} user=${USER} role=${ROLE}\n`);

  // 1) Authenticate. The account must already be unblocked (must_change_password
  // = false); we do NOT rotate credentials here. A 423 on the first real call
  // means the user still owes a forced password change — fix that out of band.
  const first = await login(PASS);
  console.log(`logged in as ${USER} (role=${first.role}, mustChangePassword=${first.mustChangePassword})\n`);

  try {
    // 2) Discover ids to fill path params.
    const bomId = await firstId("/api/bom");
    const sessionId = await firstId("/api/sessions");
    console.log(`discovered bomId=${bomId ?? "-"} sessionId=${sessionId ?? "-"}\n`);

    // 3) Endpoint list — safe GETs. :param routes only added when an id was found.
    const endpoints = [
      "/api/health",
      "/api/timestamp",
      "/api/auth/me",
      "/api/users",
      "/api/bom",
      "/api/components",
      "/api/feeders",
      "/api/sessions",
      "/api/sessions/latest",
      "/api/sessions/active",
      "/api/sessions/deleted",
      "/api/sessions/trash/all",
      "/api/verification/sessions",
      "/api/verification/sessions/mine",
      "/api/verification/sessions/active",
      "/api/analytics/overview",
      "/api/analytics/trends",
      "/api/analytics/pareto",
      "/api/dashboard/kpi",
      "/api/dashboard/verification",
      "/api/dashboard/alarms",
      "/api/dashboard/operator",
      "/api/dashboard/time-analysis",
      "/api/dashboard/feeder-analysis",
      "/api/dashboard/component-analysis",
      "/api/dashboard/efficiency",
      "/api/dashboard/splice-stats",
      "/api/reports/fpy?dateFilter=last30",
      "/api/reports/oee?dateFilter=last30",
      "/api/reports/operator?dateFilter=last30",
      "/api/reports/operator-comparison?dateFilter=last30",
      "/api/reports/feeder?dateFilter=last30",
      "/api/reports/feeder-reliability?dateFilter=last30",
      "/api/reports/alarm?dateFilter=last30",
      "/api/reports/error-analysis?dateFilter=last30",
      "/api/reports/component?dateFilter=last30",
      "/api/reports/lot-traceability?dateFilter=last30",
      "/api/reports/trend?dateFilter=last30",
      "/api/reports/exports/history",
      "/api/traceability/alternate-usage",
      "/api/trash/items",
      "/api/trash/stats",
      "/api/notifications",
    ];
    if (bomId) {
      endpoints.push(
        `/api/bom/${bomId}`,
        `/api/boms/${bomId}`,
        `/api/boms/${bomId}/revisions`,
        `/api/bom-items?bom_id=${bomId}`,
      );
    }
    if (sessionId) {
      endpoints.push(
        `/api/sessions/${sessionId}`,
        `/api/sessions/${sessionId}/scans`,
        `/api/sessions/${sessionId}/summary`,
        `/api/sessions/${sessionId}/splices`,
      );
    }

    // 4) Run.
    const results = [];
    for (const ep of endpoints) results.push(await benchmark(ep));

    // 5) Report — sorted slowest-avg first.
    results.sort((a, b) => b.avg - a.avg);
    const f = (n) => (Number.isNaN(n) ? "  -  " : n.toFixed(1).padStart(7));
    console.log("status |    min |    med |    avg |    p95 |    max | endpoint");
    console.log("-------+--------+--------+--------+--------+--------+---------------------------------");
    for (const r of results) {
      const flag = r.status >= 200 && r.status < 300 ? " " : "!";
      console.log(
        `${flag}${String(r.status).padStart(4)} |${f(r.min)} |${f(r.median)} |${f(r.avg)} |${f(r.p95)} |${f(r.max)} | ${r.path}`,
      );
    }
    const ok = results.filter((r) => r.status >= 200 && r.status < 300);
    const bad = results.filter((r) => !(r.status >= 200 && r.status < 300));
    const overall = ok.map((r) => r.avg).sort((a, b) => a - b);
    console.log(
      `\nsummary: ${results.length} endpoints | ${ok.length} 2xx | ${bad.length} non-2xx | ` +
        `median-of-avg=${f(pct(overall, 50)).trim()}ms p95-of-avg=${f(pct(overall, 95)).trim()}ms`,
    );
    if (bad.length) console.log(`non-2xx: ${bad.map((r) => `${r.status} ${r.path}`).join(", ")}`);

    // 6) Machine-readable dump.
    const fs = await import("node:fs");
    const out = `scripts/bench/last-run.json`;
    fs.writeFileSync(out, JSON.stringify({ base: BASE, samples: SAMPLES, at: new Date().toISOString(), results }, null, 2));
    console.log(`\nwrote ${out}`);
  } catch (e) {
    console.error("benchmark error:", e.message);
    throw e;
  }
}

main().catch((e) => {
  console.error("benchmark failed:", e.message);
  process.exit(1);
});
