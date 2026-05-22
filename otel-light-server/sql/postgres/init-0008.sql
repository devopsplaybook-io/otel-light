-- Add role and scopes columns to users table
-- All existing users become admin
ALTER TABLE users ADD COLUMN IF NOT EXISTS "role" VARCHAR(20) NOT NULL DEFAULT 'admin';
ALTER TABLE users ADD COLUMN IF NOT EXISTS "scopes" TEXT NOT NULL DEFAULT '["traces","metrics","logs"]';
