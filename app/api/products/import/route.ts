import { NextRequest, NextResponse } from 'next/server';
import { importProductFile } from '@/lib/product-import';

const MAX_CSV_BYTES = 4_000_000;
const MAX_WORKBOOK_BYTES = 12_000_000;

/** Bulk create or refresh products from a CSV or the product template. */
export async function POST(request: NextRequest) {
  let body: { csv?: string; workbook?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (typeof body.workbook === 'string' && body.workbook !== '') {
    if (body.workbook.length > MAX_WORKBOOK_BYTES) {
      return NextResponse.json({ error: 'That spreadsheet exceeds the size limit.' }, { status: 413 });
    }
    const result = await importProductFile({ kind: 'xlsx', buffer: Buffer.from(body.workbook, 'base64') });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data);
  }

  if (typeof body.csv !== 'string' || body.csv.trim() === '') {
    return NextResponse.json({ error: 'No file content provided.' }, { status: 400 });
  }
  if (body.csv.length > MAX_CSV_BYTES) {
    return NextResponse.json({ error: 'CSV exceeds the size limit.' }, { status: 413 });
  }
  const result = await importProductFile({ kind: 'csv', text: body.csv });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
