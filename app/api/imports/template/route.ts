import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { buildImportTemplate } from '@/lib/import-template-xlsx';
import { FAMILY_COLUMNS, type EntryFamily } from '@/lib/staged-import-core';

/**
 * Download the bulk-import template for one family.
 *
 * Generated per request rather than served as a static file, because the point
 * of the workbook is that its dropdowns hold THIS organization's sites and
 * metric catalog. A file in the repository could only offer a generic list,
 * which is the one people paste over.
 */
export async function GET(request: NextRequest) {
  const family = request.nextUrl.searchParams.get('family') as EntryFamily | null;
  if (!family || !(family in FAMILY_COLUMNS)) {
    return NextResponse.json({ error: 'Unknown import family.' }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  // Both reads are RLS-scoped, so the template can only ever contain sites the
  // caller may post to.
  const { data: sites } = await supabase
    .from('sites').select('name').eq('is_active', true).order('name');

  const { data: metrics } = await supabase
    .from('sustainability_metrics')
    .select('metric_type, source_type, label, canonical_unit, aggregation')
    .eq('is_active', true);

  const buffer = await buildImportTemplate(
    family,
    sites ?? [],
    (metrics ?? []).map((m) => ({
      metricType: m.metric_type,
      sourceType: m.source_type,
      label: m.label,
      canonicalUnit: m.canonical_unit,
      aggregation: m.aggregation as 'sum' | 'point_in_time' | 'average',
    })),
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="broc-${family}-import-template.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
