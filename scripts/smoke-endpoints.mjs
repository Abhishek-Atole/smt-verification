#!/usr/bin/env node
// Endpoint smoke: walk every route in artifacts/api-server/src/routes/*.ts and
// hit it, failing on any 5xx. Dependency-free (node fetch). Paced by default so
// the api limiter (200/min/IP) isn't tripped by the ~210 requests.
//
//   SMOKE_BASE_URL   default http://localhost:3000
//   SMOKE_USER/PASSWORD  optional — adds the authenticated GET pass
//   SMOKE_PACE_MS    default 400
// Mutations are sent with an EMPTY body on purpose: handlers must reject with
// 4xx (validation/auth) before writing anything, so this never mutates data.
//
//   node scripts/smoke-endpoints.mjs

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const PACE = Number(process.env.SMOKE_PACE_MS ?? 400);
const DUMMY = "00000000-0000-0000-0000-000000000000";
const H = { "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function routes() {
  const dir = join(ROOT, "artifacts/api-server/src/routes");
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".ts") || f.includes("__tests__")) continue;
    const prefix = f === "admin.ts" ? "/api/admin" : "/api";
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(/router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
      let path = prefix + m[2];
      path = path.replace(/:(sessionId|id|bomId|userId|reportId)/g, "65").replace(/:[A-Za-z_]+/g, DUMMY);
      out.push([m[1].toUpperCase(), path]);
    }
  }
  return [...new Map(out.map((r) => [r.join(" "), r])).values()];
}

async function run() {
  const list = routes();
  const results = [];
  const hit = async (method, path, cookie) => {
    await sleep(PACE);
    try {
      const res = await fetch(BASE + path, {
        method, headers: cookie ? { ...H, Cookie: cookie } : H,
        body: method === "GET" ? undefined : "{}",
      });
      results.push([method, path, res.status]);
    } catch (e) {
      results.push([method, path, `ERR ${e.message}`]);
    }
  };

  for (const [method, path] of list) {
    if (path === "/api/auth/login") continue; // don't spend the login bucket
    await hit(method, path);
  }

  if (process.env.SMOKE_USER) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST", headers: H,
      body: JSON.stringify({ username: process.env.SMOKE_USER, password: process.env.SMOKE_PASSWORD, role: process.env.SMOKE_ROLE ?? "operator" }),
    });
    if (res.status !== 200) {
      console.log(`AUTH_SKIPPED login=${res.status}`);
    } else {
      const cookie = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("smt_token="))?.split(";")[0];
      for (const [method, path] of list) if (method === "GET") await hit(method, path, cookie);
    }
  }

  const byStatus = results.reduce((a, [, , s]) => ((a[s] = (a[s] ?? 0) + 1), a), {});
  console.log(`routes=${list.length} requests=${results.length}`);
  console.log("statuses:", JSON.stringify(byStatus));
  const five = results.filter(([, , s]) => typeof s === "number" && s >= 500);
  if (five.length) {
    console.log("5XX:", JSON.stringify(five, null, 1));
    process.exit(1);
  }
  console.log("SMOKE_OK (no 5xx)");
}

run();
