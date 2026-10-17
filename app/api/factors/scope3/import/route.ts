import { NextRequest, NextResponse } from 'next/server';
import { importScope3FactorCsv } from '@/lib/factor-import';

// Factor libraries are large; allow more than the activity-data importer.
const MAX_CSV_BYTES = 10_000_000; // ~10 MB

export async function POST(request: NextRequest) {
  let body: { csv?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const csv = body.csv;
  if (typeof csv !== 'string' || csv.trim() === '') {
    return NextResponse.json({ error: 'No CSV content provided.' }, { status: 400 });
  }
  if (csv.length > MAX_CSV_BYTES) {
    return NextResponse.json({ error: 'CSV exceeds the 10 MB limit.' }, { status: 413 });
  }

  const summary = await importScope3FactorCsv(csv);
  return NextResponse.json(summary);
}
