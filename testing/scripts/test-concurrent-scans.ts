import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { loginWithEmployeeId, requestJson, TESTING_RESULTS_DIR, writeJson } from "./_helpers";
import path from "node:path";

const prisma = new PrismaClient({ log: ["warn", "error"] });

async function runConcurrentScans(): Promise<void> {
  const { cookie } = await loginWithEmployeeId("OP001");

  // Get a fresh changeover
  const changeover = await prisma.changeover.findFirst({
    select: { id: true },
    orderBy: { startedAt: "desc" },
  });

  if (!changeover) {
    throw new Error("No changeovers found. Run seed first.");
  }

  const changeoverId = changeover.id;
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

  interface ScanMetric {
    status: number;
    latency: number;
  }

  const results: ScanMetric[] = [];
  const errors: string[] = [];
  let successful = 0;
  let duplicates = 0;
  let noMatches = 0;

  // Stage 1: Ramp up to 50 concurrent (10 iterations per concurrent worker)
  console.log("Stage 1: Ramping up to 50 concurrent users...");
  const concurrency = 50;
  const iterationsPerWorker = 10;

  const workers = Array.from({ length: concurrency }, async (_, workerIdx) => {
    for (let i = 0; i < iterationsPerWorker; i++) {
      try {
        const mpn = VALID_MPNS[Math.floor(Math.random() * VALID_MPNS.length)];
        const idempotencyKey = randomUUID();

        const response = await requestJson(
          `/api/changeovers/${changeoverId}/scans`,
          {
            method: "POST",
            body: JSON.stringify({ scannedValue: mpn, idempotencyKey }),
          },
          cookie,
        );

        results.push({ status: response.status, latency: response.latencyMs });

        if (response.status === 201) {
          successful += 1;
        } else if (response.status === 409) {
          duplicates += 1;
        } else if (response.status === 422) {
          noMatches += 1;
        } else if (response.status >= 500) {
          errors.push(`Worker ${workerIdx}: Got ${response.status}`);
        }
      } catch (err) {
        errors.push(`Worker ${workerIdx}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  await Promise.all(workers);

  // Calculate percentiles
  const sortedLatencies = results.map((r) => r.latency).sort((a, b) => a - b);
  const p50 = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)];
  const p95 = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)];
  const p99 = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)];
  const avg = Math.round(sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length);

  const totalTime = Math.max(
    ...results.map((r) => r.latency),
    1,
  );
  const rps = Math.round((results.length / totalTime) * 1000);

  const report = {
    timestamp: new Date().toISOString(),
    configuration: {
      maxConcurrency: concurrency,
      iterationsPerWorker,
      totalScans: results.length,
    },
    results: {
      successful,
      duplicates,
      noMatches,
      errors: errors.length,
      totalRequests: results.length,
      rps,
      latency: {
        p50,
        p95,
        p99,
        avg,
      },
      passed: p95 < 500 && errors.length === 0,
    },
    errorDetails: errors.slice(0, 10),
  };

  writeJson(path.join(TESTING_RESULTS_DIR, "concurrent-scans-results.json"), report);

  console.log("Concurrent scan test results");
  console.log(`  Total scans: ${results.length}`);
  console.log(`  Successful: ${successful}`);
  console.log(`  Duplicates (409): ${duplicates}`);
  console.log(`  No match (422): ${noMatches}`);
  console.log(`  Errors: ${errors.length}`);
  console.log(`  RPS: ${rps}`);
  console.log(`  Latency: p50=${p50}ms p95=${p95}ms p99=${p99}ms avg=${avg}ms`);

  if (!report.results.passed) {
    process.exitCode = 1;
  }
}

runConcurrentScans()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
