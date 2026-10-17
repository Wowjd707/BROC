import { NextRequest, NextResponse } from 'next/server';
import { applyRowEdit } from '@/lib/staged-import';

export async function POST(request: NextRequest) {
  let body: { rowId?: string; field?: string; value?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.rowId || !body.field) {
    return NextResponse.json({ error: 'rowId and field are required.' }, { status: 400 });
  }

  const result = await applyRowEdit(body.rowId, body.field, body.value ?? null);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
}
