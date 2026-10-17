import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { buildSiteTemplate } from '@/lib/site-template-xlsx';

/**
 * Download the bulk site template.
 *
 * Generated per request because the Business Unit dropdown holds the units this
 * organization has actually defined. The read is RLS-scoped, so the file can
 * only ever name units the caller can already see.
 */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const { data: units } = await supabase
    .from('business_units').select('name').order('name');

  const buffer = await buildSiteTemplate(units ?? []);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="broc-site-template.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
