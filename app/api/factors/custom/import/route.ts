import { NextRequest, NextResponse } from 'next/server';
import { importCustomFactorCsv } from '@/lib/custom-factor-import';

const MAX_CSV_BYTES = 5_000_000; // ~5 MB

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
    return NextResponse.json({ error: 'CSV exceeds the 5 MB limit.' }, { status: 413 });
  }

  const summary = await importCustomFactorCsv(csv);
  return NextResponse.json(summary);
}
