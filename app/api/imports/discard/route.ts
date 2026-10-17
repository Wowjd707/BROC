import { NextRequest, NextResponse } from 'next/server';
import { discardBatch } from '@/lib/staged-import';

export async function POST(request: NextRequest) {
  let body: { batchId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.batchId) {
    return NextResponse.json({ error: 'batchId is required.' }, { status: 400 });
  }

  const result = await discardBatch(body.batchId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
