import 'dotenv/config';
import { createApiRoot } from '../client/create.client.js';
import { logger } from '../utils/logger.utils.js';
import { readConfiguration } from '../utils/config.utils.js';
import { buildDestination, ensureEmailVerificationSubscription } from './actions.js';

/**
 * The Subscription on `customer` that the BFF never needed while it issued tokens on demand (task 5.8).
 * Connect provisioned the queue; we still write the Subscription — CustomerCreated and
 * CustomerEmailChanged, nothing else.
 */
async function run(): Promise<void> {
  readConfiguration();
  const apiRoot = createApiRoot();
  await apiRoot.get().execute();
  logger.info('postDeploy: credentials verified');

  await ensureEmailVerificationSubscription(apiRoot, buildDestination());
}

run().catch((error: Error) => {
  process.stderr.write(`Post-deploy failed: ${error.message}\n`);
  process.exitCode = 1;
});
