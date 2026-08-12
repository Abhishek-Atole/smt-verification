import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
export const TESTING_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const TESTING_RESULTS_DIR = path.join(TESTING_ROOT, "results");
export const TESTING_REPORTS_DIR = path.join(TESTING_ROOT, "reports");
export const TESTING_SEEDS_DIR = path.join(TESTING_ROOT, "seeds");
export const TESTING_SCRIPTS_DIR = path.join(TESTING_ROOT, "scripts");
export const TESTING_K6_DIR = path.join(TESTING_ROOT, "k6");

export function buildUrl(pathname: string): string {
  return new URL(pathname, BASE_URL).toString();
}

export function ensureDirForFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function writeJson(filePath: string, value: unknown): void {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

export function readCookieHeader(headers: Headers): string {
  const responseHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const cookies = typeof responseHeaders.getSetCookie === "function" ? responseHeaders.getSetCookie() : [];

  if (cookies.length > 0) {
    return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
  }

  const rawCookie = headers.get("set-cookie");
  if (!rawCookie) return "";

  return rawCookie
    .split(/,(?=[^;]+=[^;]+)/g)
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

export function joinCookies(...cookies: Array<string | undefined>): string {
  const parts = cookies
    .filter((cookie): cookie is string => Boolean(cookie))
    .flatMap((cookie) => cookie.split(/;\s*/g))
    .filter(Boolean);

  const seen = new Set<string>();
  const merged: string[] = [];

  for (const part of parts) {
    const name = part.split("=")[0];
    if (!seen.has(name)) {
      seen.add(name);
      merged.push(part);
    }
  }

  return merged.join("; ");
}

export async function loginWithEmployeeId(employeeId: string): Promise<{ cookie: string; status: number }> {
  const csrfResponse = await fetch(buildUrl("/api/auth/csrf"), {
    headers: { accept: "application/json" },
  });

  if (!csrfResponse.ok) {
    throw new Error(`Failed to fetch CSRF token: ${csrfResponse.status}`);
  }

  const csrfJson = (await csrfResponse.json()) as { csrfToken?: string };
  if (!csrfJson.csrfToken) {
    throw new Error("CSRF token missing from /api/auth/csrf response");
  }

  const csrfCookie = readCookieHeader(csrfResponse.headers);
  const loginBody = new URLSearchParams({
    csrfToken: csrfJson.csrfToken,
    callbackUrl: BASE_URL,
    json: "true",
    employeeId,
  });

  const loginResponse = await fetch(buildUrl("/api/auth/callback/credentials"), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: csrfCookie,
      accept: "application/json",
    },
    body: loginBody,
    redirect: "manual",
  });

  const sessionCookie = joinCookies(csrfCookie, readCookieHeader(loginResponse.headers));
  if (!sessionCookie) {
    throw new Error(`Login succeeded but no session cookie was returned for ${employeeId}`);
  }

  return { cookie: sessionCookie, status: loginResponse.status };
}

export async function requestJson(
  pathname: string,
  init: RequestInit = {},
  cookie?: string,
): Promise<{ status: number; latencyMs: number; data: unknown; text: string }> {
  const startedAt = Date.now();
  const response = await fetch(buildUrl(pathname), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers ?? {}),
    },
  });

  const latencyMs = Date.now() - startedAt;
  const text = await response.text();
  let data: unknown = text;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { status: response.status, latencyMs, data, text };
}

export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}