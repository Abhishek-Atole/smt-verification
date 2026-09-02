import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import app from "./app";
import { logger } from "./lib/logger";
import { auditStoredDeviceIps } from "./lib/deviceIpAudit";
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

// Module 10.5 — optional TLS/HTTPS in transit. When TLS_CERT_PATH and
// TLS_KEY_PATH are both set the server terminates HTTPS itself; otherwise it
// stays on plain HTTP (correct for a direct LAN deploy, or when a reverse
// proxy terminates TLS upstream — see TRUST_PROXY in app.ts). Set
// COOKIE_SECURE=true whenever traffic is HTTPS end-to-end.
const tlsCertPath = process.env["TLS_CERT_PATH"];
const tlsKeyPath = process.env["TLS_KEY_PATH"];
const tlsEnabled = Boolean(tlsCertPath && tlsKeyPath);

const server = tlsEnabled
  ? https.createServer(
      {
        cert: readFileSync(tlsCertPath as string),
        key: readFileSync(tlsKeyPath as string),
      },
      app,
    )
  : http.createServer(app);

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

server.listen(port, host, () => {
  const scheme = tlsEnabled ? "https" : "http";
  logger.info({ host, port, tls: tlsEnabled }, `Server listening on ${scheme}://${host}:${port}`);

  // Start the admin metrics sampler + daily db-size/backup jobs once the server
  // is bound. Regression guard: this call was dropped in 49f3118, which left
  // /api/admin/metrics/* empty and the System Health page blank.
  startAdminBackgroundJobs();

  // Module 10.2 — report any stored allowed_ip that the strict validator
  // rejects (rows written before the 2026-08-30 fix). Reports only; never
  // modifies. Fire-and-forget: it must not delay or block accepting requests.
  void auditStoredDeviceIps();
});
