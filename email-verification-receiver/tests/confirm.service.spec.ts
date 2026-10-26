import { describe, expect, it, vi } from 'vitest';
import { confirmEmail } from '../src/services/confirm.service.js';

const apiRootThat = (behaviour: () => Promise<unknown>) =>
  ({ customers: () => ({ emailConfirm: () => ({ post: vi.fn(() => ({ execute: behaviour })) }) }) }) as never;

describe('confirming the token — the token is the proof', () => {
  it('reports the customer id on success', async () => {
    const r = await confirmEmail(apiRootThat(async () => ({ body: { id: 'c1' } })), 'tok');
    expect(r).toEqual({ ok: true, customerId: 'c1' });
  });

  it('reports invalid on a 4xx — wrong, expired or already used, without saying which', async () => {
    const r = await confirmEmail(apiRootThat(async () => { throw Object.assign(new Error('expired'), { statusCode: 400 }); }), 'tok');
    expect(r).toEqual({ ok: false, reason: 'invalid' });
  });

  it.each([429, 500, 503, undefined])('reports unavailable on %s — the shopper should try again, the link is fine', async (status) => {
    const r = await confirmEmail(apiRootThat(async () => { throw Object.assign(new Error('x'), status === undefined ? {} : { statusCode: status }); }), 'tok');
    expect(r).toEqual({ ok: false, reason: 'unavailable' });
  });
});
