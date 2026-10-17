---
name: broc-migration
description: Add or change database schema in BROC — new tables, columns, constraints, RLS policies — and regenerate the TypeScript types afterwards. Use whenever a change touches supabase/migrations/, or when a type error mentions a column or table that exists in the database but not in lib/supabase/types.ts.
---

# Changing the schema

## The rules that are not negotiable

**Every schema change is a new numbered migration.** `supabase/migrations/0NN_description.sql`.
Never edit one that has been applied — someone else's database has already run
it, and changing it means their schema and yours silently disagree.

**Write it re-runnable.** Everything from 008 on can be applied twice with the
same result. Use `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and
wrap constraint additions in a `DO $$ ... $$` block that checks `pg_constraint`
first. This is what makes a half-finished install recoverable instead of a
restore-from-backup.

**RLS is mandatory on every tenant table, in the same migration.** This is
multi-tenant software scoped by `organization_id`. A table without a policy is
either invisible or fully exposed, and both are shipped defects. Reference
content that is the same for every tenant (emission factors, regulatory items)
still gets RLS, with a read-to-authenticated policy and no write policy.

**An UPDATE policy needs a `WITH CHECK`, not just a `USING`.** Postgres reuses
the `USING` expression as the check when you omit it, which gates *which rows
you may touch* but not *what you may set them to*. Migration 002 shipped:

```sql
CREATE POLICY "users_update_self" ON users
  FOR UPDATE USING (id = auth.uid());
```

`id = auth.uid()` stays true no matter what else the statement writes, so any
user could set their own `role` to admin or move their row to another
organization. Migration 032 fixed it with a trigger and a real `WITH CHECK`.
Assume the same mistake is waiting in any policy you write.

## After the schema, the types

`lib/supabase/types.ts` is generated. Regenerate it whenever the schema changes,
and use the wrapper rather than the raw CLI:

```bash
npm run types -- --project-id <ref>
npm run types -- --db-url postgresql://...
```

`scripts/regen-types.py` exists because `supabase gen types` on its own is not
safe here. It handles both traps below, refuses to write if the output looks
truncated, and reports how many aliases it restored. If you run the raw command
instead, you own both problems:

**On Windows, `>` writes UTF-16.** PowerShell redirection produces a UTF-16LE
file with a BOM. It looks fine in an editor and every `grep` for a new table
name returns nothing, because the bytes do not match. Convert to UTF-8 after
generating, or write the file from a tool that controls its encoding.

**The generator drops the hand-maintained aliases.** The end of `types.ts`
carries convenience row types — `Organization`, `AppUser`, `EmissionEntry` and
about thirty-five more — under a `Convenience row types` comment. `supabase gen
types` does not emit them, so a regeneration silently deletes every one and the
build fails in a few dozen unrelated files. Re-append that block afterwards,
and add a line to it when a new table earns a short name.

## Foreign keys and PostgREST embeds

If you add a **second** foreign key from one table to another, every existing
`.select('other_table(...)')` embed across the app breaks. PostgREST can no
longer tell which relationship you mean and returns *"Could not embed because
more than one relationship was found"*.

This happened when `users.active_organization_id` was added alongside
`users.organization_id`: sixteen queries broke, and only two of them showed up
as type errors. The other fourteen compiled cleanly and failed at run time.

So: after adding an FK, grep for embeds of the target table and hint each one
with its constraint name.

```ts
.select('organizations!users_organization_id_fkey(name)')
```

## Checklist

- [ ] New numbered file, nothing existing edited
- [ ] Re-runnable — applying twice changes nothing the second time
- [ ] RLS enabled, policies in this same migration
- [ ] Any UPDATE policy has a `WITH CHECK`
- [ ] A second FK to an existing table? Hint every affected embed
- [ ] `snake_case`, UUID PKs, `TIMESTAMPTZ`, `is_active` soft-delete — match the
      surrounding tables
- [ ] Comments explain *why*, especially for a constraint
- [ ] Types regenerated, encoding checked, alias block restored
- [ ] `npx tsc --noEmit` and `npm test` clean
- [ ] `docs/DATA_MODEL.md` updated
