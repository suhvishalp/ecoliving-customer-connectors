import type { ByProjectKeyRequestBuilder } from '@commercetools/platform-sdk';
import { logger } from '../utils/logger.utils.js';

/**
 * A sequence, on a platform that does not offer one: a Custom Object `{ next: n }`, advanced with the
 * platform's own optimistic concurrency. Two sign-ups in the same instant both read `next: 42`; the
 * first write (version 7 → 8) succeeds, the second gets a 409, re-reads `43` and writes `44`. Exactly
 * one retry, because the Extension budget is 2 seconds and each attempt is a read plus a write: two
 * attempts spend a safe fraction of it, a loop could spend all of it.
 */
export const COUNTER_CONTAINER = 'ecoliving-counters';
export const COUNTER_KEY = 'customer-number';

interface Counter {
  next: number;
  version: number | undefined;
}

export async function nextNumber(apiRoot: ByProjectKeyRequestBuilder): Promise<number> {
  let attempt = 0;
  for (;;) {
    const counter = await readCounter(apiRoot);
    try {
      await apiRoot
        .customObjects()
        .post({
          body: {
            container: COUNTER_CONTAINER,
            key: COUNTER_KEY,
            value: { next: counter.next + 1 },
            ...(counter.version !== undefined ? { version: counter.version } : {}),
          },
        })
        .execute();
      return counter.next;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 409 && attempt === 0) {
        attempt += 1;
        logger.debug('Counter moved under us — one retry', { container: COUNTER_CONTAINER, key: COUNTER_KEY });
        continue;
      }
      throw error;
    }
  }
}

/** Absent means "never allocated": start at 1. Created without a version, like any first write. */
async function readCounter(apiRoot: ByProjectKeyRequestBuilder): Promise<Counter> {
  try {
    const { body } = await apiRoot
      .customObjects()
      .withContainerAndKey({ container: COUNTER_CONTAINER, key: COUNTER_KEY })
      .get()
      .execute();
    const next = (body.value as { next?: unknown })?.next;
    return { next: typeof next === 'number' && next > 0 ? next : 1, version: body.version };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) return { next: 1, version: undefined };
    throw error;
  }
}
