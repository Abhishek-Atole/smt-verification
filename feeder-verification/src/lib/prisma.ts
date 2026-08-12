import { PrismaClient } from "@prisma/client";

// Keep Prisma on the Node library engine in this app runtime.
if (!process.env.PRISMA_CLIENT_ENGINE_TYPE) {
  process.env.PRISMA_CLIENT_ENGINE_TYPE = "library";
}

function resolveDatabaseUrl(): string | undefined {
  const fromEnv =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING;

  if (!fromEnv) return undefined;

  // Prisma Postgres URLs can fail in local-only setups; prefer direct pg URL when available.
  if (fromEnv.startsWith("prisma+postgres://") && process.env.POSTGRES_URL) {
    return process.env.POSTGRES_URL;
  }

  return fromEnv;
}

const databaseUrl = resolveDatabaseUrl();

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma =
  global.prisma ||
  new PrismaClient({
    ...(databaseUrl
      ? {
          datasources: {
            db: {
              url: databaseUrl,
            },
          },
        }
      : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}
