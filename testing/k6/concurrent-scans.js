import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const scanSuccess = new Counter("scan_success");
const scanDuplicate = new Counter("scan_duplicate_409");
const scanNoMatch = new Counter("scan_no_match_422");
const scanError = new Counter("scan_error");
const scanLatency = new Trend("scan_latency_ms", true);

const BASE = __ENV.BASE_URL ?? "http://localhost:3000";
const CHANGEOVER_ID = __ENV.CHANGEOVER_ID;
const SESSION_COOKIE = __ENV.SESSION_COOKIE;

if (!CHANGEOVER_ID || !SESSION_COOKIE) {
  throw new Error("Set CHANGEOVER_ID and SESSION_COOKIE env vars");
}

const VALID_MPNS = [
  "C0603C472K5RACAUTO",
  "CC0603KRX7R9BB472",
  "ERJ-3EKF1002V",
  "RC0603FR-0710KL",
  "LTST-C170GKT",
  "APT2012SGC",
  "STM32G031K8T6",
  "LPC1114FBD48/102",
  "LM1117MPX-5.0/NOPB",
  "NCP1117ST50T3G",
  "AP1117E50G-13",
  "RDSCAP0353",
  "RDSRES0101",
];

export const options = {
  stages: [
    { duration: "10s", target: 10 },
    { duration: "30s", target: 50 },
    { duration: "10s", target: 100 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    scan_latency_ms: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
    scan_error: ["count<5"],
  },
};

export default function () {
  const mpn = VALID_MPNS[Math.floor(Math.random() * VALID_MPNS.length)];
  const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const startedAt = Date.now();

  const response = http.post(
    `${BASE}/api/changeovers/${CHANGEOVER_ID}/scans`,
    JSON.stringify({ scannedValue: mpn, idempotencyKey }),
    {
      headers: {
        "Content-Type": "application/json",
        Cookie: SESSION_COOKIE,
      },
      timeout: "5s",
    },
  );

  scanLatency.add(Date.now() - startedAt);

  if (response.status === 201) {
    scanSuccess.add(1);
    check(response, {
      "scan returns feeder": (r) => JSON.parse(r.body).match?.feederNumber !== undefined,
      "scan returns progress": (r) => JSON.parse(r.body).progress?.percentage !== undefined,
    });
  } else if (response.status === 409) {
    scanDuplicate.add(1);
    check(response, {
      "duplicate returns DUPLICATE": (r) => JSON.parse(r.body).error === "DUPLICATE",
    });
  } else if (response.status === 422) {
    scanNoMatch.add(1);
    check(response, {
      "no-match returns NO_MATCH": (r) => JSON.parse(r.body).error === "NO_MATCH",
    });
  } else {
    scanError.add(1);
    console.error(`Unexpected status ${response.status}: ${response.body}`);
  }

  sleep(0.1);
}

export function handleSummary(data) {
  return {
    "testing/results/k6-concurrent-scans.json": JSON.stringify(data, null, 2),
    stdout: `
Concurrent scan test results
Successful scans  : ${data.metrics.scan_success?.values?.count ?? 0}
Duplicate (409)   : ${data.metrics.scan_duplicate_409?.values?.count ?? 0}
No-match (422)    : ${data.metrics.scan_no_match_422?.values?.count ?? 0}
Unexpected errors : ${data.metrics.scan_error?.values?.count ?? 0}
P50 latency       : ${data.metrics.scan_latency_ms?.values?.["p(50)"]?.toFixed(0) ?? "?"}ms
P95 latency       : ${data.metrics.scan_latency_ms?.values?.["p(95)"]?.toFixed(0) ?? "?"}ms
P99 latency       : ${data.metrics.scan_latency_ms?.values?.["p(99)"]?.toFixed(0) ?? "?"}ms
`,
  };
}