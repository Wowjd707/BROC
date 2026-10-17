import { NextRequest, NextResponse } from 'next/server';
import { createEhsEntry, type EhsEntryInput } from '@/lib/entries';

export async function POST(request: NextRequest) {
  let body: Partial<EhsEntryInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const result = await createEhsEntry({
    // Left undefined rather than '' so an entity-level governance metric is
    // not rejected for a missing site it is not supposed to have.
    siteId: body.siteId || undefined,
    metricType: body.metricType as EhsEntryInput['metricType'],
    sourceType: body.sourceType ?? '',
    quantity: Number(body.quantity),
    unit: body.unit ?? '',
    entryDate: body.entryDate ?? '',
    notes: body.notes,
    dataQuality: body.dataQuality,
    estimationMethod: body.estimationMethod,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ entry: result.data });
}
