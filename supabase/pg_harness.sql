-- Supabase compatibility harness for offline verification of the migration set.
-- Stubs ONLY the platform objects Supabase provides; it creates none of the
-- application's own objects, so anything the migrations need must come from the
-- migrations themselves.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

-- GoTrue's users table, reduced to the columns the app references.
CREATE TABLE IF NOT EXISTS auth.users (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT
);

-- Returns the current request's user. Reads a GUC so a test can impersonate.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID;
$$;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  public BOOLEAN NOT NULL DEFAULT FALSE
);
-- Migration 019 sets the evidence bucket's size limit and MIME allowlist, which
-- real Supabase storage.buckets carries. Added separately so an older harness
-- database picks them up on a re-run.
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS file_size_limit BIGINT;
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS allowed_mime_types TEXT[];

CREATE TABLE IF NOT EXISTS storage.objects (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT REFERENCES storage.buckets(id),
  name     TEXT,
  owner    UUID
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT string_to_array(name, '/');
$$;

GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
