import app from "./app";
import { logger } from "./lib/logger";
import { startAdminBackgroundJobs } from "./services/admin-background-jobs";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Bind on :: (dual-stack IPv6/IPv4) so LAN clients and localhost IPv6 can
// reach the host PC. Override with HOST=127.0.0.1 to restrict to loopback
// (single-machine / Electron embedded mode).
const host = process.env["HOST"] || "::";

app.listen(port, host, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ host, port }, `Server listening on http://${host}:${port}`);

  // Start the admin metrics sampler + daily db-size/backup jobs once the server
  // is bound. Regression guard: this call was dropped in 49f3118, which left
  // /api/admin/metrics/* empty and the System Health page blank.
  startAdminBackgroundJobs();
});
