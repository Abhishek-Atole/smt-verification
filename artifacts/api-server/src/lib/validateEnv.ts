import { logger } from "./logger";

const REQUIRED = ["DATABASE_URL", "JWT_SECRET", "ALLOWED_ORIGINS"];

export function validateEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    logger.error({ missing }, "Missing required env vars");
    process.exit(1);
  }
}