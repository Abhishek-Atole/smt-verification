import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import logger from "../src/utils/logger";

const resolvedDatabaseUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_TEST;

if (!process.env.DATABASE_URL && resolvedDatabaseUrl) {
  process.env.DATABASE_URL = resolvedDatabaseUrl;
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL or DATABASE_URL_TEST must be set before seeding users");
}

const { pool } = await import("@workspace/db");

const DEFAULT_USERS = [
  {
    username: "operator1",
    password: process.env.SEED_OPERATOR_PASSWORD ?? "operator123",
    role: "operator",
    displayName: "Operator 1",
  },
  {
    username: "operator2",
    password: process.env.SEED_OPERATOR_PASSWORD ?? "operator123",
    role: "operator",
    displayName: "Operator 2",
  },
  {
    username: "qa1",
    password: process.env.SEED_QA_PASSWORD ?? "qa123",
    role: "qa",
    displayName: "QA Engineer 1",
  },
  {
    username: "engineer1",
    // SEED_SUPERVISOR_PASSWORD is the documented name (.env.example);
    // SEED_ENGINEER_PASSWORD kept as a legacy alias (pre-rename installs).
    password: process.env.SEED_SUPERVISOR_PASSWORD ?? process.env.SEED_ENGINEER_PASSWORD ?? "engineer123",
    role: "supervisor",
    displayName: "Supervisor 1",
  },
  {
    username: "admin1",
    password: process.env.SEED_ADMIN_PASSWORD ?? "admin123",
    role: "admin",
    displayName: "Administrator 1",
  },
  {
    username: "storekeeper1",
    // SEED_STORE_PASSWORD is the documented name (.env.example);
    // SEED_STOREKEEPER_PASSWORD kept as a legacy alias.
    password: process.env.SEED_STORE_PASSWORD ?? process.env.SEED_STOREKEEPER_PASSWORD ?? "storekeeper123",
    role: "storekeeper",
    displayName: "Storekeeper 1",
  },
] as const;

async function seedUsers() {
  logger.info("Seeding default users...");

  for (const user of DEFAULT_USERS) {
    // Use raw SQL for both the lookup and the upsert so this script is
    // resilient to Drizzle schema drift. The live DB may have different
    // columns (e.g. password_hash instead of password, no username) than
    // the local drizzle schema describes.
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE employee_id = $1 OR name = $1 LIMIT 1`,
      [user.username],
    );

    const hashedPassword = await bcrypt.hash(user.password, 12);

    if (existing.rows.length > 0 && existing.rows[0]) {
      await pool.query(
        `UPDATE users
         SET password_hash = $1,
             name = $2,
             role = $3,
             employee_id = $4,
             is_active = true,
             must_change_password = true,
             user_type = $6
         WHERE id = $5`,
        [hashedPassword, user.displayName, user.role, user.username, existing.rows[0].id, user.role],
      );

      logger.info({ user: user.username, role: user.role }, "updated existing user");
      continue;
    }

    const uid = randomUUID();
    await pool.query(
      `INSERT INTO users (id, employee_id, name, role, password_hash, is_active, must_change_password, user_type, created_at)
       VALUES ($1, $2, $3, $4, $5, true, true, $6, now())`,
      [uid, user.username, user.displayName, user.role, hashedPassword, user.role],
    );

    logger.info({ user: user.username, role: user.role }, "created user");
  }

  logger.info("Done. Users seeded successfully.");
  process.exit(0);
}

seedUsers().catch((err) => {
  logger.error({ err }, "user seed failed");
  process.exit(1);
});
