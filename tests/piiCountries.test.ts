import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactPII } from '../lib/guardrails/pii';

test('tax numbers from all five countries are removed', () => {
  const cases = [
    'My IRD number is 049-091-850',          // NZ (valid checksum)
    'tfn 123 456 782',                        // AU, labelled
    'SSN 123-45-6789',                        // US, labelled
    'my number is 123-45-6789 thanks',        // US, usual format
    'NI number AB 12 34 56 C',                // UK
    'TIN: 123-456-789-000',                   // PH
  ];
  for (const text of cases) {
    const r = redactPII(text);
    assert.ok(!/\d{3}[- ]?\d{2,3}[- ]?\d{3,4}/.test(r.clean) && !/AB ?12/.test(r.clean), `not removed: ${text} -> ${r.clean}`);
  }
});

test('ordinary money questions are left alone', () => {
  const text = 'I am 52 with NZD 500,000 and add 2,000 a month. Could I retire at 65 on 60,000 a year?';
  assert.equal(redactPII(text).clean, text);
  assert.equal(redactPII('I hold 10 shares at 12.50 each').clean, 'I hold 10 shares at 12.50 each');
});
