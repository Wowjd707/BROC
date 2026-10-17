import { NextRequest, NextResponse } from 'next/server';
import { importEmissionCsv } from '@/lib/import';

// Guard against oversized uploads (server also streams into memory).
const MAX_CSV_BYTES = 2_000_000; // ~2 MB

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
    return NextResponse.json({ error: 'CSV exceeds the 2 MB limit.' }, { status: 413 });
  }

  const summary = await importEmissionCsv(csv);
  return NextResponse.json(summary);
}
