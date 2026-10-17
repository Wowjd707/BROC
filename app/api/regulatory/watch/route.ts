import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { runRegulatoryWatch } from '@/lib/regulatory-watch';

/**
 * Start a regulatory watch run.
 *
 * Admin-only, and deliberately not a cron endpoint that anyone can hit: the run
 * makes outbound requests to two dozen government sites under the deployment's
 * IP and, when the AI layer is configured, spends the deployment's AI budget.
 *
 * A scheduled run reaches this same function through the deployment's own
 * scheduler (see docs/REGULATORY_CONTENT.md) with a service-role call, rather
 * than through an unauthenticated public route.
 */

// Fetching twenty-odd sources sequentially takes longer than the default.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single();

  // Approving a change edits reference data every user of this deployment
  // reads, so running the watch is an admin action rather than an editor one.
  if (profile?.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only an admin can run the regulatory watch.' },
      { status: 403 },
    );
  }

  let body: { itemCode?: string } = {};
  try {
    body = await request.json();
  } catch {
    // An empty body means "check everything", which is the normal case.
  }

  try {
    const summary = await runRegulatoryWatch({
      triggeredBy: user.id,
      triggerKind: 'manual',
      onlyItemCode: typeof body.itemCode === 'string' ? body.itemCode : undefined,
    });
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The watch run failed.' },
      { status: 500 },
    );
  }
}
