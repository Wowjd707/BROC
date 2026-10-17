/**
 * A real Postgres, running the real migrations, with RLS actually enforced.
 *
 * Everything else in this suite is pure-logic: functions in `lib/*-core.ts`
 * tested without a database. That leaves the RLS policies — which are load
 * bearing for tenancy AND for the sandbox (migration 032 made practice mode
 * *be* an RLS scope) — covered by nothing at all. A policy bug therefore looks
 * exactly like working code until someone clicks the button.
 *
 * PGlite is Postgres compiled to WASM, in-process. No Docker, no psql, no
 * server, so this runs anywhere `npm test` runs. The migrations applied are the
 * actual files in supabase/migrations, in order.
 *
 * Two things Supabase provides that PGlite does not, shimmed below:
 *   - `auth.uid()`, which normally reads the request JWT. Here it reads a
 *     session GUC. From a policy's point of view the contract is identical.
 *   - `storage.objects`/`storage.buckets` and `storage.foldername()`, enough of
 *     their shape for migration 019's policies to compile and run. The POLICY
 *     TEXT is the real one; only the table it sits on is a stand-in.
 *
 * The shim is deliberately thin. Anything it fakes is something this harness
 * cannot honestly test, so keep it that way.
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.resolve(__dirname, '..', 'supabase', 'migrations');

export interface Harness {
  db: PGlite;
  /** Act as this signed-in user for subsequent queries. */
  signIn(userId: string): Promise<void>;
  /** Drop back to the migration-running superuser (bypasses RLS). */
  asServiceRole(): Promise<void>;
}

export async function bootDatabase(): Promise<Harness> {
  const db = await PGlite.create({ extensions: { pgcrypto } });

  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
      LANGUAGE sql STABLE AS $fn$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $fn$;

    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;

    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (
      id TEXT PRIMARY KEY, name TEXT, public BOOLEAN,
      file_size_limit BIGINT, allowed_mime_types TEXT[]
    );
    CREATE TABLE IF NOT EXISTS storage.objects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id TEXT, name TEXT, owner UUID
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE OR REPLACE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[]
      LANGUAGE sql IMMUTABLE AS $fn$ SELECT string_to_array(name, '/') $fn$;
  `);

  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
    }
  }

  // Grants Supabase configures out of band; the migrations assume them.
  await db.exec(`
    GRANT USAGE ON SCHEMA public, auth, storage TO authenticated, anon, service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth, storage TO authenticated, anon, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
    GRANT ALL ON storage.objects, storage.buckets TO authenticated, service_role;
  `);

  return {
    db,
    async signIn(userId: string) {
      await db.exec('SET ROLE authenticated');
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [userId]);
    },
    async asServiceRole() {
      await db.exec('RESET ROLE');
    },
  };
}

/** True when the error is an RLS refusal rather than anything else. */
export function isRlsRefusal(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === '42501' || /row-level security/.test(err?.message ?? '');
}
