import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { buildGoalTemplate } from '@/lib/goal-template-xlsx';

/**
 * Download the bulk goal template.
 *
 * The same file for everybody: its dropdowns are vocabularies, not your data.
 * Still requires a signed-in user, because the instructions sheet describes how
 * this deployment derives an SBTi target.
 */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const buffer = await buildGoalTemplate();

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="broc-goal-template.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
