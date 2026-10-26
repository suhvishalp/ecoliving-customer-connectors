import { beforeEach, describe, expect, it, vi } from 'vitest';

// The counter reaches for a Custom Object; stub it so these tests exercise the HTTP layer (auth,
// contract, status codes) rather than the platform.
const counter = vi.hoisted(() => ({ next: vi.fn(async () => 42) }));
vi.mock('../src/services/counter.service.js', () => ({ nextNumber: counter.next }));
vi.mock('../src/client/create.client.js', () => ({ createApiRoot: () => ({}) }));

process.env.CTP_PROJECT_KEY ??= 'test-project';
process.env.CTP_CLIENT_ID ??= 'test-id';
process.env.CTP_CLIENT_SECRET ??= 'test-secret';
process.env.CTP_API_URL ??= 'https://api.europe-west1.gcp.commercetools.com';
process.env.CTP_AUTH_URL ??= 'https://auth.europe-west1.gcp.commercetools.com';
process.env.EXTENSION_SECRET = 's3cret';
process.env.NODE_ENV = 'test';

const request = (await import('supertest')).default;
const app = (await import('../src/index.js')).default;

const AUTH = { Authorization: 'Bearer s3cret' };
const input = (customerNumber?: string, action = 'Create') => ({
  action,
  resource: { typeId: 'customer', id: 'c-1', obj: { email: 'ada@lhc.test', ...(customerNumber ? { customerNumber } : {}) } },
});

describe('authentication — the endpoint is on the public internet', () => {
  beforeEach(() => { vi.clearAllMocks(); counter.next.mockResolvedValue(42); });

  it.each([
    ['no Authorization header', undefined],
    ['the wrong secret', 'Bearer wrong'],
    ['the right secret without the Bearer scheme', 's3cret'],
  ])('rejects %s with 401', async (_label, header) => {
    const req = request(app).post('/customer-number').send(input());
    if (header !== undefined) req.set('Authorization', header);
    expect((await req).status).toBe(401);
  });

  it('leaves /status open — it exposes nothing', async () => {
    const res = await request(app).get('/status');
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('the API Extension contract', () => {
  beforeEach(() => { vi.clearAllMocks(); counter.next.mockResolvedValue(42); });

  it('answers 200 with setCustomerNumber for a new customer', async () => {
    const res = await request(app).post('/customer-number').set(AUTH).send(input());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ actions: [{ action: 'setCustomerNumber', customerNumber: 'EL-000042' }] });
  });

  it('answers 200 with an EMPTY body when the draft already carries a number', async () => {
    const res = await request(app).post('/customer-number').set(AUTH).send(input('LEGACY-7'));
    expect(res.status).toBe(200);
    expect(res.text).toBe('');
    expect(counter.next).not.toHaveBeenCalled();
  });

  it('FAILS OPEN when the counter is unavailable — a sign-up must not die on a blipped counter', async () => {
    counter.next.mockRejectedValueOnce(Object.assign(new Error('503'), { statusCode: 503 }));
    const res = await request(app).post('/customer-number').set(AUTH).send(input());
    expect(res.status).toBe(200);
    expect(res.text).toBe('');
  });

  it('approves an Update without touching the counter — numbers are never reassigned', async () => {
    const res = await request(app).post('/customer-number').set(AUTH).send(input(undefined, 'Update'));
    expect(res.status).toBe(200);
    expect(counter.next).not.toHaveBeenCalled();
  });

  it('rejects a malformed input with 400, not 500 — a 500 would fail the shopper’s sign-up', async () => {
    expect((await request(app).post('/customer-number').set(AUTH).send({ action: 'Create' })).status).toBe(400);
  });

  it('rejects a non-customer resource', async () => {
    const res = await request(app).post('/customer-number').set(AUTH).send({ action: 'Create', resource: { typeId: 'cart', id: 'x', obj: {} } });
    expect(res.status).toBe(400);
  });

  it('echoes the correlation id the platform sent', async () => {
    const res = await request(app).post('/customer-number').set(AUTH).set('X-Correlation-ID', 'abc-123').send(input());
    expect(res.headers['x-correlation-id']).toBe('abc-123');
  });
});
