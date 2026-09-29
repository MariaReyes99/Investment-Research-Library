import { test } from "node:test";
import assert from "node:assert/strict";
import { redactPII, irdValid, luhnValid } from "../lib/guardrails/pii";
import { outputRedFlags, isPersonalAdviceRequest } from "../lib/guardrails/advice";

test("card numbers block the request", () => {
  const r = redactPII("my card is 4242 4242 4242 4242 exp 12/28 cvv 123");
  assert.equal(r.blocked, true);
  assert.ok(!r.clean.includes("4242"));
  assert.ok(!r.clean.includes("123"));
});

test("financial numbers are kept", () => {
  const q = "I'm 52 with NZD 500,000 and add $2,000/month at 7%. Can I retire at 65 with 1000000?";
  const r = redactPII(q);
  assert.equal(r.clean, q);
  assert.equal(r.blocked, false);
});

test("NZ identifiers are redacted but not blocked", () => {
  const r = redactPII("Email maria@example.co.nz, ph 021 123 4567, IRD 49-091-850, acct 12-3456-1234567-00, lives at 12 Riccarton Road");
  assert.equal(r.blocked, false);
  for (const s of ["maria@", "021 123", "49-091-850", "1234567-00", "Riccarton"]) assert.ok(!r.clean.includes(s), s);
  console.log("  ", r.clean);
});

test("checksums", () => {
  assert.ok(luhnValid("4242424242424242"));
  assert.ok(!luhnValid("4242424242424241"));
  assert.ok(irdValid("49091850"));
  assert.ok(irdValid("136410132"));
  assert.ok(!irdValid("136410133"));
});

test("secret keys are removed", () => {
  assert.ok(!redactPII("key sk_live_abcdefghijklmnop").clean.includes("sk_live"));
});

test("advice detection and output check", () => {
  assert.ok(isPersonalAdviceRequest("Should I sell my QQQM after the crash?"));
  assert.ok(!isPersonalAdviceRequest("What did Bogle say about market timing?"));
  assert.deepEqual(outputRedFlags("You should buy CSPX now."), ["directive advice"]);
  assert.deepEqual(outputRedFlags("CSPX tracks the S&P 500 and is domiciled in Ireland."), []);
  assert.ok(outputRedFlags("This is a guaranteed return").length > 0);
});
