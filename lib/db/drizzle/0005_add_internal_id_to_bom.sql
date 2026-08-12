-- Add internal_id column to bom_items table
ALTER TABLE bom_items ADD COLUMN internal_id TEXT;

-- Add index for internal_id for efficient lookups
CREATE INDEX bom_items_internal_id_idx ON bom_items (internal_id);
