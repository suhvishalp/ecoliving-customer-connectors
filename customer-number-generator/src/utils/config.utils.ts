import { optionalEnv, requireEnv } from '../validators/env.validators.js';

export interface Configuration {
  projectKey: string;
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  authUrl: string;
  scopes?: string[];
  /** Shared secret the platform presents on every Extension call (see connector/actions.ts). */
  extensionSecret: string;
  /** What a customer number looks like: `EL-` + six digits. */
  customerNumberPrefix: string;
}

let cached: Configuration | undefined;

/** Reads and validates every value this application needs. Throws at startup if any is missing. */
export function readConfiguration(): Configuration {
  if (cached) return cached;
  const scope = process.env.CTP_SCOPE;
  cached = {
    projectKey: requireEnv('CTP_PROJECT_KEY'),
    clientId: requireEnv('CTP_CLIENT_ID'),
    clientSecret: requireEnv('CTP_CLIENT_SECRET'),
    apiUrl: requireEnv('CTP_API_URL'),
    authUrl: requireEnv('CTP_AUTH_URL'),
    ...(scope ? { scopes: scope.split(' ').filter(Boolean) } : {}),
    extensionSecret: requireEnv('EXTENSION_SECRET'),
    customerNumberPrefix: optionalEnv('CUSTOMER_NUMBER_PREFIX', 'EL-'),
  };
  return cached;
}

/** Test seam. */
export function resetConfiguration(): void {
  cached = undefined;
}

export const ENV_NAME = optionalEnv('NODE_ENV', 'production');
