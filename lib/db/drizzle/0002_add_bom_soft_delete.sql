-- Add soft delete support to boms table
ALTER TABLE "boms" ADD COLUMN "deleted_at" timestamp;
ALTER TABLE "boms" ADD COLUMN "deleted_by" text;

-- Add soft delete support to bom_items table
ALTER TABLE "bom_items" ADD COLUMN "deleted_at" timestamp;
ALTER TABLE "bom_items" ADD COLUMN "deleted_by" text;

-- Create indexes for efficient trash queries
CREATE INDEX "idx_boms_deleted_at" ON "boms" ("deleted_at");
CREATE INDEX "idx_bom_items_deleted_at" ON "bom_items" ("deleted_at");
