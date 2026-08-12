/**
 * Stress-test data seeder (Part D of the full-system audit).
 *
 * Generates high-volume, schema-accurate data for load/pagination/performance
 * testing. All rows are namespaced so they can be cleaned up independently of
 * real data:
 *   - boms                : name LIKE 'STRESS BOM %'
 *   - changeover_sessions : id  LIKE 'SMTSTRESS_%'
 *   - feeder_scans        : session_id LIKE 'SMTSTRESS_%'
 *   - splice_records      : changeover_id LIKE 'SMTSTRESS_%'
 *
 * Targets: >=120 BOMs x 35 items, >=20,400 sessions, >=700k scans, >=500 splices.
 *
 * Column names are taken from the LIVE database (verified against
 * information_schema), not the Drizzle schema, because the live DB has drifted
 * (bom_items.part_number / item_name are NOT NULL; boms.updated_at exists).
 *
 * Run:  DOTENV_CONFIG_PATH=../.env tsx scripts/seed-stress-test.ts
 * (from repo root, with DATABASE_URL set)
 */

const resolvedDatabaseUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_TEST;
if (!process.env.DATABASE_URL && resolvedDatabaseUrl) {
  process.env.DATABASE_URL = resolvedDatabaseUrl;
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL or DATABASE_URL_TEST must be set before seeding");
}

const { pool } = await import("@workspace/db");

const BOM_COUNT = 120;
const ITEMS_PER_BOM = 35;
const SESSION_COUNT = 20_400;
const SPLICE_COUNT = 600;

function log(msg: string) {
  // eslint-disable-next-line no-console
  console.log(`[stress-seed] ${new Date().toISOString()} ${msg}`);
}

