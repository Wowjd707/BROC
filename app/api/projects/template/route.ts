import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { buildProjectTemplate } from '@/lib/project-template-xlsx';

/**
 * Download the bulk project template.
 *
 * Generated per request so Site and Goal are dropdowns of what you already have.
 * A project's value is being attached to both, and a free-typed name that
 * matches neither leaves it attached to nothing. Both reads are RLS-scoped.
 */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const [{ data: sites }, { data: goals }] = await Promise.all([
    supabase.from('sites').select('name').eq('is_active', true).order('name'),
    supabase.from('goals').select('name').order('name'),
  ]);

  const buffer = await buildProjectTemplate(sites ?? [], goals ?? []);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="broc-project-template.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
