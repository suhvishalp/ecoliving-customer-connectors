import type { NextFunction, Request, Response } from 'express';
import { CustomError } from '../errors/custom.error.js';
import { logger } from '../utils/logger.utils.js';

/**
 * The last line of defence, and a security boundary: a stack trace in a response body tells an attacker
 * your framework, your paths and often your dependencies. Log the detail; return a sentence.
 */
export function errorMiddleware(error: Error, req: Request, res: Response, _next: NextFunction): void {
  const correlationId = req.correlationId;
  if (error instanceof CustomError) {
    logger.warn('Request rejected', { correlationId, status: error.statusCode, code: error.code });
    res.status(error.statusCode).json({ errors: [{ code: error.code, message: error.message }] });
    return;
  }
  logger.error('Unhandled error', { correlationId, reason: error.message, stack: error.stack });
  res.status(500).json({ errors: [{ code: 'General', message: 'Internal server error.' }] });
}
