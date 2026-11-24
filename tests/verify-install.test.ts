/**
 * supabase/verify_install.sql passes on a clean install of every migration.
 *
 * A live database was once found without migration 036 while every check
 * passed, because no check covered it. This test keeps the script itself
 * honest: it must run, and every check must pass against 001 onward.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bootDatabase } from './rls-harness';

describe('verify_install.sql', () => {
  it('passes every check on a clean install', async () => {
    const h = await bootDatabase();
    try {
      await h.asServiceRole();
      const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'verify_install.sql'), 'utf8');
      const results = await h.db.exec(sql);
      const rows = results[results.length - 1].rows as { result: string; check_name: string }[];
      expect(rows.length).toBeGreaterThanOrEqual(40);
      expect(rows.filter((r) => r.result !== 'PASS').map((r) => r.check_name)).toEqual([]);
    } finally {
      await h.db.close();
    }
  });
});
