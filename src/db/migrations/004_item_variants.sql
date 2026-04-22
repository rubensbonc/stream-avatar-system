-- ============================================
-- Color variant items
-- ============================================

-- variants is a JSONB array: [{ id, name, image_filename, thumbnail_filename }, ...]
-- When populated with 2+ entries, the item is a "color variant" item.
ALTER TABLE items ADD COLUMN IF NOT EXISTS variants JSONB;

-- Per-user selected variant for inventory entries (references variants[].id on the item)
ALTER TABLE user_inventory ADD COLUMN IF NOT EXISTS selected_variant_id VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_items_has_variants ON items((jsonb_array_length(variants) > 0)) WHERE variants IS NOT NULL;
