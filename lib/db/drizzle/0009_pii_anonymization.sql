-- GDPR & DPDP Act Compliance: PII Anonymization
-- Replaces raw IP and user-agent with hashed values
-- Adds automatic purge_after for 90-day retention requirement

ALTER TABLE "report_exports" ADD COLUMN "ip_address_hash" VARCHAR(64);
ALTER TABLE "report_exports" ADD COLUMN "user_agent_hash" VARCHAR(64);
ALTER TABLE "report_exports" ADD COLUMN "purge_after" TIMESTAMPTZ DEFAULT NOW() + INTERVAL '90 days';

-- Migrate existing data (if any) - set hashes to null for existing records
UPDATE "report_exports" SET 
  "ip_address_hash" = NULL,
  "user_agent_hash" = NULL,
  "purge_after" = "downloaded_at" + INTERVAL '90 days'
WHERE "purge_after" IS NULL;

-- Drop raw PII columns
ALTER TABLE "report_exports" DROP COLUMN "ip_address";
ALTER TABLE "report_exports" DROP COLUMN "user_agent";

-- Add index for purge_after queries
CREATE INDEX "idx_report_exports_purge_after" ON "report_exports" ("purge_after");
