import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { buildBusinessUnitTemplate } from '@/lib/business-unit-template-xlsx';

/**
 * Download the bulk business-unit template.
 *
 * Generated per request so the Parent Unit dropdown can offer the units this
 * organization already has. The read is RLS-scoped, so the file can only name
 * units the caller can already see.
 */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const { data: units } = await supabase
    .from('business_units').select('name').order('name');

  const buffer = await buildBusinessUnitTemplate(units ?? []);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="broc-business-unit-template.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
