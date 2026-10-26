import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/client/create.client.js', () => ({ createApiRoot: () => ({}) }));
vi.mock('../src/services/customer.service.js', () => ({
  loadCustomer: async () => ({ id: 'c1', version: 1, email: 'ada@lhc.test', isEmailVerified: false }),
  createEmailToken: async () => ({ ok: true, value: { value: 'tok', expiresAt: '2026-09-28T12:00:00Z' } }),
}));
vi.mock('../src/services/outbox.service.js', () => ({
  readOutbox: async () => null,
  writeOutbox: async () => ({ ok: true, value: undefined }),
  deliver: async () => undefined,
}));

process.env.CTP_PROJECT_KEY ??= 'test-project';
process.env.CTP_CLIENT_ID ??= 'id';
process.env.CTP_CLIENT_SECRET ??= 'secret';
process.env.CTP_API_URL ??= 'https://api.europe-west1.gcp.commercetools.com';
process.env.CTP_AUTH_URL ??= 'https://auth.europe-west1.gcp.commercetools.com';
process.env.NODE_ENV = 'test';

const request = (await import('supertest')).default;
const app = (await import('../src/index.js')).default;

const envelope = (payload: unknown) => ({
  message: { data: Buffer.from(JSON.stringify(payload)).toString('base64') },
});

describe('the acknowledgement contract over HTTP', () => {
  it('204s a handled message — the queue discards it', async () => {
    const res = await request(app)
      .post('/email-verification')
      .send(envelope({ id: 'm1', type: 'CustomerCreated', resource: { typeId: 'customer', id: 'c1' } }));
    expect(res.status).toBe(204);
  });

  it('204s a message type it does not handle — a nack would retry it for 7 days', async () => {
    const res = await request(app).post('/email-verification').send(envelope({ id: 'm2', type: 'CustomerDeleted' }));
    expect(res.status).toBe(204);
  });

  it('204s a malformed envelope — it can never succeed, so redelivery is pointless', async () => {
    const res = await request(app).post('/email-verification').send({ nope: true });
    expect(res.status).toBe(204);
  });

  it('exposes /status for liveness', async () => {
    const res = await request(app).get('/status');
    expect(res.status).toBe(200);
  });
});
