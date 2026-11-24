import test from 'node:test';
import assert from 'node:assert/strict';
import { md, render } from '../public/js/md.js';

test('escapes HTML from notes and AI output', () => {
  const h = md('<script>alert(1)</script> <img src=x onerror=alert(1)>');
  assert.ok(!h.includes('<script'));
  assert.ok(!h.includes('<img'));
});

test('blocks javascript: links, keeps http and in-app links', () => {
  assert.ok(!md('[x](javascript:alert(1))').includes('href'));
  assert.ok(md('[x](https://example.com)').includes('href="https://example.com"'));
  assert.ok(md('[x](#/r/5)').includes('href="#/r/5"'));
});

test('code blocks are LTR and escaped; headings give a TOC', () => {
  const r = render('# לולאות\n\n```js\nfor (let i = 0; i < 3; i++) {}\n```\n\n## for');
  assert.ok(r.html.includes('<pre dir="ltr" class="code" data-lang="js"><code>for (let i = 0; i &lt; 3; i++) {}</code></pre>'));
  assert.deepEqual(r.headings.map(h => h.text), ['לולאות', 'for']);
});

test('inline formatting, lists, tables and price-like dollars', () => {
  const h = md('**מודגש** ו-`x = 1`\n\n- [ ] שאלה 3\n- פריט\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nמחיר $5 ו-$6');
  assert.ok(h.includes('<strong>מודגש</strong>'));
  assert.ok(h.includes('<code dir="ltr">x = 1</code>'));
  assert.ok(h.includes('☐'));
  assert.ok(h.includes('<table>'));
  assert.ok(h.includes('$5'), 'prices are not treated as math');
});
