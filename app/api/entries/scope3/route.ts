import { NextRequest, NextResponse } from 'next/server';
import { createScope3Entry, type Scope3EntryInput } from '@/lib/entries';

export async function POST(request: NextRequest) {
  let body: Partial<Scope3EntryInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const result = await createScope3Entry({
    categoryNumber: Number(body.categoryNumber),
    method: body.method as Scope3EntryInput['method'],
    activityValue: Number(body.activityValue),
    activityUnit: body.activityUnit ?? '',
    entryDate: body.entryDate ?? '',
    factorId: body.factorId,
    factorValue: body.factorValue != null ? Number(body.factorValue) : undefined,
    factorUnit: body.factorUnit,
    factorSource: body.factorSource,
    factorDataYear: body.factorDataYear != null ? Number(body.factorDataYear) : undefined,
    siteId: body.siteId,
    supplierId: body.supplierId,
    description: body.description,
    dataQuality: body.dataQuality,
    notes: body.notes,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ entry: result.data });
}
