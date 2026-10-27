/**
 * Read every row a query matches, a page at a time.
 *
 * Supabase (PostgREST) returns at most `db-max-rows` rows per request — 1,000
 * on a new Supabase project — and says nothing when it stops. A plain
 * `.select()` used for a total is therefore correct for a small organization
 * and silently wrong for a large one: fifty sites reporting five sources a
 * month is 3,000 entries a year, and every total built from the first 1,000
 * would understate the inventory by two thirds.
 *
 * Every query whose rows are summed, exported or analysed goes through this.
 * The caller supplies a function that builds the query for one page and must
 * give it a stable order (`.order('id')`), or rows can repeat or go missing
 * between pages.
 *
 * I/O-free apart from the page function, so it is unit-testable.
 */

export const PAGE_SIZE = 1000;

/** A safety stop: 500 pages is 500,000 rows from one query. */
const MAX_PAGES = 500;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function fetchAll<T>(
  page: (from: number, to: number) => PageResult<T>,
  pageSize: number = PAGE_SIZE,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * pageSize;
    const { data, error } = await page(from, from + pageSize - 1);
    // Partial results are worse than none for a total, so an error returns
    // what was read alongside the error and lets the caller decide.
    if (error) return { data: rows, error };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return { data: rows, error: null };
  }
  return {
    data: rows,
    error: { message: `Stopped after ${MAX_PAGES} pages (${rows.length} rows); results are incomplete.` },
  };
}
