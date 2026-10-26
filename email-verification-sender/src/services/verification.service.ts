import type { Configuration } from '../utils/config.utils.js';
import type { PlatformMessage } from './envelope.service.js';
import type { CallResult, CustomerSnapshot, IssuedToken } from './customer.service.js';
import type { VerificationMail } from './outbox.service.js';

/**
 * The decision logic — what the BFF's task 5.8 did on demand, now done by the platform's own event
 * stream the moment a customer exists.
 *
 * WHY A SUBSCRIPTION, when the customer-number app next door is an API Extension: sending a mail is a
 * side effect AFTER the save, and it needs the customer's id, which an Extension on Create does not
 * have yet. A Subscription delivers CustomerCreated with that id, at least once, in no particular
 * order, with no condition — so the handler filters, re-reads, and makes the effect idempotent.
 *
 * Idempotency has a small state here, unlike the order handler: the outbox entry records the message
 * that produced it, so a redelivered CustomerCreated does not mail a second link. A second message
 * (CustomerEmailChanged) DOES: the address changed, the old link must die.
 */
export type Outcome =
  /** Acknowledge (2xx): the queue discards the message. */
  | { ack: true; detail: string }
  /** Fail (anything else): the platform redelivers, for up to 7 days. */
  | { ack: false; detail: string };

export interface Deps {
  config: Pick<Configuration, 'storefrontUrl' | 'tokenTtlMinutes' | 'maxMessageAgeHours' | 'verifyLinkMode' | 'receiverUrl'>;
  loadCustomer(customerId: string): Promise<CustomerSnapshot | null>;
  createToken(customerId: string, ttlMinutes: number): Promise<CallResult<IssuedToken>>;
  readOutbox(customerId: string): Promise<VerificationMail | null>;
  writeOutbox(mail: VerificationMail): Promise<CallResult<void>>;
  deliver(mail: VerificationMail): Promise<void>;
  now?(): Date;
}

/** Only these reach the handler; the Subscription asks for no others. */
export const HANDLED_TYPES = ['CustomerCreated', 'CustomerEmailChanged'] as const;

export async function handleMessage(message: PlatformMessage, deps: Deps): Promise<Outcome> {
  // A Subscription has NO condition — the queue delivers everything the Subscription asked for and
  // filtering is the handler's job. This also catches the platform's own test notification.
  if (!HANDLED_TYPES.includes(message.type as (typeof HANDLED_TYPES)[number])) {
    return { ack: true, detail: `type ${message.type} is not handled` };
  }

  // A backlog guard. A verification link mailed three days late, to an address the shopper may already
  // have verified from the account page, is worse than no mail and a log line.
  const ageHours = messageAgeHours(message, deps.now?.() ?? new Date());
  if (ageHours !== undefined && ageHours > deps.config.maxMessageAgeHours) {
    return { ack: true, detail: `message is ${Math.round(ageHours)}h old (limit ${deps.config.maxMessageAgeHours}h) — dropped` };
  }

  const customerId = message.resource?.id;
  if (!customerId) return { ack: true, detail: 'message carries no customer reference' };

  // Re-fetch by id rather than trusting the payload: it may be stale, and when the message exceeded the
  // queue's size limit the fields are replaced by `payloadNotIncluded` and simply are not there.
  const customer = await deps.loadCustomer(customerId);
  if (!customer) return { ack: true, detail: `customer ${customerId} not found — dropped` };
  if (customer.isEmailVerified) {
    return { ack: true, detail: `${customer.email} is already verified — nothing to send` };
  }

  // The idempotency check: did THIS message already produce a mail? A redelivery must not mail twice.
  const previous = await deps.readOutbox(customerId);
  if (previous?.messageId === message.id) {
    return { ack: true, detail: `link already sent for message ${message.id}` };
  }

  const token = await deps.createToken(customerId, deps.config.tokenTtlMinutes);
  if (!token.ok) return classify(token, 'token');

  const mail: VerificationMail = {
    customerId,
    email: customer.email,
    kind: 'email-verification',
    tokenValue: token.value.value,
    link: buildLink(deps.config, token.value.value),
    expiresAt: token.value.expiresAt,
    createdAt: (deps.now?.() ?? new Date()).toISOString(),
    messageId: message.id,
  };

  const written = await deps.writeOutbox(mail);
  if (!written.ok) return classify(written, 'outbox');

  // The provider hook. A transient delivery failure throws and nacks; the token already exists, and a
  // redelivery finds the outbox entry for this message and stops — so the provider is retried by the
  // NEXT message, not this one. That is the honest limit of at-least-once with two effects.
  await deps.deliver(mail);
  return { ack: true, detail: `verification link sent to ${customer.email} (${message.type})` };
}

/**
 * Where the link lands. `storefront`: the page reads `?token=` and its BFF confirms (task 5.8).
 * `connector`: the receiver app confirms and redirects — for a storefront that has no BFF (the CIL track).
 */
export function buildLink(config: Deps['config'], tokenValue: string): string {
  const token = encodeURIComponent(tokenValue);
  if (config.verifyLinkMode === 'connector') {
    return `${config.receiverUrl}/email-verification-confirm?token=${token}`;
  }
  return `${config.storefrontUrl}/verify-email?token=${token}`;
}

function classify(result: { ok: false; permanent: boolean; detail: string }, step: string): Outcome {
  if (result.permanent) return { ack: true, detail: `${step} refused permanently: ${result.detail}` };
  return { ack: false, detail: `${step} transient failure: ${result.detail}` };
}

function messageAgeHours(message: PlatformMessage, now: Date): number | undefined {
  if (!message.createdAt) return undefined;
  const created = Date.parse(message.createdAt);
  if (Number.isNaN(created)) return undefined;
  return (now.getTime() - created) / 3_600_000;
}
