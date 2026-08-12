ALTER TABLE "bom_items" DROP CONSTRAINT "bom_items_parent_item_id_bom_items_id_fk";
--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "sr_no" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "item_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "rdeply_part_no" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "reference_designator" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "values" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "package_description" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "dnp_parts" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "supplier_1" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "part_no_1" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "supplier_2" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "part_no_2" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "supplier_3" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "part_no_3" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "remarks" text;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "bom_items" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "boms" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "boms" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "deleted_by" text;