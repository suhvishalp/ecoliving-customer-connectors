import type { ByProjectKeyRequestBuilder } from '@commercetools/platform-sdk';
import { logger } from '../utils/logger.utils.js';
import { failure, statusOf, type CallResult } from './customer.service.js';

/**
 * The mail "outbox" — the course's stand-in for a mail provider.
 *
 * The training project has no SendGrid, no SES, no SMTP. Instead of pretending, the connector writes
 * the mail it WOULD have sent into a Custom Object, one per customer, and the BFF's account page reads
 * it back to show the link (task 5.8). Everything else — the Subscription, the token, the link, the
 * idempotency — is exactly what production does; only the last hop is a Custom Object instead of an
 * SMTP call. That last hop is `deliver()`, below, and it is the one function you replace.
 */
export const OUTBOX_CONTAINER = 'ecoliving-mail-outbox';

export interface VerificationMail {
  customerId: string;
  email: string;
  kind: 'email-verification';
  tokenValue: string;
  link: string;
  expiresAt: string;
  createdAt: string;
  /** The message that caused this mail — the idempotency key for a redelivery. */
  messageId: string;
}

export async function readOutbox(
  apiRoot: ByProjectKeyRequestBuilder,
  customerId: string
): Promise<VerificationMail | null> {
  try {
    const { body } = await apiRoot
      .customObjects()
      .withContainerAndKey({ container: OUTBOX_CONTAINER, key: customerId })
      .get()
      .execute();
    return body.value as VerificationMail;
  } catch (error) {
    if (statusOf(error) === 404) return null;
    throw error;
  }
}

/** Upsert: one outbox entry per customer; a new link replaces the old one, as a real inbox would show. */
export async function writeOutbox(
  apiRoot: ByProjectKeyRequestBuilder,
  mail: VerificationMail
): Promise<CallResult<void>> {
  try {
    await apiRoot
      .customObjects()
      .post({ body: { container: OUTBOX_CONTAINER, key: mail.customerId, value: mail } })
      .execute();
    return { ok: true, value: undefined };
  } catch (error) {
    return failure(error);
  }
}

/**
 * >>> THE PROVIDER HOOK <<<
 *
 * In production this is the SendGrid / SES / SMTP call: `to: mail.email`, a template with `mail.link`.
 * Here it logs the link at info level, so a trainer can also pick it out of the Connect logs. Keep the
 * contract if you replace it: throw on a transient failure (the message is redelivered), never on a
 * permanent one (log it and return — a bounced address will bounce again tomorrow).
 */
export async function deliver(mail: VerificationMail): Promise<void> {
  logger.info('Verification mail "sent" (outbox stand-in — replace deliver() with a mail provider)', {
    to: mail.email,
    link: mail.link,
    expiresAt: mail.expiresAt,
  });
}
