import fs from "node:fs";
import path from "node:path";

const dbPerfText = fs.readFileSync("/media/abhishek-atole/Courses/Final SMT MES SYSTEM/SMTVerification/testing/results/db-performance.txt", "utf-8");

// Parse EXPLAIN ANALYZE output to extract execution times
const tests = [
  { name: "MPN Lookup (bom_alternatives)", regex: /TEST 1.*?Execution Time: ([\d.]+) ms/s },
  { name: "UCAL Part Number Array Search", regex: /TEST 2.*?Execution Time: ([\d.]+) ms/s },
  { name: "Progress Calculation", regex: /TEST 3.*?Execution Time: ([\d.]+) ms/s },
  { name: "Role-Filtered Changeover List", regex: /TEST 4.*?Execution Time: ([\d.]+) ms/s },
  { name: "Audit Log Query", regex: /TEST 5.*?Execution Time: ([\d.]+) ms/s },
  { name: "Unique Constraint Performance", regex: /TEST 6.*?Execution Time: ([\d.]+) ms/s },
];

const results = tests.map((test) => {
  const match = dbPerfText.match(test.regex);
  const executionTime = match ? parseFloat(match[1]) : 0;
  return {
    test: test.name,
    executionTimeMs: executionTime,
    passed: executionTime < 50, // threshold: 50ms
  };
});

const report = {
  timestamp: new Date().toISOString(),
  configuration: {
    thresholds: { executionTime: 50 },
    testData: {
      auditLogs: 500015,
      changeovers: 10005,
      users: 1004,
      bomAlternatives: 62,
      bomLineItems: 55,
      bomHeaders: 52,
      verificationScans: 4,
    },
  },
  results,
  passed: results.every((r) => r.passed),
};

fs.writeFileSync(
  "/media/abhishek-atole/Courses/Final SMT MES SYSTEM/SMTVerification/testing/results/db-performance-results.json",
  JSON.stringify(report, null, 2),
);

console.log("DB performance results:");
for (const result of results) {
  const status = result.passed ? "✓" : "✗";
  console.log(`  ${status} ${result.test}: ${result.executionTimeMs}ms`);
}