async function main() {
  const t0 = Date.now();

  // 1. Clean any prior stress run (order respects FKs: scans+splices -> sessions -> items -> boms)
  log("cleaning prior stress data...");
  await pool.query(`DELETE FROM feeder_scans WHERE session_id LIKE 'SMTSTRESS_%'`);
  await pool.query(`DELETE FROM splice_records WHERE changeover_id LIKE 'SMTSTRESS_%'`);
  await pool.query(`DELETE FROM changeover_sessions WHERE id LIKE 'SMTSTRESS_%'`);
  await pool.query(`DELETE FROM bom_items WHERE bom_id IN (SELECT id FROM boms WHERE name LIKE 'STRESS BOM %')`);
  await pool.query(`DELETE FROM boms WHERE name LIKE 'STRESS BOM %'`);

  // 2. Operators + a QA user for FK-valid ownership
  const usersRes = await pool.query<{ id: string; role: string }>(
    `SELECT id, role FROM users WHERE role IN ('operator','qa','supervisor') ORDER BY role`,
  );
  const operatorIds = usersRes.rows.filter((r) => r.role === "operator").map((r) => r.id);
  if (operatorIds.length === 0) {
    throw new Error("No operator users found — run seed:users first");
  }
  log(`using ${operatorIds.length} operator(s) for session ownership`);

  // 3. BOMs
  log(`inserting ${BOM_COUNT} BOMs...`);
  await pool.query(
    `INSERT INTO boms (name, description, created_by, is_latest, updated_at, created_at)
     SELECT 'STRESS BOM ' || lpad(g::text, 4, '0'),
            'Auto-generated stress-test BOM',
            'seed-stress', true, now(), now()
     FROM generate_series(1, $1) g`,
    [BOM_COUNT],
  );
  const bomRows = await pool.query<{ id: number }>(
    `SELECT id FROM boms WHERE name LIKE 'STRESS BOM %' ORDER BY id`,
  );
  const bomIds = bomRows.rows.map((r) => r.id);
  log(`created ${bomIds.length} BOMs (ids ${bomIds[0]}..${bomIds[bomIds.length - 1]})`);

  // 4. BOM items — 35 per BOM, feeders F001..F035
  log(`inserting ${BOM_COUNT * ITEMS_PER_BOM} BOM items...`);
  await pool.query(
    `INSERT INTO bom_items (bom_id, feeder_number, part_number, quantity, item_name,
                            make_1, mpn_1, description)
     SELECT b.id,
            'F' || lpad(f::text, 3, '0'),
            'PN-' || b.id || '-' || f,
            1,
            'Item ' || f,
            'MAKER' || (f % 5),
            'MPN-' || b.id || '-' || f,
            'Stress component ' || f
     FROM unnest($1::int[]) AS b(id)
     CROSS JOIN generate_series(1, $2) f`,
    [bomIds, ITEMS_PER_BOM],
  );

  // 5. Sessions — deterministic ids SMTSTRESS_000001.. ; bom + operator round-robin;
  //    status mix across the enum so QA-queue/pagination/analytics have variety.
  log(`inserting ${SESSION_COUNT} changeover sessions...`);
  await pool.query(
    `INSERT INTO changeover_sessions (id, operator_id, bom_id, status, started_at, created_at, verification_mode)
     SELECT 'SMTSTRESS_' || lpad(s::text, 6, '0'),
            ($2::uuid[])[1 + (s % $3)],
            ($4::int[])[1 + (s % $5)],
            (ARRAY['active','completed','pending_qa','qa_confirmed','qa_in_review']::changeover_session_status[])[1 + (s % 5)],
            now() - ((s % 10000) || ' minutes')::interval,
            now() - ((s % 10000) || ' minutes')::interval,
            CASE WHEN s % 4 = 0 THEN 'MANUAL' ELSE 'AUTO' END
     FROM generate_series(1, $1) s`,
    [SESSION_COUNT, operatorIds, operatorIds.length, bomIds, bomIds.length],
  );

  // 6. Feeder scans — 35 per session (F001..F035). Mostly 'verified' so most
  //    sessions have full 200% coverage; a deterministic slice gets a 'failed'
  //    last feeder to exercise the QA-200 gate's partial path.
  const scanTotal = SESSION_COUNT * ITEMS_PER_BOM;
  log(`inserting ${scanTotal} feeder scans (this is the heavy step)...`);
  await pool.query(
    `INSERT INTO feeder_scans (session_id, feeder_number, scanned_value, status,
                               operator_id, verification_mode, scanned_at, qa_result)
     SELECT cs.id,
            'F' || lpad(f::text, 3, '0'),
            'SCAN-' || cs.id || '-' || f,
            CASE
              WHEN (right(cs.id, 6)::int) % 10 = 0 AND f = 35 THEN 'failed'::feeder_scan_status
              ELSE 'verified'::feeder_scan_status
            END,
            cs.operator_id,
            cs.verification_mode,
            cs.started_at,
            CASE WHEN cs.status = 'qa_confirmed' THEN 'pass'::qa_result ELSE 'pending'::qa_result END
     FROM changeover_sessions cs
     CROSS JOIN generate_series(1, $1) f
     WHERE cs.id LIKE 'SMTSTRESS_%'`,
    [ITEMS_PER_BOM],
  );

  // 7. Splice records — one per session for the first SPLICE_COUNT sessions.
  //    qa_result mix of pending/pass/fail (splice_records.qa_result is text).
  log(`inserting ${SPLICE_COUNT} splice records...`);
  await pool.query(
    `INSERT INTO splice_records (changeover_id, feeder_number, old_spool_mpn, new_spool_mpn,
                                 old_spool_lot, new_spool_lot, spliced_by, spliced_at,
                                 allocation_verified, qa_result)
     SELECT cs.id,
            'F' || lpad(((cs.rn % 35) + 1)::text, 3, '0'),
            'OLD-MPN-' || cs.rn,
            'NEW-MPN-' || cs.rn,
            'LOT-OLD-' || cs.rn,
            'LOT-NEW-' || cs.rn,
            cs.operator_id,
            cs.started_at,
            (cs.rn % 2 = 0),
            (ARRAY['pending','pass','fail'])[1 + (cs.rn % 3)]
     FROM (
       SELECT id, operator_id, started_at,
              row_number() OVER (ORDER BY id) AS rn
       FROM changeover_sessions
       WHERE id LIKE 'SMTSTRESS_%'
       ORDER BY id
       LIMIT $1
     ) cs`,
    [SPLICE_COUNT],
  );

  // 8. Report actual counts
  const counts = await pool.query<{ t: string; c: string }>(
    `SELECT 'boms' t, count(*)::text c FROM boms WHERE name LIKE 'STRESS BOM %'
     UNION ALL SELECT 'bom_items', count(*)::text FROM bom_items WHERE bom_id IN (SELECT id FROM boms WHERE name LIKE 'STRESS BOM %')
     UNION ALL SELECT 'changeover_sessions', count(*)::text FROM changeover_sessions WHERE id LIKE 'SMTSTRESS_%'
     UNION ALL SELECT 'feeder_scans', count(*)::text FROM feeder_scans WHERE session_id LIKE 'SMTSTRESS_%'
     UNION ALL SELECT 'splice_records', count(*)::text FROM splice_records WHERE changeover_id LIKE 'SMTSTRESS_%'`,
  );
  log("stress data summary:");
  for (const row of counts.rows) {
    log(`  ${row.t.padEnd(22)} ${row.c}`);
  }
  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[stress-seed] FAILED", err);
  process.exit(1);
});
