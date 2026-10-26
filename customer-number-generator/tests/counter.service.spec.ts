import { describe, expect, it, vi } from 'vitest';
import { COUNTER_CONTAINER, COUNTER_KEY, nextNumber } from '../src/services/counter.service.js';

/** A fake Custom Object store with real optimistic concurrency, so the 409 path is exercised honestly. */
function store(initial: { next: number; version: number } | undefined, conflictOnce = false) {
  let state = initial;
  let conflicts = conflictOnce ? 1 : 0;
  const post = vi.fn((args: { body: { value: { next: number }; version?: number } }) => ({
    execute: async () => {
      if (state && args.body.version !== state.version) throw Object.assign(new Error('409'), { statusCode: 409 });
      if (conflicts > 0) {
        conflicts -= 1;
        state = { next: state!.next + 1, version: state!.version + 1 }; // someone else got there first
        throw Object.assign(new Error('409'), { statusCode: 409 });
      }
      state = { next: args.body.value.next, version: (state?.version ?? 0) + 1 };
      return { body: {} };
    },
  }));
  const get = vi.fn(() => ({
    execute: async () => {
      if (!state) throw Object.assign(new Error('404'), { statusCode: 404 });
      return { body: { value: { next: state.next }, version: state.version } };
    },
  }));
  const withContainerAndKey = vi.fn((k: { container: string; key: string }) => {
    expect(k).toEqual({ container: COUNTER_CONTAINER, key: COUNTER_KEY });
    return { get };
  });
  return { apiRoot: { customObjects: () => ({ post, withContainerAndKey }) } as never, post, get, state: () => state };
}

describe('the counter — a sequence on a platform without one', () => {
  it('starts at 1 when the Custom Object does not exist yet, and creates it', async () => {
    const s = store(undefined);
    expect(await nextNumber(s.apiRoot)).toBe(1);
    expect(s.post.mock.calls[0]![0]!.body).toMatchObject({ container: COUNTER_CONTAINER, key: COUNTER_KEY, value: { next: 2 } });
    expect(s.post.mock.calls[0]![0]!.body).not.toHaveProperty('version');
  });

  it('returns the current value and advances it with the version', async () => {
    const s = store({ next: 42, version: 7 });
    expect(await nextNumber(s.apiRoot)).toBe(42);
    expect(s.post.mock.calls[0]![0]!.body).toMatchObject({ value: { next: 43 }, version: 7 });
    expect(s.state()).toEqual({ next: 43, version: 8 });
  });

  it('retries ONCE on a 409 and never hands out the number someone else took', async () => {
    const s = store({ next: 42, version: 7 }, true);
    expect(await nextNumber(s.apiRoot)).toBe(43);
    expect(s.post).toHaveBeenCalledTimes(2);
  });

  it('gives up after the second 409 — the Extension budget is 2 seconds, not a loop', async () => {
    const post = vi.fn(() => ({ execute: async () => { throw Object.assign(new Error('409'), { statusCode: 409 }); } }));
    const get = vi.fn(() => ({ execute: async () => ({ body: { value: { next: 1 }, version: 1 } }) }));
    const apiRoot = { customObjects: () => ({ post, withContainerAndKey: () => ({ get }) }) } as never;
    await expect(nextNumber(apiRoot)).rejects.toThrow('409');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('propagates anything that is not a 409 — the controller decides to fail open', async () => {
    const get = vi.fn(() => ({ execute: async () => { throw Object.assign(new Error('503'), { statusCode: 503 }); } }));
    const apiRoot = { customObjects: () => ({ post: vi.fn(), withContainerAndKey: () => ({ get }) }) } as never;
    await expect(nextNumber(apiRoot)).rejects.toThrow('503');
  });
});
