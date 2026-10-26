import { describe, expect, it, vi } from 'vitest';
import {
  buildDestination,
  ensureEmailVerificationSubscription,
  deleteEmailVerificationSubscription,
  SUBSCRIPTION_KEY,
} from '../src/connector/actions.js';

describe('destination is built from what Connect injected, per region', () => {
  it('builds a Pub/Sub destination on GCP', () => {
    expect(
      buildDestination({
        CONNECT_SUBSCRIPTION_DESTINATION: 'GoogleCloudPubSub',
        CONNECT_GCP_TOPIC_NAME: 't',
        CONNECT_GCP_PROJECT_ID: 'p',
      } as NodeJS.ProcessEnv)
    ).toEqual({ type: 'GoogleCloudPubSub', topic: 't', projectId: 'p' });
  });

  it('builds an SNS destination on AWS', () => {
    expect(
      buildDestination({ CONNECT_SUBSCRIPTION_DESTINATION: 'SNS', CONNECT_AWS_TOPIC_ARN: 'arn:aws:sns:x' } as NodeJS.ProcessEnv)
    ).toEqual({ type: 'SNS', topicArn: 'arn:aws:sns:x', authenticationMode: 'IAM' });
  });

  it('FAILS LOUDLY on an unknown broker rather than silently registering Pub/Sub', () => {
    expect(() => buildDestination({ CONNECT_SUBSCRIPTION_DESTINATION: 'Kafka' } as NodeJS.ProcessEnv)).toThrow(/Unknown subscription destination/);
  });
});

function apiRootWith(existing: { version: number } | undefined) {
  const post = vi.fn(() => ({ execute: async () => ({ body: {} }) }));
  const del = vi.fn(() => ({ execute: async () => ({ body: {} }) }));
  const withKey = vi.fn(() => ({ post, delete: del }));
  const get = vi.fn(() => ({ execute: async () => ({ body: { results: existing ? [existing] : [] } }) }));
  return { apiRoot: { subscriptions: () => ({ get, post, withKey }) } as never, post, del };
}

const DEST = { type: 'GoogleCloudPubSub', topic: 't', projectId: 'p' } as const;

describe('postDeploy registration', () => {
  it('creates the Subscription when none exists, on customer, for only the handled types', async () => {
    const h = apiRootWith(undefined);
    await ensureEmailVerificationSubscription(h.apiRoot, DEST);
    const body = h.post.mock.calls[0]![0]!.body;
    expect(body.key).toBe(SUBSCRIPTION_KEY);
    expect(body.messages).toEqual([{ resourceTypeId: 'customer', types: ['CustomerCreated', 'CustomerEmailChanged'] }]);
  });

  it('UPDATES in place on a redeploy — delete-then-recreate would lose every sign-up in the gap', async () => {
    const h = apiRootWith({ version: 4 });
    await ensureEmailVerificationSubscription(h.apiRoot, DEST);
    expect(h.del).not.toHaveBeenCalled();
    const body = h.post.mock.calls[0]![0]!.body;
    expect(body.version).toBe(4);
    expect(body.actions.map((a: { action: string }) => a.action)).toEqual(['changeDestination', 'setMessages']);
  });
});

describe('preUndeploy teardown', () => {
  it('deletes with the current version', async () => {
    const h = apiRootWith({ version: 9 });
    await deleteEmailVerificationSubscription(h.apiRoot);
    expect(h.del).toHaveBeenCalledWith({ queryArgs: { version: 9 } });
  });

  it('is a no-op when already absent', async () => {
    const h = apiRootWith(undefined);
    await expect(deleteEmailVerificationSubscription(h.apiRoot)).resolves.toBeUndefined();
    expect(h.del).not.toHaveBeenCalled();
  });
});
