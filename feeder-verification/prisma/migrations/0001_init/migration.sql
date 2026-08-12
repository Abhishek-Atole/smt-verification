-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('operator', 'qa', 'engineer', 'admin');

-- CreateEnum
CREATE TYPE "public"."ChangeoverStatus" AS ENUM ('in_progress', 'verified', 'splicing', 'complete', 'aborted');

-- CreateEnum
CREATE TYPE "public"."MatchType" AS ENUM ('mpn1', 'mpn2', 'mpn3', 'ucal_part_number');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL,
    "employee_id" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "role" "public"."UserRole" NOT NULL DEFAULT 'operator',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bom_headers" (
    "id" UUID NOT NULL,
    "bom_number" VARCHAR(60) NOT NULL,
    "revision" VARCHAR(10) NOT NULL,
    "bom_date" DATE NOT NULL,
    "customer_name" VARCHAR(200),
    "part_name_internal" VARCHAR(200),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bom_headers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bom_line_items" (
    "id" UUID NOT NULL,
    "bom_header_id" UUID NOT NULL,
    "sr_no" INTEGER NOT NULL,
    "feeder_number" VARCHAR(20) NOT NULL,
    "ucal_part_numbers" TEXT[],
    "required_qty" INTEGER NOT NULL DEFAULT 1,
    "reference_location" VARCHAR(50),
    "description" VARCHAR(200),
    "package_desc" VARCHAR(30),
    "remarks" TEXT,

    CONSTRAINT "bom_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bom_alternatives" (
    "id" UUID NOT NULL,
    "line_item_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "make" VARCHAR(100) NOT NULL,
    "mpn" VARCHAR(150) NOT NULL,
    "supplier_code" VARCHAR(50),

    CONSTRAINT "bom_alternatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."changeovers" (
    "id" UUID NOT NULL,
    "bom_header_id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "line_number" VARCHAR(30),
    "shift" VARCHAR(20),
    "status" "public"."ChangeoverStatus" NOT NULL DEFAULT 'in_progress',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "changeovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."verification_scans" (
    "id" UUID NOT NULL,
    "changeover_id" UUID NOT NULL,
    "line_item_id" UUID NOT NULL,
    "alternative_id" UUID NOT NULL,
    "scanned_mpn" VARCHAR(150) NOT NULL,
    "scanned_lot_code" VARCHAR(100),
    "match_type" "public"."MatchType" NOT NULL,
    "is_alternate" BOOLEAN NOT NULL DEFAULT false,
    "scanned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scanned_by" UUID NOT NULL,

    CONSTRAINT "verification_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."splice_records" (
    "id" UUID NOT NULL,
    "changeover_id" UUID NOT NULL,
    "line_item_id" UUID NOT NULL,
    "old_spool_mpn" VARCHAR(150) NOT NULL,
    "old_spool_lot" VARCHAR(100),
    "new_spool_mpn" VARCHAR(150) NOT NULL,
    "new_spool_lot" VARCHAR(100),
    "spliced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "spliced_by" UUID NOT NULL,

    CONSTRAINT "splice_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_log" (
    "id" UUID NOT NULL,
    "changeover_id" UUID,
    "user_id" UUID NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "public"."users"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "bom_headers_bom_number_key" ON "public"."bom_headers"("bom_number");

-- CreateIndex
CREATE UNIQUE INDEX "bom_line_items_bom_header_id_feeder_number_key" ON "public"."bom_line_items"("bom_header_id", "feeder_number");

-- CreateIndex
CREATE UNIQUE INDEX "bom_alternatives_line_item_id_rank_key" ON "public"."bom_alternatives"("line_item_id", "rank");

-- CreateIndex
CREATE INDEX "idx_changeover_operator" ON "public"."changeovers"("operator_id");

-- CreateIndex
CREATE INDEX "idx_changeover_status" ON "public"."changeovers"("status");

-- CreateIndex
CREATE INDEX "idx_vscan_changeover" ON "public"."verification_scans"("changeover_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_scans_changeover_id_line_item_id_key" ON "public"."verification_scans"("changeover_id", "line_item_id");

-- CreateIndex
CREATE INDEX "idx_audit_changeover" ON "public"."audit_log"("changeover_id");

-- CreateIndex
CREATE INDEX "idx_audit_occurred" ON "public"."audit_log"("occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "public"."bom_line_items" ADD CONSTRAINT "bom_line_items_bom_header_id_fkey" FOREIGN KEY ("bom_header_id") REFERENCES "public"."bom_headers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bom_alternatives" ADD CONSTRAINT "bom_alternatives_line_item_id_fkey" FOREIGN KEY ("line_item_id") REFERENCES "public"."bom_line_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."changeovers" ADD CONSTRAINT "changeovers_bom_header_id_fkey" FOREIGN KEY ("bom_header_id") REFERENCES "public"."bom_headers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."changeovers" ADD CONSTRAINT "changeovers_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."verification_scans" ADD CONSTRAINT "verification_scans_changeover_id_fkey" FOREIGN KEY ("changeover_id") REFERENCES "public"."changeovers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."verification_scans" ADD CONSTRAINT "verification_scans_line_item_id_fkey" FOREIGN KEY ("line_item_id") REFERENCES "public"."bom_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."verification_scans" ADD CONSTRAINT "verification_scans_alternative_id_fkey" FOREIGN KEY ("alternative_id") REFERENCES "public"."bom_alternatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."verification_scans" ADD CONSTRAINT "verification_scans_scanned_by_fkey" FOREIGN KEY ("scanned_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."splice_records" ADD CONSTRAINT "splice_records_changeover_id_fkey" FOREIGN KEY ("changeover_id") REFERENCES "public"."changeovers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."splice_records" ADD CONSTRAINT "splice_records_line_item_id_fkey" FOREIGN KEY ("line_item_id") REFERENCES "public"."bom_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."splice_records" ADD CONSTRAINT "splice_records_spliced_by_fkey" FOREIGN KEY ("spliced_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_log" ADD CONSTRAINT "audit_log_changeover_id_fkey" FOREIGN KEY ("changeover_id") REFERENCES "public"."changeovers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

