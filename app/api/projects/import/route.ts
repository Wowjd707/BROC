import { NextRequest, NextResponse } from 'next/server';
import { importProjectFile } from '@/lib/project-import';

const MAX_CSV_BYTES = 2_000_000;
const MAX_WORKBOOK_BYTES = 8_000_000;

export async function POST(request: NextRequest) {
  let body: { csv?: string; workbook?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const workbook = body.workbook;
  if (typeof workbook === 'string' && workbook !== '') {
    if (workbook.length > MAX_WORKBOOK_BYTES) {
      return NextResponse.json({ error: 'That spreadsheet exceeds the 8 MB limit.' }, { status: 413 });
    }
    const result = await importProjectFile({ kind: 'xlsx', buffer: Buffer.from(workbook, 'base64') });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data);
  }

  const csv = body.csv;
  if (typeof csv !== 'string' || csv.trim() === '') {
    return NextResponse.json({ error: 'No file content provided.' }, { status: 400 });
  }
  if (csv.length > MAX_CSV_BYTES) {
    return NextResponse.json({ error: 'CSV exceeds the 2 MB limit.' }, { status: 413 });
  }

  const result = await importProjectFile({ kind: 'csv', text: csv });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
