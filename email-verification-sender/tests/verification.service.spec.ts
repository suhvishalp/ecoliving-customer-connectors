import { describe, expect, it, vi } from 'vitest';
import { buildLink, handleMessage, type Deps } from '../src/services/verification.service.js';
import type { PlatformMessage } from '../src/services/envelope.service.js';
import type { CustomerSnapshot } from '../src/services/customer.service.js';
import type { VerificationMail } from '../src/services/outbox.service.js';

const ADA: CustomerSnapshot = { id: 'c1', version: 2, email: 'ada@lhc.test', isEmailVerified: false };
const CONFIG = {
  storefrontUrl: 'http://localhost:3000',
  tokenTtlMinutes: 4320,
  maxMessageAgeHours: 72,
  verifyLinkMode: 'storefront' as const,
};

const deps = (over: Partial<Deps> = {}) => {
  const createToken = vi.fn(async () => ({ ok: true, value: { value: 'tok-123', expiresAt: '2026-09-28T12:00:00Z' } }) as const);
  const writeOutbox = vi.fn(async () => ({ ok: true, value: undefined }) as const);
  const deliver = vi.fn(async () => undefined);
  const loadCustomer = vi.fn(async () => ADA as CustomerSnapshot | null);
  const readOutbox = vi.fn(async () => null as VerificationMail | null);
  return {
    config: CONFIG,
    loadCustomer,
    createToken,
    readOutbox,
    writeOutbox,
    deliver,
    now: () => new Date('2026-09-25T12:00:00Z'),
    ...over,
  } as Deps & {
    createToken: typeof createToken; writeOutbox: typeof writeOutbox; deliver: typeof deliver;
    loadCustomer: typeof loadCustomer; readOutbox: typeof readOutbox;
  };
};

const created = (over: Partial<PlatformMessage> = {}): PlatformMessage => ({
  id: 'm1',
  type: 'CustomerCreated',
  createdAt: '2026-09-25T11:59:00Z',
  sequenceNumber: 1,
  resource: { typeId: 'customer', id: 'c1' },
  ...over,
});

describe('what the handler acts on', () => {
  it('issues a token, writes the outbox and delivers — then acknowledges', async () => {
    const d = deps();
    const out = await handleMessage(created(), d);
    expect(out).toEqual({ ack: true, detail: 'verification link sent to ada@lhc.test (CustomerCreated)' });
    expect(d.createToken).toHaveBeenCalledWith('c1', 4320);
    const mail = d.writeOutbox.mock.calls[0]![0]!;
    expect(mail).toMatchObject({
      customerId: 'c1', email: 'ada@lhc.test', kind: 'email-verification', tokenValue: 'tok-123', messageId: 'm1',
      link: 'http://localhost:3000/verify-email?token=tok-123',
    });
    expect(d.deliver).toHaveBeenCalledWith(mail);
  });

  it('sends a fresh link when the address changes — the old link must die', async () => {
    const d = deps({ readOutbox: vi.fn(async () => ({ messageId: 'm1' }) as VerificationMail) });
    const out = await handleMessage(created({ id: 'm2', type: 'CustomerEmailChanged', email: 'ada@new.test' }), d);
    expect(out.ack).toBe(true);
    expect(d.createToken).toHaveBeenCalledTimes(1);
  });

  it('acknowledges message types it did not subscribe to — including the platform test notification', async () => {
    const d = deps();
    for (const type of ['CustomerDeleted', 'ResourceCreated', 'SubscriptionTest']) {
      expect((await handleMessage(created({ type }), d)).ack).toBe(true);
    }
    expect(d.createToken).not.toHaveBeenCalled();
  });

  it('sends nothing to an address that is already verified', async () => {
    const d = deps({ loadCustomer: vi.fn(async () => ({ ...ADA, isEmailVerified: true })) });
    const out = await handleMessage(created(), d);
    expect(out.ack).toBe(true);
    expect(out.detail).toContain('already verified');
    expect(d.createToken).not.toHaveBeenCalled();
  });
});

describe('idempotency — the outbox remembers which message produced the link', () => {
  it('a redelivery of the identical message does not mail twice', async () => {
    const sent: VerificationMail[] = [];
    const d = deps({
      readOutbox: vi.fn(async () => sent[0] ?? null),
      writeOutbox: vi.fn(async (mail: VerificationMail) => { sent[0] = mail; return { ok: true, value: undefined } as const; }),
    });
    await handleMessage(created(), d);
    const second = await handleMessage(created(), d);
    expect(second.detail).toContain('already sent for message m1');
    expect(d.createToken).toHaveBeenCalledTimes(1);
    expect(d.deliver).toHaveBeenCalledTimes(1);
  });

  it('re-fetches by id rather than trusting the payload (payloadNotIncluded is survivable)', async () => {
    const d = deps();
    await handleMessage(created({ payloadNotIncluded: { reason: 'size', payloadType: 'CustomerCreated' } }), d);
    expect(d.loadCustomer).toHaveBeenCalledWith('c1');
  });
});

describe('failure classification — acknowledging is a data-retention decision', () => {
  it('acknowledges a vanished customer rather than retrying it for seven days', async () => {
    const d = deps({ loadCustomer: vi.fn(async () => null) });
    expect(await handleMessage(created(), d)).toEqual({ ack: true, detail: 'customer c1 not found — dropped' });
  });

  it('acknowledges a permanent refusal of the token', async () => {
    const d = deps({ createToken: vi.fn(async () => ({ ok: false, permanent: true, detail: 'HTTP 400' })) });
    expect((await handleMessage(created(), d)).ack).toBe(true);
  });

  it('NACKS a transient failure of the token so the platform redelivers', async () => {
    const d = deps({ createToken: vi.fn(async () => ({ ok: false, permanent: false, detail: 'HTTP 503' })) });
    expect((await handleMessage(created(), d)).ack).toBe(false);
  });

  it('NACKS a transient failure of the outbox write', async () => {
    const d = deps({ writeOutbox: vi.fn(async () => ({ ok: false, permanent: false, detail: 'HTTP 429' })) });
    expect((await handleMessage(created(), d)).ack).toBe(false);
    expect(d.deliver).not.toHaveBeenCalled();
  });

  it('acknowledges a message with no customer reference', async () => {
    expect((await handleMessage(created({ resource: undefined }), deps())).ack).toBe(true);
  });
});

describe('the backlog guard', () => {
  it('drops a message older than the limit — a late verification mail is worse than none', async () => {
    const d = deps();
    const out = await handleMessage(created({ createdAt: '2026-09-20T12:00:00Z' }), d);
    expect(out.ack).toBe(true);
    expect(out.detail).toContain('dropped');
    expect(d.createToken).not.toHaveBeenCalled();
  });

  it('processes a message with no createdAt rather than guessing its age', async () => {
    const d = deps();
    expect((await handleMessage(created({ createdAt: undefined }), d)).ack).toBe(true);
    expect(d.createToken).toHaveBeenCalled();
  });
});

describe('where the link lands — one connector, two tracks', () => {
  it('storefront mode: the page hands the token to its BFF (task 5.8)', () => {
    expect(buildLink(CONFIG, 'a b+c')).toBe('http://localhost:3000/verify-email?token=a%20b%2Bc');
  });

  it('connector mode: the receiver app confirms and redirects (the CIL track has no BFF)', () => {
    const link = buildLink({ ...CONFIG, verifyLinkMode: 'connector', receiverUrl: 'https://rcv.commercetools.app' }, 'tok');
    expect(link).toBe('https://rcv.commercetools.app/email-verification-confirm?token=tok');
  });
});
