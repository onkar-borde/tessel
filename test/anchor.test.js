'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const A = require('../lib/anchor.js');

function load(html) {
  const dom = new JSDOM('<!doctype html><body>' + html + '</body>');
  return dom.window.document;
}
function selectText(doc, node, a, endNode, b) {
  const r = doc.createRange();
  r.setStart(node, a);
  r.setEnd(endNode, b);
  return r;
}

test('buildIndex skips scripts, styles, textareas and our own UI', () => {
  const doc = load(
    '<main><p>Hello</p><script>var secret=1</script><style>p{}</style><textarea>draft</textarea>' +
      '<div data-hfc-ui>overlay</div><p>World</p></main>'
  );
  const idx = A.buildIndex(doc.querySelector('main'));
  assert.equal(idx.text, 'HelloWorld');
});

test('anchorFromRange captures exact text across paragraphs, trims whitespace, adds context', () => {
  const doc = load('<main><p>Alpha beta gamma.</p><p>Delta epsilon.</p></main>');
  const [p1, p2] = doc.querySelectorAll('p');
  const root = doc.querySelector('main');
  const idx = A.buildIndex(root);
  const range = selectText(doc, p1.firstChild, 5, p2.firstChild, 5); // " beta gamma." + "Delta"
  const a = A.anchorFromRange(idx, range);
  assert.equal(a.exact, 'beta gamma.Delta');
  assert.equal(a.prefix, 'Alpha '); // the trimmed leading space becomes context
  assert.equal(a.suffix, ' epsilon.');
});

test('anchorFromRange works when the range boundaries are elements (triple-click style)', () => {
  const doc = load('<main><p>One two</p><p>Three four</p></main>');
  const [p1] = doc.querySelectorAll('p');
  const idx = A.buildIndex(doc.querySelector('main'));
  const range = doc.createRange();
  range.setStart(p1, 0);
  range.setEnd(p1, 1);
  assert.equal(A.anchorFromRange(idx, range).exact, 'One two');
});

test('locate picks the occurrence whose context matches', () => {
  const doc = load('<main><p>Cats like fish. Dogs like fish. Birds like fish.</p></main>');
  const root = doc.querySelector('main');
  const idx = A.buildIndex(root);
  const text = idx.text;
  const second = text.indexOf('fish', text.indexOf('Dogs'));
  const node = root.querySelector('p').firstChild;
  const anchor = A.anchorFromRange(idx, selectText(doc, node, second, node, second + 4));
  assert.equal(anchor.exact, 'fish');
  const loc = A.locate(idx, anchor);
  assert.equal(loc.start, second);
});

test('locate returns null when the text is gone', () => {
  const doc = load('<main><p>nothing here</p></main>');
  const idx = A.buildIndex(doc.querySelector('main'));
  assert.equal(A.locate(idx, { exact: 'missing', prefix: '', suffix: '' }), null);
});

test('a highlight survives the page being re-rendered (new DOM, same text)', () => {
  const first = load('<main><p>Key finding: sleep improves memory.</p></main>');
  const root1 = first.querySelector('main');
  const idx1 = A.buildIndex(root1);
  const node = root1.querySelector('p').firstChild;
  const start = idx1.text.indexOf('sleep improves');
  const anchor = A.anchorFromRange(idx1, selectText(first, node, start, node, start + 14));

  // Same content, different markup/node boundaries (as after a React re-render).
  const second = load('<main><div><p>Key finding: <em>sleep</em> improves memory.</p></div></main>');
  const idx2 = A.buildIndex(second.querySelector('main'));
  const loc = A.locate(idx2, anchor);
  assert.ok(loc);
  const range = A.rangeFromOffsets(idx2, loc.start, loc.end);
  assert.equal(range.toString(), 'sleep improves');
});

test('rangeFromOffsets spans multiple text nodes and matches the stored text', () => {
  const doc = load('<main><p>ab<b>cd</b>ef</p></main>');
  const idx = A.buildIndex(doc.querySelector('main'));
  assert.equal(A.rangeFromOffsets(idx, 1, 5).toString(), 'bcde');
});

test('wrapOffsets wraps across nodes without changing the text', () => {
  const doc = load('<main><p>Hello big</p><p>wide world</p></main>');
  const root = doc.querySelector('main');
  const before = root.textContent;
  const idx = A.buildIndex(root);
  const start = idx.text.indexOf('big');
  const end = idx.text.indexOf('wide') + 4;
  const marks = A.wrapOffsets(idx, start, end, () => doc.createElement('mark'));
  assert.equal(marks.length, 2);
  assert.equal(root.textContent, before);
  assert.equal(marks.map((m) => m.textContent).join('|'), 'big|wide');
});

test('overlapping highlights can both be wrapped when the index is rebuilt between them', () => {
  const doc = load('<main><p>one two three four</p></main>');
  const root = doc.querySelector('main');
  for (const [s, e] of [[0, 7], [4, 13]]) {
    const idx = A.buildIndex(root);
    A.wrapOffsets(idx, s, e, () => doc.createElement('mark'));
  }
  assert.equal(root.textContent, 'one two three four');
  assert.ok(root.querySelectorAll('mark').length >= 2);
});

test('buildIndex ignores the prompt box and other editable regions', () => {
  const doc = load(
    '<main><p>Answer text</p><div contenteditable="true">my draft</div>' +
      '<div contenteditable="">also draft</div><div contenteditable="false">kept</div></main>'
  );
  const idx = A.buildIndex(doc.querySelector('main'));
  assert.equal(idx.text, 'Answer textkept');
});
