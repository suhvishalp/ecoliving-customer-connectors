import type { Request, Response } from 'express';
import type { Customer } from '@commercetools/platform-sdk';
import { createApiRoot } from '../client/create.client.js';
import { CustomError } from '../errors/custom.error.js';
import { nextNumber } from '../services/counter.service.js';
import { decide, formatCustomerNumber } from '../services/customer-number.service.js';
import { readConfiguration } from '../utils/config.utils.js';
import { logger } from '../utils/logger.utils.js';

/**
 * Translates one API Extension call into one allocation.
 *
 * The contract is narrow and unforgiving: 200/201 (optionally with `actions`) approves the write, 400
 * with `errors` rejects it with your message, and ANY other status — 500, a timeout, an HTML error page
 * — fails the caller's write with ExtensionBadResponse.
 *
 * FAIL-OPEN, deliberately: if the counter cannot be read or advanced, the customer is approved WITHOUT
 * a number and an error is logged. A number can be backfilled tomorrow; a shopper who could not sign up
 * because a counter blipped is gone. The README states this stance.
 */
export async function post(req: Request, res: Response): Promise<void> {
  const started = Date.now();
  const { action, resource } = req.body ?? {};

  if (!action || !resource) {
    throw new CustomError(400, 'Bad request — the Extension input is missing `action` or `resource`.', 'InvalidInput');
  }
  if (resource.typeId !== 'customer') {
    throw new CustomError(400, `Expected a customer, received "${resource.typeId}".`, 'InvalidInput');
  }
  if (action !== 'Create') {
    // The trigger asks for Create only; an Update reaching us means the registration drifted. Approve —
    // a number is never changed after the fact.
    res.status(200).send();
    return;
  }

  // `obj` is the customer as it WOULD be saved — including a customerNumber the caller supplied.
  const customer = (resource.obj ?? {}) as Pick<Customer, 'customerNumber'>;
  const { customerNumberPrefix } = readConfiguration();

  let allocated: string | null = null;
  if (!customer.customerNumber) {
    try {
      allocated = formatCustomerNumber(customerNumberPrefix, await nextNumber(createApiRoot()));
    } catch (error) {
      logger.error('Counter unavailable — approving the sign-up without a number (fail open)', {
        correlationId: req.correlationId,
        reason: (error as Error).message,
      });
    }
  }

  const result = decide(customer, allocated);
  logger.info('Customer evaluated', {
    correlationId: req.correlationId,
    action,
    customerId: resource.id,
    summary: result.summary,
    durationMs: Date.now() - started,
  });

  if (result.actions.length > 0) {
    res.status(200).json({ actions: result.actions });
    return;
  }
  res.status(200).send();
}
