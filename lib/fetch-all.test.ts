import { describe, it, expect } from 'vitest';
import { fetchAll } from './fetch-all';

/** A fake table that serves `total` rows the way PostgREST would, capped per request. */
function fakeTable(total: number, cap = 1000) {
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to, from + cap - 1, total - 1);
    const data = from > end ? [] : Array.from({ length: end - from + 1 }, (_, i) => ({ id: from + i }));
    return { data, error: null };
  };
  return { page, calls };
}

describe('fetchAll', () => {
  it('reads past the 1,000-row cap a plain select stops at', async () => {
    // Regression: totals were built from the first 1,000 rows only.
    const t = fakeTable(2_500);
    const { data, error } = await fetchAll(t.page);
    expect(error).toBeNull();
    expect(data).toHaveLength(2_500);
    expect(new Set(data.map((r) => r.id)).size).toBe(2_500);
    expect(t.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('makes one request when everything fits in a page', async () => {
    const t = fakeTable(40);
    expect((await fetchAll(t.page)).data).toHaveLength(40);
    expect(t.calls).toHaveLength(1);
  });

  it('asks for the page after an exactly full one, and stops on the empty reply', async () => {
    const t = fakeTable(2_000);
    expect((await fetchAll(t.page)).data).toHaveLength(2_000);
    expect(t.calls).toHaveLength(3);
  });

  it('returns the error and the rows read so far', async () => {
    let n = 0;
    const page = async () => {
      n++;
      return n === 1
        ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }
        : { data: null, error: { message: 'boom' } };
    };
    const r = await fetchAll(page);
    expect(r.error?.message).toBe('boom');
    expect(r.data).toHaveLength(1000);
  });
});
