import type { ByProjectKeyRequestBuilder, Customer } from '@commercetools/platform-sdk';

/** Just enough of the customer to decide, and to address the mail. */
export interface CustomerSnapshot {
  id: string;
  version: number;
  email: string;
  isEmailVerified: boolean;
}

export interface IssuedToken {
  value: string;
  expiresAt: string;
}

export type CallResult<T> =
  | { ok: true; value: T }
  /** `permanent` decides acknowledge-and-drop vs let-the-platform-redeliver. */
  | { ok: false; permanent: boolean; detail: string };

/**
 * The connector talks to the commercetools API DIRECTLY — a deployed connector runs in Connect's cloud,
 * where the BFF on a laptop is unreachable. Re-fetching by id rather than trusting the message payload
 * also survives `payloadNotIncluded`, and answers the one question the payload cannot: is the address
 * STILL unverified by the time we get to it?
 */
export async function loadCustomer(
  apiRoot: ByProjectKeyRequestBuilder,
  customerId: string
): Promise<CustomerSnapshot | null> {
  try {
    const { body } = await apiRoot.customers().withId({ ID: customerId }).get().execute();
    return snapshot(body);
  } catch (error) {
    if (statusOf(error) === 404) return null;
    throw error;
  }
}

/**
 * POST /customers/email-token — the same call the BFF made in task 5.8 before this connector existed.
 * The token is a secret in transit: it goes into the link and nowhere else. No `version` is sent on
 * purpose: a token is not a customer update, and a 409 here would only mean someone edited the profile
 * while the mail was being prepared.
 */
export async function createEmailToken(
  apiRoot: ByProjectKeyRequestBuilder,
  customerId: string,
  ttlMinutes: number
): Promise<CallResult<IssuedToken>> {
  try {
    const { body } = await apiRoot
      .customers()
      .emailToken()
      .post({ body: { id: customerId, ttlMinutes } })
      .execute();
    return { ok: true, value: { value: body.value, expiresAt: body.expiresAt } };
  } catch (error) {
    return failure(error);
  }
}

function snapshot(customer: Customer): CustomerSnapshot {
  return {
    id: customer.id,
    version: customer.version,
    email: customer.email,
    isEmailVerified: customer.isEmailVerified,
  };
}

/**
 * 409 means someone else touched the customer while we were deciding — worth one more delivery. 429
 * and 5xx are the platform asking us to come back. Every other 4xx will fail the redelivery identically:
 * retrying it for seven days is not a plan.
 */
export function failure<T>(error: unknown): CallResult<T> {
  const status = statusOf(error);
  const transient = status === undefined || status === 409 || status === 429 || status >= 500;
  return { ok: false, permanent: !transient, detail: `HTTP ${status ?? 'network'}: ${messageOf(error)}` };
}

export function statusOf(error: unknown): number | undefined {
  const status = (error as { statusCode?: unknown })?.statusCode;
  return typeof status === 'number' ? status : undefined;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
