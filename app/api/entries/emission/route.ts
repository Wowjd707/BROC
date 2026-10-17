import { NextRequest, NextResponse } from 'next/server';
import { createEmissionEntry, type EmissionEntryInput } from '@/lib/entries';

export async function POST(request: NextRequest) {
  let body: Partial<EmissionEntryInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const result = await createEmissionEntry({
    siteId: body.siteId ?? '',
    scope: body.scope as EmissionEntryInput['scope'],
    sourceType: body.sourceType ?? '',
    scope1Category: body.scope1Category,
    refrigerantCode: body.refrigerantCode,
    quantity: Number(body.quantity),
    unit: body.unit ?? '',
    entryDate: body.entryDate ?? '',
    accountingMethod: body.accountingMethod,
    instrumentType: body.instrumentType,
    supplierFactor: body.supplierFactor != null ? Number(body.supplierFactor) : undefined,
    dataQuality: body.dataQuality,
    estimationMethod: body.estimationMethod,
    notes: body.notes,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ entry: result.data });
}
