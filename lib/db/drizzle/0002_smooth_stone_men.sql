CREATE TABLE "report_exports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" serial NOT NULL,
	"user_id" text NOT NULL,
	"format" text NOT NULL,
	"downloaded_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_type" text NOT NULL,
	"session_id" serial NOT NULL,
	"bom_id" serial NOT NULL,
	"filters" json,
	"format" text DEFAULT 'pdf' NOT NULL,
	"file_path" text,
	"file_size" serial NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"generated_by" text,
	"expires_at" timestamp,
	"query_execution_time" serial NOT NULL,
	"record_count" serial NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "internal_id" text;--> statement-breakpoint
ALTER TABLE "scan_records" ADD COLUMN "internal_id_scanned" text;--> statement-breakpoint
ALTER TABLE "scan_records" ADD COLUMN "verification_mode" text DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE "scan_records" ADD COLUMN "match_score" integer;--> statement-breakpoint
ALTER TABLE "scan_records" ADD COLUMN "matching_algorithm" text;--> statement-breakpoint
ALTER TABLE "scan_records" ADD COLUMN "expected_value" text;--> statement-breakpoint
ALTER TABLE "scan_records" ADD COLUMN "suggestions" text;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_exports_report_id_idx" ON "report_exports" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "report_exports_user_id_idx" ON "report_exports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "report_exports_downloaded_at_idx" ON "report_exports" USING btree ("downloaded_at");--> statement-breakpoint
CREATE INDEX "reports_report_type_idx" ON "reports" USING btree ("report_type");--> statement-breakpoint
CREATE INDEX "reports_generated_at_idx" ON "reports" USING btree ("generated_at");--> statement-breakpoint
CREATE INDEX "reports_session_id_idx" ON "reports" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "reports_report_type_generated_idx" ON "reports" USING btree ("report_type","generated_at");--> statement-breakpoint
CREATE INDEX "scan_records_verification_mode_idx" ON "scan_records" USING btree ("verification_mode");