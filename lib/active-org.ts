/**
 * Which organization a page should describe.
 *
 * Migration 032 made a sandbox "just another organization", and a session
 * resolves to it through `auth_org_id() = COALESCE(active_organization_id,
 * organization_id)`. Every RLS policy funnels through that function, so in
 * practice mode the ROWS a page receives are the sandbox's.
 *
 * The organization record itself does not arrive that way: it is embedded over
 * a foreign key, and `users` now has two of them pointing at `organizations`.
 * Following `organization_id` would therefore label sandbox data with the live
 * organization's name and reporting year — the reporting misstatement this
 * helper exists to prevent. Pages select BOTH embeds and resolve them here, so
 * the heading always names the workspace the data actually came from.
 *
 * The embed is also ambiguous to PostgREST until each side is hinted with its
 * constraint name, so the two-embed select is required regardless:
 *
 *   organizations!users_organization_id_fkey(...),
 *   active_organization:organizations!users_active_organization_id_fkey(...)
 */
export function activeOrg<T>(
  profile: {
    organizations?: T | null;
    active_organization?: T | null;
  } | null | undefined,
): T | null {
  return profile?.active_organization ?? profile?.organizations ?? null;
}
