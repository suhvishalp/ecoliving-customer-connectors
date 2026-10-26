import { beforeEach, describe, expect, it, vi } from 'vitest';

const confirm = vi.hoisted(() => ({ confirmEmail: vi.fn(async () => ({ ok: true, customerId: 'c1' }) as const) }));
vi.mock('../src/services/confirm.service.js', () => ({ confirmEmail: confirm.confirmEmail }));
vi.mock('../src/client/create.client.js', () => ({ createApiRoot: () => ({}) }));

process.env.CTP_PROJECT_KEY ??= 'test-project';
process.env.CTP_CLIENT_ID ??= 'id';
process.env.CTP_CLIENT_SECRET ??= 'secret';
process.env.CTP_API_URL ??= 'https://api.europe-west1.gcp.commercetools.com';
process.env.CTP_AUTH_URL ??= 'https://auth.europe-west1.gcp.commercetools.com';
process.env.STOREFRONT_URL = 'https://shop.example/';
process.env.NODE_ENV = 'test';

const request = (await import('supertest')).default;
const app = (await import('../src/index.js')).default;

describe('the browser GET from the mail link', () => {
  beforeEach(() => { vi.clearAllMocks(); confirm.confirmEmail.mockResolvedValue({ ok: true, customerId: 'c1' }); });

  it('confirms and redirects to the storefront with status=ok', async () => {
    const res = await request(app).get('/email-verification-confirm?token=tok');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://shop.example/verify-email?status=ok');
    expect(confirm.confirmEmail).toHaveBeenCalledWith({}, 'tok');
  });

  it('redirects with status=invalid on a bad token — and never echoes the platform message', async () => {
    confirm.confirmEmail.mockResolvedValueOnce({ ok: false, reason: 'invalid' } as never);
    const res = await request(app).get('/email-verification-confirm?token=nope');
    expect(res.headers.location).toBe('https://shop.example/verify-email?status=invalid');
    expect(res.text).not.toMatch(/expired|token/i);
  });

  it('redirects with status=retry when the platform was unavailable', async () => {
    confirm.confirmEmail.mockResolvedValueOnce({ ok: false, reason: 'unavailable' } as never);
    const res = await request(app).get('/email-verification-confirm?token=tok');
    expect(res.headers.location).toBe('https://shop.example/verify-email?status=retry');
  });

  it('treats a missing token as invalid without calling the platform', async () => {
    const res = await request(app).get('/email-verification-confirm');
    expect(res.headers.location).toBe('https://shop.example/verify-email?status=invalid');
    expect(confirm.confirmEmail).not.toHaveBeenCalled();
  });

  it('echoes the correlation id', async () => {
    const res = await request(app).get('/email-verification-confirm?token=tok').set('X-Correlation-ID', 'abc');
    expect(res.headers['x-correlation-id']).toBe('abc');
  });
});

describe('the JSON POST for Postman and tests', () => {
  beforeEach(() => { vi.clearAllMocks(); confirm.confirmEmail.mockResolvedValue({ ok: true, customerId: 'c1' }); });

  it('answers { ok, customerId }', async () => {
    const res = await request(app).post('/email-verification-confirm').send({ tokenValue: 'tok' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, customerId: 'c1' });
  });

  it('400s an invalid token and 503s an unavailable platform', async () => {
    confirm.confirmEmail.mockResolvedValueOnce({ ok: false, reason: 'invalid' } as never);
    expect((await request(app).post('/email-verification-confirm').send({ tokenValue: 'x' })).status).toBe(400);
    confirm.confirmEmail.mockResolvedValueOnce({ ok: false, reason: 'unavailable' } as never);
    expect((await request(app).post('/email-verification-confirm').send({ tokenValue: 'x' })).status).toBe(503);
  });

  it('400s a body without tokenValue', async () => {
    expect((await request(app).post('/email-verification-confirm').send({})).status).toBe(400);
  });

  it('exposes /status for liveness', async () => {
    expect((await request(app).get('/status')).body).toEqual({ status: 'ok' });
  });
});
