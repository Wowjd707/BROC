import { redirect } from 'next/navigation';

/**
 * Emission factors moved under Data Entry — they are part of how a number is
 * calculated, not a destination of their own, and a top-level nav slot for them
 * implied otherwise.
 *
 * This stub stays so bookmarks and any internal documentation written against
 * the old path keep working. It is a permanent redirect, not a temporary one:
 * the route is not coming back.
 */
export default function FactorsRedirect() {
  redirect('/data/factors');
}
