CREATE TABLE "bom_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"bom_id" integer NOT NULL,
	"feeder_number" text NOT NULL,
	"feeder_id" integer,
	"part_number" text NOT NULL,
	"component_id" integer,
	"mpn" text,
	"manufacturer" text,
	"package_size" text,
	"expected_mpn" text,
	"description" text,
	"location" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"lead_time" integer,
	"cost" numeric(10, 4),
	"is_alternate" boolean DEFAULT false,
	"parent_item_id" integer
);
--> statement-breakpoint
CREATE TABLE "boms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"feeder_number" text NOT NULL,
	"feeder_id" integer,
	"spool_barcode" text,
	"status" text NOT NULL,
	"part_number" text,
	"component_id" integer,
	"scanned_mpn" text,
	"lot_number" text,
	"date_code" text,
	"reel_id" text,
	"alternate_used" boolean DEFAULT false,
	"validation_result" text,
	"description" text,
	"location" text,
	"scanned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"bom_id" integer,
	"company_name" text NOT NULL,
	"customer_name" text,
	"panel_name" text NOT NULL,
	"supervisor_name" text NOT NULL,
	"operator_name" text NOT NULL,
	"qa_name" text,
	"shift_name" text NOT NULL,
	"shift_date" text NOT NULL,
	"logo_url" text,
	"production_count" integer DEFAULT 0,
	"status" text DEFAULT 'active' NOT NULL,
	"start_time" timestamp DEFAULT now() NOT NULL,
	"end_time" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "splice_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"feeder_number" text NOT NULL,
	"old_spool_barcode" text NOT NULL,
	"new_spool_barcode" text NOT NULL,
	"duration_seconds" integer,
	"spliced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feeders" (
	"id" serial PRIMARY KEY NOT NULL,
	"feeder_id" text NOT NULL,
	"feeder_type" text NOT NULL,
	"size" text NOT NULL,
	"make" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feeders_feeder_id_unique" UNIQUE("feeder_id")
);
--> statement-breakpoint
CREATE TABLE "components" (
	"id" serial PRIMARY KEY NOT NULL,
	"part_id" text NOT NULL,
	"mpn" text NOT NULL,
	"description" text,
	"manufacturer" text,
	"category" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "components_part_id_unique" UNIQUE("part_id"),
	CONSTRAINT "components_mpn_unique" UNIQUE("mpn")
);
--> statement-breakpoint
CREATE TABLE "component_alternates" (
	"id" serial PRIMARY KEY NOT NULL,
	"primary_component_id" integer NOT NULL,
	"alternate_component_id" integer NOT NULL,
	"approval_status" text DEFAULT 'approved' NOT NULL,
	"approved_by" text,
	"approval_date" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_component_alternate" UNIQUE("primary_component_id","alternate_component_id")
);
--> statement-breakpoint
CREATE TABLE "component_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_record_id" integer,
	"reel_id" text,
	"mpn" text NOT NULL,
	"lot_number" text,
	"date_code" text,
	"quantity" integer,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_parent_item_id_bom_items_id_fk" FOREIGN KEY ("parent_item_id") REFERENCES "public"."bom_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_records" ADD CONSTRAINT "scan_records_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "splice_records" ADD CONSTRAINT "splice_records_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_alternates" ADD CONSTRAINT "component_alternates_primary_component_id_components_id_fk" FOREIGN KEY ("primary_component_id") REFERENCES "public"."components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_alternates" ADD CONSTRAINT "component_alternates_alternate_component_id_components_id_fk" FOREIGN KEY ("alternate_component_id") REFERENCES "public"."components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bom_items_bom_id_idx" ON "bom_items" USING btree ("bom_id");--> statement-breakpoint
CREATE INDEX "bom_items_parent_item_id_idx" ON "bom_items" USING btree ("parent_item_id");--> statement-breakpoint
CREATE INDEX "scan_records_session_id_idx" ON "scan_records" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "scan_records_feeder_id_idx" ON "scan_records" USING btree ("feeder_id");--> statement-breakpoint
CREATE INDEX "scan_records_scanned_mpn_idx" ON "scan_records" USING btree ("scanned_mpn");--> statement-breakpoint
CREATE INDEX "feeder_id_idx" ON "feeders" USING btree ("feeder_id");--> statement-breakpoint
CREATE INDEX "component_mpn_idx" ON "components" USING btree ("mpn");--> statement-breakpoint
CREATE INDEX "component_part_id_idx" ON "components" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "component_history_reel_id_idx" ON "component_history" USING btree ("reel_id");--> statement-breakpoint
CREATE INDEX "component_history_lot_number_idx" ON "component_history" USING btree ("lot_number");--> statement-breakpoint
CREATE INDEX "component_history_mpn_idx" ON "component_history" USING btree ("mpn");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_type_idx" ON "audit_logs" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_id_idx" ON "audit_logs" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");