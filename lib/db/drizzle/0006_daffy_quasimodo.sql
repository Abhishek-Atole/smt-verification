ALTER TABLE "bom_items" ALTER COLUMN "sr_no" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT true NOT NULL;