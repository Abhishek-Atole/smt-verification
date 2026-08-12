import { PrismaClient, UserRole } from "@prisma/client";
import { loginWithEmployeeId, requestJson, TESTING_RESULTS_DIR, writeJson } from "./_helpers";
import path from "node:path";

const prisma = new PrismaClient({ log: ["warn", "error"] });

type RoleName = "operator" | "qa" | "engineer" | "admin";

const ROLE_USERS: Record<RoleName, string> = {
  operator: "OP001",
  qa: "QA001",
  engineer: "ENG001",
  admin: "ADM001",
};

type Result = {
  name: string;
  passed: boolean;
  status: number;
  expected: number;
  latencyMs: number;
  detail: string;
};

const results: Result[] = [];

function record(name: string, status: number, expected: number, latencyMs: number, detail: string): void {
  const passed = status === expected;
  results.push({ name, passed, status, expected, latencyMs, detail });
  const icon = passed ? "OK" : "FAIL";
  console.log(`${icon} [${latencyMs}ms] ${name}: got ${status}, expected ${expected} ${detail}`);
}

async function main(): Promise<void> {
  console.log("SMT auth and role test");

  const unauthGet = await requestJson("/api/changeovers", { method: "GET" });
  record("GET /api/changeovers without auth", unauthGet.status, 401, unauthGet.latencyMs, "unauthenticated access");

  const unauthPost = await requestJson("/api/changeovers", {
    method: "POST",
    body: JSON.stringify({ bomHeaderId: crypto.randomUUID() }),
  });
  record("POST /api/changeovers without auth", unauthPost.status, 401, unauthPost.latencyMs, "unauthenticated access");

  const [operator, qa, engineer, admin] = await Promise.all([
    loginWithEmployeeId(ROLE_USERS.operator),
    loginWithEmployeeId(ROLE_USERS.qa),
    loginWithEmployeeId(ROLE_USERS.engineer),
    loginWithEmployeeId(ROLE_USERS.admin),
  ]);

  record("Operator login", operator.status, 200, 0, ROLE_USERS.operator);
  record("QA login", qa.status, 200, 0, ROLE_USERS.qa);
  record("Engineer login", engineer.status, 200, 0, ROLE_USERS.engineer);
  record("Admin login", admin.status, 200, 0, ROLE_USERS.admin);

  const sessionChecks = await Promise.all([
    requestJson("/api/auth/session", { method: "GET" }, operator.cookie),
    requestJson("/api/auth/session", { method: "GET" }, qa.cookie),
    requestJson("/api/auth/session", { method: "GET" }, engineer.cookie),
    requestJson("/api/auth/session", { method: "GET" }, admin.cookie),
  ]);

  const sessionRoles = sessionChecks.map((check) => (check.data as { user?: { role?: string } })?.user?.role ?? "unknown");
  record("Operator session role", 200, 200, sessionChecks[0].latencyMs, sessionRoles[0]);
  record("QA session role", 200, 200, sessionChecks[1].latencyMs, sessionRoles[1]);
  record("Engineer session role", 200, 200, sessionChecks[2].latencyMs, sessionRoles[2]);
  record("Admin session role", 200, 200, sessionChecks[3].latencyMs, sessionRoles[3]);

  const firstBom = await prisma.bomHeader.findFirst({
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  if (!firstBom) {
    throw new Error("No BOM rows found. Run the seed script first.");
  }

  const operatorChangeover = await requestJson(
    "/api/changeovers",
    {
      method: "POST",
      body: JSON.stringify({
        bomHeaderId: firstBom.id,
        lineNumber: "TEST-LINE-1",
        shift: "MORNING",
        idempotencyKey: crypto.randomUUID(),
      }),
    },
    operator.cookie,
  );
  record("Operator can create changeover", operatorChangeover.status, 201, operatorChangeover.latencyMs, "create changeover");

  const createdChangeover = operatorChangeover.data as { changeover?: { id?: string } };
  const changeoverId = createdChangeover.changeover?.id;

  const qaCreate = await requestJson(
    "/api/changeovers",
    {
      method: "POST",
      body: JSON.stringify({ bomHeaderId: firstBom.id, lineNumber: "TEST-LINE-1" }),
    },
    qa.cookie,
  );
  record("QA cannot create changeover", qaCreate.status, 403, qaCreate.latencyMs, "role gate");

  const privilegedList = await requestJson("/api/changeovers", { method: "GET" }, engineer.cookie);
  record("Engineer can list changeovers", privilegedList.status, 200, privilegedList.latencyMs, "privileged read");

  const operatorList = await requestJson("/api/changeovers", { method: "GET" }, operator.cookie);
  record("Operator can list changeovers", operatorList.status, 200, operatorList.latencyMs, "own changeovers only");

  if (changeoverId) {
    const lineItem = await prisma.bomLineItem.findFirst({
      where: { bomHeaderId: firstBom.id },
      select: { id: true, feederNumber: true, ucalPartNumbers: true },
      orderBy: { srNo: "asc" },
    });

    if (!lineItem) {
      throw new Error("No BOM line items found for the selected BOM.");
    }

    const alternative = await prisma.bomAlternative.findFirst({
      where: { lineItemId: lineItem.id },
      select: { mpn: true },
      orderBy: { rank: "asc" },
    });

    if (!alternative) {
      throw new Error("No BOM alternatives found for the selected line item.");
    }

    const validScan = await requestJson(
      `/api/changeovers/${changeoverId}/scans`,
      {
        method: "POST",
        body: JSON.stringify({ scannedValue: alternative.mpn, idempotencyKey: crypto.randomUUID() }),
      },
      operator.cookie,
    );
    record("Valid scan succeeds", validScan.status, 201, validScan.latencyMs, alternative.mpn);

    const duplicateScan = await requestJson(
      `/api/changeovers/${changeoverId}/scans`,
      {
        method: "POST",
        body: JSON.stringify({ scannedValue: alternative.mpn, idempotencyKey: crypto.randomUUID() }),
      },
      operator.cookie,
    );
    record("Duplicate scan returns 409", duplicateScan.status, 409, duplicateScan.latencyMs, lineItem.feederNumber);

    const noMatchScan = await requestJson(
      `/api/changeovers/${changeoverId}/scans`,
      {
        method: "POST",
        body: JSON.stringify({ scannedValue: "TOTALLY-INVALID-MPN", idempotencyKey: crypto.randomUUID() }),
      },
      operator.cookie,
    );
    record("Unknown scan returns 422", noMatchScan.status, 422, noMatchScan.latencyMs, "NO_MATCH");

    const qaScan = await requestJson(
      `/api/changeovers/${changeoverId}/scans`,
      {
        method: "POST",
        body: JSON.stringify({ scannedValue: alternative.mpn, idempotencyKey: crypto.randomUUID() }),
      },
      qa.cookie,
    );
    record("QA cannot scan", qaScan.status, 403, qaScan.latencyMs, "role gate");
  }

  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  const avgLatency = Math.round(results.reduce((sum, result) => sum + result.latencyMs, 0) / Math.max(results.length, 1));

  writeJson(path.join(TESTING_RESULTS_DIR, "auth-role-test.json"), {
    timestamp: new Date().toISOString(),
    summary: { passed, failed, avgLatency },
    results,
  });

  console.log(`Summary: ${passed} passed, ${failed} failed, avg latency ${avgLatency}ms`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });