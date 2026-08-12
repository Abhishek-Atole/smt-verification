import { PrismaClient } from "@prisma/client";
import { loginWithEmployeeId, percentile, requestJson, TESTING_RESULTS_DIR, writeJson } from "./_helpers";
import path from "node:path";

const prisma = new PrismaClient({ log: ["warn", "error"] });

type LatencySample = {
  endpoint: string;
  p50: number;
  p95: number;
  p99: number;
  average: number;
  rps: number;
  errors: number;
  passed: boolean;
};

async function sample(pathname: string, cookie: string, iterations = 40, concurrency = 10): Promise<LatencySample> {
  const durations: number[] = [];
  let errors = 0;
  let completed = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (completed < iterations) {
      const current = completed;
      completed += 1;

      if (current >= iterations) {
        break;
      }

      const response = await requestJson(pathname, { method: "GET" }, cookie);
      durations.push(response.latencyMs);
      if (response.status >= 500) {
        errors += 1;
      }
    }
  });

  const startedAt = Date.now();
  await Promise.all(workers);
  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
  const average = Math.round(durations.reduce((sum, value) => sum + value, 0) / Math.max(durations.length, 1));

  return {
    endpoint: pathname,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    average,
    rps: Math.round(durations.length / elapsedSeconds),
    errors,
    passed: percentile(durations, 95) < 200,
  };
}

async function main(): Promise<void> {
  const { cookie } = await loginWithEmployeeId("OP001");

  const firstChangeover = await prisma.changeover.findFirst({ select: { id: true }, orderBy: { startedAt: "desc" } });
  if (!firstChangeover) {
    throw new Error("No changeovers found. Run the seed and auth tests first.");
  }

  const endpoints = [
    "/api/changeovers",
    `/api/changeovers/${firstChangeover.id}/progress`,
    `/api/changeovers/${firstChangeover.id}/scans`,
  ];

  const results: LatencySample[] = [];
  for (const endpoint of endpoints) {
    results.push(await sample(endpoint, cookie));
  }

  writeJson(path.join(TESTING_RESULTS_DIR, "latency-results.json"), {
    timestamp: new Date().toISOString(),
    thresholds: { p50: 50, p95: 200, p99: 500 },
    results,
  });

  console.log("Latency test results");
  for (const result of results) {
    console.log(
      `${result.endpoint} -> p50=${result.p50}ms p95=${result.p95}ms p99=${result.p99}ms avg=${result.average}ms rps=${result.rps} errors=${result.errors}`,
    );
  }

  if (results.some((result) => !result.passed)) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });