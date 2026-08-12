import fs from "node:fs";
import path from "node:path";
import { TESTING_REPORTS_DIR, TESTING_RESULTS_DIR } from "./_helpers";

type Check = {
  category: string;
  item: string;
  status: "PASS" | "FAIL" | "SKIP" | "WARN";
  detail: string;
  latency?: number;
};

const checks: Check[] = [];

function addCheck(category: string, item: string, status: Check["status"], detail: string, latency?: number): void {
  checks.push({ category, item, status, detail, latency });
  const icon = { PASS: "OK", FAIL: "FAIL", SKIP: "SKIP", WARN: "WARN" }[status];
  const latencyText = latency ? ` [${latency}ms]` : "";
  console.log(`${icon}${latencyText} [${category}] ${item}: ${detail}`);
}

function readMaybeJson(filePath: string): unknown | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const resultFiles = [
    [path.join(TESTING_RESULTS_DIR, "auth-role-test.json"), "Auth & Role Test"],
    [path.join(TESTING_RESULTS_DIR, "latency-results.json"), "Latency Test"],
    [path.join(TESTING_RESULTS_DIR, "k6-concurrent-scans.json"), "Concurrent Scan Test"],
    [path.join(TESTING_RESULTS_DIR, "db-performance.txt"), "DB Performance Test"],
  ] as const;

  for (const [filePath, label] of resultFiles) {
    const exists = fs.existsSync(filePath);
    addCheck("RESULTS", label, exists ? "PASS" : "SKIP", exists ? "result file exists" : "run the associated test first");
  }

  const auth = readMaybeJson(path.join(TESTING_RESULTS_DIR, "auth-role-test.json")) as { summary?: { passed?: number; failed?: number; avgLatency?: number } } | null;
  const latency = readMaybeJson(path.join(TESTING_RESULTS_DIR, "latency-results.json")) as { results?: Array<{ passed?: boolean }> } | null;
  const k6 = readMaybeJson(path.join(TESTING_RESULTS_DIR, "k6-concurrent-scans.json")) as { metrics?: Record<string, { values?: Record<string, number> }> } | null;

  if (auth?.summary) {
    addCheck("AUTH", "Auth test summary", auth.summary.failed === 0 ? "PASS" : "FAIL", `${auth.summary.passed ?? 0} passed, ${auth.summary.failed ?? 0} failed`, auth.summary.avgLatency);
  }

  if (latency?.results?.length) {
    const allPass = latency.results.every((result) => result.passed !== false);
    addCheck("LATENCY", "Latency thresholds", allPass ? "PASS" : "FAIL", allPass ? "p95 under threshold" : "one or more endpoints exceeded threshold");
  }

  if (k6?.metrics?.scan_error?.values) {
    const unexpectedErrors = k6.metrics.scan_error.values.count ?? 0;
    addCheck("K6", "Concurrent scan errors", unexpectedErrors === 0 ? "PASS" : "FAIL", `unexpected errors: ${unexpectedErrors}`);
  }

  const passed = checks.filter((check) => check.status === "PASS").length;
  const failed = checks.filter((check) => check.status === "FAIL").length;
  const skipped = checks.filter((check) => check.status === "SKIP").length;
  const warned = checks.filter((check) => check.status === "WARN").length;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>SMT Testing Report</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: #0b1020; color: #e2e8f0; padding: 24px; }
    h1 { color: #60a5fa; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 10px; padding: 14px; }
    .num { font-size: 28px; font-weight: 700; }
    .pass { color: #22c55e; } .fail { color: #ef4444; } .warn { color: #f59e0b; } .skip { color: #94a3b8; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; }
    th, td { border-bottom: 1px solid #1f2937; padding: 10px; text-align: left; }
    th { color: #94a3b8; font-size: 12px; text-transform: uppercase; }
  </style>
</head>
<body>
  <h1>SMT Feeder Verification Test Report</h1>
  <p>Generated: ${new Date().toLocaleString()}</p>
  <div class="summary">
    <div class="card"><div class="num pass">${passed}</div><div>Passed</div></div>
    <div class="card"><div class="num fail">${failed}</div><div>Failed</div></div>
    <div class="card"><div class="num warn">${warned}</div><div>Warnings</div></div>
    <div class="card"><div class="num skip">${skipped}</div><div>Skipped</div></div>
  </div>
  <table>
    <thead><tr><th>Category</th><th>Check</th><th>Status</th><th>Detail</th><th>Latency</th></tr></thead>
    <tbody>
      ${checks
        .map(
          (check) => `<tr>
            <td>${check.category}</td>
            <td>${check.item}</td>
            <td>${check.status}</td>
            <td>${check.detail}</td>
            <td>${check.latency ?? "—"}</td>
          </tr>`,
        )
        .join("")}
    </tbody>
  </table>
</body>
</html>`;

  fs.mkdirSync(TESTING_REPORTS_DIR, { recursive: true });
  fs.mkdirSync(TESTING_RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(TESTING_REPORTS_DIR, "system-test-report.html"), html);
  fs.writeFileSync(path.join(TESTING_RESULTS_DIR, "checklist.json"), JSON.stringify({ timestamp: new Date().toISOString(), checks, summary: { passed, failed, skipped, warned } }, null, 2));

  console.log(`Report written to ${path.join(TESTING_REPORTS_DIR, "system-test-report.html")}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});