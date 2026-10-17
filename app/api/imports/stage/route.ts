import { NextRequest, NextResponse } from 'next/server';
import { createStagedBatch, createStagedBatchFromWorkbook } from '@/lib/staged-import';
import { FAMILY_COLUMNS, type EntryFamily } from '@/lib/staged-import-core';

// Matches the previous activity-data importer. Staging holds the whole file in
// memory before writing, so the ceiling is the same one.
const MAX_CSV_BYTES = 2_000_000;
// Base64 inflates by about a third, and a workbook carries styles and lists
// a CSV does not, so it gets its own larger ceiling.
const MAX_WORKBOOK_BYTES = 8_000_000;

export async function POST(request: NextRequest) {
  let body: { family?: string; filename?: string; csv?: string; workbook?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const family = body.family as EntryFamily | undefined;
  if (!family || !(family in FAMILY_COLUMNS)) {
    return NextResponse.json(
      { error: `Unknown import family "${body.family ?? ''}".` },
      { status: 400 },
    );
  }

  // A filled-in .xlsx arrives base64-encoded so the route keeps one JSON shape.
  // Both paths converge on the same staged rows.
  const workbook = body.workbook;
  if (typeof workbook === 'string' && workbook !== '') {
    if (workbook.length > MAX_WORKBOOK_BYTES) {
      return NextResponse.json({ error: 'That spreadsheet exceeds the 8 MB limit.' }, { status: 413 });
    }
    const result = await createStagedBatchFromWorkbook(
      family, body.filename ?? null, Buffer.from(workbook, 'base64'),
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data);
  }

  const csv = body.csv;
  if (typeof csv !== 'string' || csv.trim() === '') {
    return NextResponse.json({ error: 'No file content provided.' }, { status: 400 });
  }
  if (csv.length > MAX_CSV_BYTES) {
    return NextResponse.json({ error: 'CSV exceeds the 2 MB limit.' }, { status: 413 });
  }

  const result = await createStagedBatch(family, body.filename ?? null, csv);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
}
