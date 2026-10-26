import { describe, expect, it, vi } from 'vitest';
import { ensureCustomerNumberExtension, deleteCustomerNumberExtension, EXTENSION_KEY } from '../src/connector/actions.js';

function apiRootWith(existing: { version: number } | undefined) {
  const post = vi.fn(() => ({ execute: async () => ({ body: {} }) }));
  const del = vi.fn(() => ({ execute: async () => ({ body: {} }) }));
  const withKey = vi.fn(() => ({ post, delete: del }));
  const get = vi.fn(() => ({ execute: async () => ({ body: { results: existing ? [existing] : [] } }) }));
  return { apiRoot: { extensions: () => ({ get, post, withKey }) } as never, post, del };
}

describe('postDeploy registration', () => {
  it('creates the Extension on customer Create only, WITH authentication and a 2s timeout', async () => {
    const h = apiRootWith(undefined);
    await ensureCustomerNumberExtension(h.apiRoot, 'https://svc.commercetools.app/customer-number', 'sec');
    const body = h.post.mock.calls[0]![0]!.body;
    expect(body.key).toBe(EXTENSION_KEY);
    expect(body.triggers).toEqual([{ resourceTypeId: 'customer', actions: ['Create'] }]);
    expect(body.destination.authentication).toEqual({ type: 'AuthorizationHeader', headerValue: 'Bearer sec' });
    expect(body.timeoutInMs).toBe(2000);
  });

  it('UPDATES in place on a redeploy — never delete-then-recreate, which opens a gap window', async () => {
    const h = apiRootWith({ version: 7 });
    await ensureCustomerNumberExtension(h.apiRoot, 'https://x/customer-number', 'sec');
    expect(h.del).not.toHaveBeenCalled();
    const body = h.post.mock.calls[0]![0]!.body;
    expect(body.version).toBe(7);
    expect(body.actions.map((a: { action: string }) => a.action)).toEqual(['changeDestination', 'changeTriggers', 'setTimeoutInMs']);
  });
});

describe('preUndeploy teardown', () => {
  it('deletes the Extension with its version', async () => {
    const h = apiRootWith({ version: 3 });
    await deleteCustomerNumberExtension(h.apiRoot);
    expect(h.del).toHaveBeenCalledWith({ queryArgs: { version: 3 } });
  });

  it('is a no-op when it is already gone', async () => {
    const h = apiRootWith(undefined);
    await expect(deleteCustomerNumberExtension(h.apiRoot)).resolves.toBeUndefined();
    expect(h.del).not.toHaveBeenCalled();
  });
});
