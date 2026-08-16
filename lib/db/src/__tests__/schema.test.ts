// Lightweight schema validation for CI Stage 2 ("lib/db schema validation").
// Imports the Drizzle schema (no DB connection) and asserts the core tables and
// key columns are defined. Run with: pnpm run test (tsx src/__tests__/schema.test.ts).
import assert from "node:assert/strict";
import * as schema from "../schema/index";

const REQUIRED_TABLES = [
  "usersTable",
  "bomsTable",
  "bomItemsTable",
  "sessionsTable",
  "feedersTable",
  "componentsTable",
  "auditLogsTable",
  "notificationsTable",
] as const;

for (const name of REQUIRED_TABLES) {
  assert.ok(
    (schema as Record<string, unknown>)[name],
    `expected schema to export ${name}`,
  );
}

// New personnel column added alongside supervisor/QA — guard against regressions.
assert.ok(
  "engineerName" in schema.sessionsTable,
  "sessionsTable must define the engineerName (engineer_name) column",
);

// Users table backs auth/seeding; these columns are referenced by seed-users.ts.
for (const col of ["role", "password_hash", "employee_id"] as const) {
  assert.ok(col in schema.usersTable, `usersTable must define the ${col} column`);
}

console.log(`✅ lib/db schema validation passed (${REQUIRED_TABLES.length} core tables checked)`);
