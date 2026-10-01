import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, htmlToText, stripTags } from '../lib/htmlText';

test('nested tag tricks are fully removed', () => {
  assert.equal(stripTags('<scr<script>ipt>alert(1)</script>'), 'alert(1)');
  assert.ok(!htmlToText('<scr<script>ipt>bad()</scr</script>ipt><p>Good</p>').includes('<script'));
  assert.equal(htmlToText('<div><script>evil()</script><p>Fees &amp; returns</p></div>'), 'Fees & returns');
});

test('entities are decoded exactly once', () => {
  assert.equal(decodeEntities('&amp;lt;script&amp;gt;'), '&lt;script&gt;');
  assert.equal(decodeEntities('5 &lt; 6 &mdash; &#8217; &#x2014; &unknown;'), '5 < 6 — \u2019 — &unknown;');
});

test('readable structure is kept', () => {
  assert.equal(htmlToText('<h2>KiwiSaver</h2><ul><li>One</li><li>Two</li></ul>'), 'KiwiSaver\n\n- One\n\n- Two');
});
