import { numberEnv, optionalEnv, requireEnv } from '../validators/env.validators.js';

export interface Configuration {
  projectKey: string;
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  authUrl: string;
  scopes?: string[];
  /** Where the verification link lands. The storefront's BFF confirms the token (course task 5.8). */
  storefrontUrl: string;
  /** How long a link stays valid. The platform caps a CustomerToken's ttlMinutes at 43200 (30 days). */
  tokenTtlMinutes: number;
  /** Guard: refuse to act on a message older than this, so a 7-day backlog cannot stampede. */
  maxMessageAgeHours: number;
  /**
   * Where the link in the mail points. `storefront` (the BFF track): the storefront page hands the
   * token to its BFF, which confirms it (task 5.8). `connector` (the CIL track, which has no BFF): the
   * link points at this connector's own receiver app, which confirms and redirects to the storefront.
   */
  verifyLinkMode: VerifyLinkMode;
  /** Public base URL of the receiver app; required in `connector` mode. */
  receiverUrl?: string;
}

export type VerifyLinkMode = 'storefront' | 'connector';

let cached: Configuration | undefined;

export function readConfiguration(): Configuration {
  if (cached) return cached;
  const scope = process.env.CTP_SCOPE;
  const receiver = optionalEnv('RECEIVER_URL', '');
  cached = {
    projectKey: requireEnv('CTP_PROJECT_KEY'),
    clientId: requireEnv('CTP_CLIENT_ID'),
    clientSecret: requireEnv('CTP_CLIENT_SECRET'),
    apiUrl: requireEnv('CTP_API_URL'),
    authUrl: requireEnv('CTP_AUTH_URL'),
    ...(scope ? { scopes: scope.split(' ').filter(Boolean) } : {}),
    storefrontUrl: optionalEnv('STOREFRONT_URL', 'http://localhost:3000').replace(/\/+$/, ''),
    tokenTtlMinutes: numberEnv('TOKEN_TTL_MINUTES', 4320),
    maxMessageAgeHours: numberEnv('MAX_MESSAGE_AGE_HOURS', 72),
    verifyLinkMode: linkMode(optionalEnv('VERIFY_LINK_MODE', 'storefront')),
    ...(receiver ? { receiverUrl: receiver.replace(/\/+$/, '') } : {}),
  };
  if (cached.verifyLinkMode === 'connector' && !cached.receiverUrl) {
    throw new Error('VERIFY_LINK_MODE=connector needs RECEIVER_URL — the public URL of the email-verification-receiver app.');
  }
  return cached;
}

export function resetConfiguration(): void {
  cached = undefined;
}

function linkMode(raw: string): VerifyLinkMode {
  if (raw === 'storefront' || raw === 'connector') return raw;
  throw new Error(`VERIFY_LINK_MODE must be "storefront" or "connector", got "${raw}"`);
}
