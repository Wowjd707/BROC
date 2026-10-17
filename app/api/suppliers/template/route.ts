import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { buildSupplierTemplate } from '@/lib/supplier-template-xlsx';

/**
 * Download the bulk supplier template.
 *
 * Unlike the metrics templates this is the same file for everybody — there is
 * nothing to pre-populate it with, since the point is that these suppliers are
 * not on file yet. It still requires a signed-in user: the instructions sheet
 * describes how this deployment behaves, and there is no reason to serve it
 * anonymously.
 */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const buffer = await buildSupplierTemplate();

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="broc-supplier-template.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
