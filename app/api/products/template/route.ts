import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { buildProductTemplate } from '@/lib/product-template-xlsx';

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const buffer = await buildProductTemplate();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="broc-product-template.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
