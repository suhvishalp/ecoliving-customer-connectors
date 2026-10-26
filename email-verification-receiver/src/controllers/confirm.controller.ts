import type { Request, Response } from 'express';
import { createApiRoot } from '../client/create.client.js';
import { CustomError } from '../errors/custom.error.js';
import { confirmEmail } from '../services/confirm.service.js';
import { readConfiguration } from '../utils/config.utils.js';
import { logger } from '../utils/logger.utils.js';

/**
 * The link target, for a storefront that has no BFF (the CIL track).
 *
 * WHY THIS APP EXISTS AT ALL when the BFF track confirms in task 5.8: a verification link is a browser
 * GET, so something with an API client has to receive it and call POST /customers/email/confirm. In the
 * BFF track that is the storefront's BFF, which also owns the session and can react (sign the shopper
 * in, show the next step). Without a BFF, this app is that something — it confirms and redirects, and
 * the storefront only has to read `?status=`.
 *
 * This endpoint is PUBLIC and unauthenticated on purpose: it is a link in an email. The secret is the
 * token itself — 32 random bytes, short-lived, single-use — which is why nothing in the answer may
 * help someone who does not have it.
 */
export async function getConfirm(req: Request, res: Response): Promise<void> {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const { storefrontUrl } = readConfiguration();
  const landing = `${storefrontUrl}/verify-email?status=`;

  if (!token) {
    res.redirect(302, `${landing}invalid`);
    return;
  }
  const result = await confirmEmail(createApiRoot(), token);
  logger.info('Verification link clicked', {
    correlationId: req.correlationId,
    ok: result.ok,
    ...(result.ok ? { customerId: result.customerId } : { reason: result.reason }),
  });
  res.redirect(302, `${landing}${result.ok ? 'ok' : result.reason === 'invalid' ? 'invalid' : 'retry'}`);
}

/** The same confirm as JSON — for Postman, tests and a storefront that prefers to fetch. */
export async function postConfirm(req: Request, res: Response): Promise<void> {
  const tokenValue = req.body?.tokenValue;
  if (typeof tokenValue !== 'string' || tokenValue.length === 0) {
    throw new CustomError(400, 'Bad request — `tokenValue` is required.', 'InvalidInput');
  }
  const result = await confirmEmail(createApiRoot(), tokenValue);
  logger.info('Verification token confirmed over JSON', { correlationId: req.correlationId, ok: result.ok });
  if (result.ok) {
    res.status(200).json({ ok: true, customerId: result.customerId });
    return;
  }
  res.status(result.reason === 'invalid' ? 400 : 503).json({ ok: false, reason: result.reason });
}
