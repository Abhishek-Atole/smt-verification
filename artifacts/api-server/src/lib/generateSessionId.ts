import { db } from "@workspace/db";
import { changeoverSessionsTable } from "@workspace/db/schema";
import { like, desc, sql } from "drizzle-orm";

/**
 * Generate a unique changeover session ID in format: SMT_YYYYMMDD_NNNNNN
 * 
 * Example: SMT_20260425_000001
 * 
 * - Queries the database for the highest sequence number for today's date
 * - Increments the sequence and zero-pads to 6 digits
 * - Returns the complete ID string
 */
export async function generateSessionId(): Promise<string> {
  // Generate today's date in YYYYMMDD format
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const today = `${year}${month}${day}`;
  const prefix = `SMT_${today}_`;

  // Find the highest sequence number for today's date
  // Using a raw SQL query to extract the sequence portion of existing IDs
  const latest = await db.execute(
    sql`
      SELECT id FROM changeover_sessions 
      WHERE id LIKE ${prefix + "%"}
      ORDER BY id DESC 
      LIMIT 1
    `
  );

  let nextSeq = 1;

  if (latest.rows && latest.rows.length > 0) {
    const lastId = (latest.rows[0] as { id: string }).id;
    // Extract sequence from format: SMT_YYYYMMDD_NNNNNN
    const seqPart = lastId.split("_")[2];
    const lastSeq = parseInt(seqPart ?? "0", 10);
    nextSeq = isNaN(lastSeq) ? 1 : lastSeq + 1;
  }

  // Zero-pad sequence to 6 digits
  const seq = String(nextSeq).padStart(6, "0");
  return `${prefix}${seq}`;
}
