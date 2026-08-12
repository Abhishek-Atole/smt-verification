-- Add password hash for NextAuth credential verification
ALTER TABLE "public"."users"
ADD COLUMN IF NOT EXISTS "password_hash" VARCHAR(255);