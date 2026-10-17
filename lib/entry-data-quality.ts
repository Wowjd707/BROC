/**
 * How a single entry's figure was obtained.
 *
 * Deliberately NOT the same thing as the Scope 3 data-quality tier in
 * `scope3.ts` ('primary' | 'secondary' | 'estimated'), which grades how close a
 * value-chain factor sits to the reporting entity. These two answer different
 * assurance questions and must not be merged just because they share a name:
 * this one records the provenance of one reading, and it mirrors the CHECK
 * constraint migration 029 puts on both `emission_entries.data_quality` and
 * `ehs_entries.data_quality`.
 *
 * Lives in lib/ rather than beside the picker because both the server entry
 * path (`lib/entries.ts`, which is server-only) and the client drawers need it,
 * and a domain type should not be owned by a component.
 */
export const ENTRY_DATA_QUALITY = ['measured', 'calculated', 'estimated'] as const;

export type EntryDataQuality = (typeof ENTRY_DATA_QUALITY)[number];

/**
 * Runtime guard. The API routes hand these functions parsed JSON, so the value
 * is genuinely unknown at that boundary however it is typed upstream.
 */
export function isEntryDataQuality(value: unknown): value is EntryDataQuality {
  return typeof value === 'string'
    && (ENTRY_DATA_QUALITY as readonly string[]).includes(value);
}
