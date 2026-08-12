import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

function getDatabaseHost(): string | undefined {
  try {
    return new URL(process.env.DATABASE_URL ?? "").hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function shouldUseSsl(): false | { rejectUnauthorized: boolean } {
  const isProduction = process.env.NODE_ENV === "production";
  const dbHost = getDatabaseHost();
  const isLocalDb = dbHost === "localhost" || dbHost === "127.0.0.1" || dbHost === "::1";
  const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false";

  // In production, enforce SSL by default
  if (isProduction) {
    const explicitSsl = process.env.DB_SSL?.toLowerCase();
    if (explicitSsl === "false") {
      throw new Error("SSL cannot be disabled in production. Set DB_SSL=true or remove the variable.");
    }
    if (explicitSsl === "true") {
      return { rejectUnauthorized };
    }

    // Local production-like restarts should not force TLS to localhost Postgres.
    if (isLocalDb) {
      return false;
    }

    // Production always uses SSL with certificate validation
    return { rejectUnauthorized };
  }

  // Development: allow configurable SSL
  const explicitSsl = process.env.DB_SSL?.toLowerCase();
  if (explicitSsl === "true") {
    // In dev, allow disabling certificate verification for local development
    return { rejectUnauthorized };
  }

  if (explicitSsl === "false") {
    return false;
  }

  const sslMode = (() => {
    try {
      const parsed = new URL(process.env.DATABASE_URL ?? "");
      return parsed.searchParams.get("sslmode")?.toLowerCase();
    } catch {
      return undefined;
    }
  })();

  if (sslMode === "require" || sslMode === "verify-full" || sslMode === "verify-ca") {
    return { rejectUnauthorized };
  }

  return false;
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 25,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: shouldUseSsl(),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
