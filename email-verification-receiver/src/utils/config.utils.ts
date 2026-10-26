import { optionalEnv, requireEnv } from '../validators/env.validators.js';

export interface Configuration {
  projectKey: string;
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  authUrl: string;
  scopes?: string[];
  /** Where the shopper is sent after the click, with `?status=ok|invalid`. */
  storefrontUrl: string;
}

let cached: Configuration | undefined;

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
    storefrontUrl: optionalEnv('STOREFRONT_URL', 'http://localhost:3000').replace(/\/+$/, ''),
  };
  return cached;
}

export function resetConfiguration(): void {
  cached = undefined;
}
