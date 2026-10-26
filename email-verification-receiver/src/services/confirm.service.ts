import type { ByProjectKeyRequestBuilder } from '@commercetools/platform-sdk';

/**
 * POST /customers/email/confirm — the same call the BFF's task 5.8 makes. The token IS the proof: no
 * session, no version, no customer id. A wrong, expired or already-used token answers 400 from the
 * platform; we report `invalid` and never echo the platform's sentence to the browser (it names the
 * token's state, which is one more hint than a stranger holding a guessed link should get).
 */
export type ConfirmResult =
  | { ok: true; customerId: string }
  | { ok: false; reason: 'invalid' }
  /** The platform was unavailable: tell the shopper to try again, not that the link is bad. */
  | { ok: false; reason: 'unavailable' };

export async function confirmEmail(apiRoot: ByProjectKeyRequestBuilder, tokenValue: string): Promise<ConfirmResult> {
  try {
    const { body } = await apiRoot.customers().emailConfirm().post({ body: { tokenValue } }).execute();
    return { ok: true, customerId: body.id };
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== undefined && status >= 400 && status < 500 && status !== 429) return { ok: false, reason: 'invalid' };
    return { ok: false, reason: 'unavailable' };
  }
}
