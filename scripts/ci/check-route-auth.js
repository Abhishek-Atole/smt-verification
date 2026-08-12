#!/usr/bin/env node
// Verifies every Express route has requireAuth or requireRole middleware.
// Phase 0 stub — exits 0 so CI passes until routes are audited in Phase 2.
// Replace with full implementation before Phase 2 sign-off.
const strict = process.argv.includes("--strict");
console.log(`check-route-auth: ${strict ? "strict" : "standard"} mode — stub, passing`);
process.exit(0);
