// Output-safety helpers. These guard every place storage-backed text is
// interpolated into an HTML string, so a stored value can never become markup.
import test from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml, escapeAttr, safeColor, safeId, setText } from '../../js/ui/dom.js';

test('escapeHtml neutralises every HTML-significant character', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml('say "hi"'), 'say &quot;hi&quot;');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  assert.equal(escapeHtml('`tick`'), '&#96;tick&#96;');
});

test('escapeHtml stops an attribute break-out', () => {
  const injected = '" onmouseover="steal()';
  const html = `<div data-habit="${escapeHtml(injected)}"></div>`;
  assert.ok(!html.includes('onmouseover="steal()'));
  assert.ok(html.includes('&quot; onmouseover=&quot;steal()'));
});

test('escapeHtml handles empty-ish values without printing them', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(false), 'false');
});

test('escapeAttr is the same function under an intent-revealing name', () => {
  assert.equal(escapeAttr, escapeHtml);
});

test('safeColor accepts the colour shapes the app really stores', () => {
  assert.equal(safeColor('#6ee7b7'), '#6ee7b7');
  assert.equal(safeColor('#abc'), '#abc');
  assert.equal(safeColor('#11223344'), '#11223344');
  assert.equal(safeColor('rgb(10, 20, 30)'), 'rgb(10, 20, 30)');
  assert.equal(safeColor('rgba(10,20,30,0.5)'), 'rgba(10,20,30,0.5)');
  assert.equal(safeColor('hsl(200 50% 40%)'), 'hsl(200 50% 40%)');
  assert.equal(safeColor('var(--accent)'), 'var(--accent)');
  assert.equal(safeColor('tomato'), 'tomato');
});

test('safeColor rejects style-attribute injection', () => {
  const attacks = [
    'red;background:url(javascript:alert(1))',
    'red" onload="x',
    'url(https://evil.example/pixel)',
    'expression(alert(1))',
    '</style><script>alert(1)</script>',
    'var(--x); position:fixed',
  ];
  for (const attack of attacks) {
    assert.equal(safeColor(attack), 'var(--accent)', `should reject: ${attack}`);
  }
});

test('safeColor falls back for empty, oversized and non-string values', () => {
  assert.equal(safeColor(''), 'var(--accent)');
  assert.equal(safeColor(null), 'var(--accent)');
  assert.equal(safeColor({}), 'var(--accent)');
  assert.equal(safeColor('#' + 'a'.repeat(80)), 'var(--accent)');
  assert.equal(safeColor('not a colour at all', '#123456'), '#123456');
});

test('safeId keeps real identifiers and strips everything dangerous', () => {
  assert.equal(safeId('gym_push_a'), 'gym_push_a');
  assert.equal(safeId('c1f7-4a2b.90'), 'c1f7-4a2b.90');
  assert.equal(safeId('id" onclick="x'), 'idonclickx');
  assert.equal(safeId('a<b>c'), 'abc');
  assert.equal(safeId(null), '');
  assert.equal(safeId('x'.repeat(400)).length, 128);
});

test('setText writes text, never markup', () => {
  const node = { textContent: 'before' };
  setText(node, '<b>bold</b>');
  assert.equal(node.textContent, '<b>bold</b>');
  setText(node, null);
  assert.equal(node.textContent, '');
  assert.doesNotThrow(() => setText(null, 'x'));
});
