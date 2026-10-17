# Practice workspace

A full copy of the system, with invented data, that people can learn on end to
end — enter an invoice, run a data review, set a goal, assemble a disclosure —
with no way for any of it to reach what the organization actually reports.

Settings → **Enter practice workspace**. A banner across the top says where you
are; **Back to live data** leaves.

---

## How the isolation works

The obvious implementation is an `is_sandbox` column on every tenant table,
filtered in every query. That was rejected. It puts the guarantee in
application code, in every query, forever, and the first forgotten filter mixes
practice figures into a disclosure — silently, and in exactly the direction
nobody checks.

Instead: **a sandbox is another organization.** Migration 032 adds
`organizations.sandbox_of` and `users.active_organization_id`, and redefines
the one function every RLS policy already funnels through:

```sql
CREATE OR REPLACE FUNCTION auth_org_id() RETURNS UUID AS $$
  SELECT COALESCE(active_organization_id, organization_id) FROM users WHERE id = auth.uid()
$$;
```

That is the whole mechanism. Every policy written since migration 002 keeps
working, unchanged and unreviewed, and practice data is separated by the same
row-level security that separates one organization from another. No new isolation
model to get wrong, and nothing for a future query to forget.

`active_organization_id` defaults to NULL, meaning "home organization" — so any
row that predates this migration, or that something unexpected leaves alone,
behaves exactly as it did before the feature existed.

## Switching is a function, not a policy

Users get no UPDATE policy permitting them to set `active_organization_id`. A
policy scoped to "your own row" would also let someone rewrite
`organization_id` or `role`. The switch goes through
`set_active_organization()`, SECURITY DEFINER, which writes one column and
refuses any target that is not the caller's own home organization or its own
sandbox.

> **Migration 032 also closes a pre-existing hole.** Migration 002 created
> `users_update_self` as `FOR UPDATE USING (id = auth.uid())` with no
> `WITH CHECK` and no column restriction. Because an UPDATE policy without a
> check reuses its USING expression, `id = auth.uid()` stayed true however many
> *other* columns the statement set — so any authenticated user could
> `UPDATE users SET role = 'admin'` on themselves, or move their own row into
> another organization in the same deployment and read that organization's data.
> Reproduced, then fixed here with a trigger (`guard_user_row_changes`) plus a
> narrowed policy. **Apply 032 even if you never want a sandbox.**

## What lives in the sandbox

Created on first entry: three sites and eighteen months of gas, electricity,
water and waste. Eighteen rather than twelve so year-on-year comparisons, goal
progress and the anomaly checks all have something to say — a sandbox where
every chart is empty teaches nothing and reads as broken software.

The figures are **deterministic**, not random. A practice workspace that looks
different every time it is reset makes "did my change do that?" unanswerable,
which is the one question it exists to answer.

Seeding goes through `createEmissionEntry` and `createEhsEntry`, the same write
path the real UI uses — not hand-written INSERTs. Factors resolve server-side
and lineage is recorded, so clicking into a practice number shows a real
provenance chain. Data that no real code path could have produced would teach
people a fiction.

## Resetting

Admin only, enforced in the database. It deletes the sandbox *organization*
row; every tenant table cascades from `organizations(id)`, so one delete
removes everything — and a table added later that forgets its cascade makes
this fail loudly rather than leaving practice rows behind.

Anyone whose session was in the old sandbox lands back in the live workspace,
because `active_organization_id` is `ON DELETE SET NULL`. Out of practice mode
is the safe direction to fail.

## Reports exported from the sandbox

The sandbox organization is named `<Company> — Practice`, and every assembled
report puts the organization name in its header and basis of preparation. So an
exported practice report says so on its face without any extra code.

That is not a guarantee, it is a deterrent. If you intend people to practise
assembling disclosures, say plainly in training that nothing leaves the
practice workspace.

## Limits worth knowing

- **One sandbox per organization**, shared by everyone in it. A reset discards
  whatever a colleague was midway through, which is why it is admin-only.
- **Your role carries over.** A viewer practising is still a viewer. That keeps
  the rehearsal honest, at the cost of not being able to explore admin screens.
- **Users are not copied.** The team list is empty inside the sandbox, because
  no user rows belong to it. Your own profile is still visible — migration 032
  widened the users SELECT policy to include `id = auth.uid()`, without which
  the whole app renders as though nobody is signed in.
- **Suppliers invited from the sandbox would receive real email.** Practising
  the survey flow is safe as far as the data goes; leave `RESEND_API_KEY` unset
  in a training deployment if you would rather it could not send at all.
