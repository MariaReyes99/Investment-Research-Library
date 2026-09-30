import { test } from 'node:test';
import assert from 'node:assert/strict';

test('security alerts post once per kind, without user content', async () => {
  const sent: string[] = [];
  const realFetch = globalThis.fetch;
  process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.test/alert';
  delete process.env.UPSTASH_REDIS_REST_URL;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    sent.push(String(init?.body));
    return new Response('ok');
  }) as typeof fetch;
  try {
    const { securityAlert } = await import('../lib/alerts');
    await securityAlert('card_data_blocked', '/api/chat');
    await securityAlert('card_data_blocked', '/api/chat');
    await securityAlert('webhook_signature_invalid', '/api/stripe/webhook');
    assert.equal(sent.length, 2, 'the second card alert within the hour is held back');
    assert.match(sent[0], /card details/);
    assert.ok(JSON.parse(sent[0]).text && JSON.parse(sent[0]).content, 'works for Slack and Discord');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ALERT_WEBHOOK_URL;
  }
});
