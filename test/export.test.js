'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { buildExportHtml } = require('../lib/export.js');

function root(html) {
  const dom = new JSDOM('<!doctype html><body><main>' + html + '</main></body>');
  return dom.window.document.querySelector('main');
}
const parse = (html) => new JSDOM(html).window.document;

const PAGE =
  '<div data-testid="user-message" class="x" style="color:red" onclick="steal()"><p>What helps memory?</p></div>' +
  '<div class="font-claude-response"><p>Sleep improves memory. Exercise also helps.</p>' +
  '<button>Copy</button><svg><title>icon</title></svg><script>alert("page")</script>' +
  '<a href="javascript:alert(1)">bad</a><a href="https://example.com/x">ok</a></div>';

test('export bakes in highlights, numbers comments, labels roles', () => {
  const r = root(PAGE);
  const before = r.innerHTML;
  const { html, applied, missing } = buildExportHtml({
    rootEl: r,
    title: 'Memory research',
    highlights: [
      { exact: 'Sleep improves memory', prefix: '', suffix: '. Exercise', color: 'green', comment: 'Core claim' },
      { exact: 'Exercise also helps', prefix: 'memory. ', suffix: '', color: 'pink', comment: '' },
      { exact: 'text that is not on the page', prefix: '', suffix: '', color: 'blue', comment: 'x' },
    ],
  });
  assert.equal(applied, 2);
  assert.equal(missing, 1);
  assert.equal(r.innerHTML, before, 'must not modify the live page');

  const doc = parse(html);
  assert.equal(doc.title, 'Memory research');
  assert.equal(doc.querySelector('mark[data-hl="green"]').textContent, 'Sleep improves memory');
  assert.equal(doc.querySelector('mark[data-hl="pink"]').textContent, 'Exercise also helps');
  const sup = doc.querySelector('sup[data-comment]');
  assert.equal(sup.textContent, '1');
  assert.equal(sup.getAttribute('data-comment'), 'Core claim');
  assert.match(doc.querySelector('aside.comments').textContent, /Core claim/);
  assert.equal(doc.querySelector('[data-hfc-role="user"]').textContent.trim(), 'What helps memory?');
  assert.ok(doc.querySelector('[data-hfc-role="claude"]'));
  assert.ok(doc.getElementById('t-hl') && doc.getElementById('t-cm'), 'toggles present');
});

test('export strips scripts, handlers, styles, classes, buttons, svg and unsafe links', () => {
  const { html } = buildExportHtml({ rootEl: root(PAGE), highlights: [] });
  const doc = parse(html);
  const main = doc.querySelector('main');
  assert.equal(main.querySelectorAll('script,button,svg,style').length, 0);
  assert.ok(!html.includes('alert("page")'));
  assert.ok(!html.includes('steal()'));
  assert.ok(!html.includes('color:red'));
  assert.equal(main.querySelectorAll('[class],[style],[onclick]').length, 0);
  const links = [...main.querySelectorAll('a')];
  assert.equal(links.find((a) => a.textContent === 'bad').getAttribute('href'), null);
  assert.equal(links.find((a) => a.textContent === 'ok').getAttribute('href'), 'https://example.com/x');
  assert.equal(links.find((a) => a.textContent === 'ok').getAttribute('rel'), 'noopener noreferrer');
});

test('hostile titles and comments cannot inject markup', () => {
  const { html } = buildExportHtml({
    rootEl: root('<p>Hello world</p>'),
    title: '</title><script>alert(1)</script>',
    highlights: [{ exact: 'Hello', prefix: '', suffix: ' world', color: 'yellow', comment: '<img src=x onerror=alert(1)> "q" & <b>' }],
  });
  const doc = parse(html);
  assert.equal(doc.title, '</title><script>alert(1)</script>');
  assert.equal(doc.querySelectorAll('script').length, 3, 'only the built-in toggle, data and continue scripts');
  assert.equal(doc.querySelector('script[type="application/json"]').textContent.includes('</script'), false);
  assert.equal(doc.querySelector('img'), null);
  assert.equal(doc.querySelector('sup[data-comment]').getAttribute('data-comment'), '<img src=x onerror=alert(1)> "q" & <b>');
  assert.equal(doc.querySelector('aside.comments p').textContent, '<img src=x onerror=alert(1)> "q" & <b>');
});

test('options: no comments / no highlights', () => {
  const hl = [{ exact: 'Hello', prefix: '', suffix: ' world', color: 'yellow', comment: 'note' }];

  const noComments = parse(buildExportHtml({ rootEl: root('<p>Hello world</p>'), highlights: hl, includeComments: false }).html);
  assert.ok(noComments.querySelector('mark[data-hl="yellow"]'));
  assert.equal(noComments.querySelector('sup'), null);
  assert.equal(noComments.querySelector('aside'), null);
  assert.equal(noComments.getElementById('t-cm'), null);

  const noHighlights = parse(buildExportHtml({ rootEl: root('<p>Hello world</p>'), highlights: hl, includeHighlights: false }).html);
  assert.ok(noHighlights.querySelector('mark[data-hl="none"]'), 'kept only to anchor the comment badge');
  assert.ok(noHighlights.querySelector('sup[data-comment]'));
  assert.equal(noHighlights.getElementById('t-hl'), null);

  const plain = parse(buildExportHtml({ rootEl: root('<p>Hello world</p>'), highlights: hl, includeHighlights: false, includeComments: false, continueIn: false }).html);
  assert.equal(plain.querySelector('mark'), null);
  assert.equal(plain.querySelector('script'), null, 'no toggles, so no script at all');
});

test('comments are numbered in reading order, not creation order', () => {
  const { html } = buildExportHtml({
    rootEl: root('<p>First thing. Second thing.</p>'),
    highlights: [
      { exact: 'Second thing', prefix: 'First thing. ', suffix: '.', color: 'blue', comment: 'made first' },
      { exact: 'First thing', prefix: '', suffix: '. Second', color: 'blue', comment: 'made second' },
    ],
  });
  const doc = parse(html);
  const lis = [...doc.querySelectorAll('aside.comments li')].map((li) => li.querySelector('p').textContent);
  assert.deepEqual(lis, ['made second', 'made first']);
});

test('export offers "Continue in Claude / ChatGPT" with the chat and the reader\'s notes as a prompt', () => {
  const { html } = buildExportHtml({
    rootEl: root(PAGE),
    title: 'Memory research',
    highlights: [{ exact: 'Sleep improves memory', prefix: '', suffix: '', color: 'green', comment: 'Core </script> claim' }],
  });
  const doc = parse(html);
  const goes = Array.from(doc.querySelectorAll('button[data-go]')).map((b) => b.getAttribute('data-go'));
  assert.deepEqual(goes, ['https://claude.ai/new?q=', 'https://chatgpt.com/?q=']);
  const t = JSON.parse(doc.getElementById('hfc-transcript').textContent);
  assert.match(t, /continue helping me/);
  assert.match(t, /Me:\nWhat helps memory\?/);
  assert.match(t, /Assistant:\nSleep improves memory\. Exercise also helps\./);
  assert.match(t, /MY NOTES[\s\S]*"Sleep improves memory": Core <\/script> claim/);
  assert.doesNotMatch(t, /highlight/i, 'the prompt must never mention highlights');
  const none = JSON.parse(parse(buildExportHtml({ rootEl: root(PAGE), title: 'x', highlights: [{ exact: 'Sleep improves memory', prefix: '', suffix: '', color: 'green', comment: '' }] }).html).getElementById('hfc-transcript').textContent);
  assert.doesNotMatch(none, /highlight|notes/i, 'no notes, no mention of notes either');
  assert.doesNotMatch(t, /alert\("page"\)|Copy|icon/, 'page scripts and UI are not in the transcript');
  assert.equal(doc.querySelectorAll('script').length, 3, 'comment text cannot break out of the embedded data');
});

test('the continue buttons can be left out', () => {
  const { html } = buildExportHtml({ rootEl: root(PAGE), title: 'x', highlights: [], continueIn: false });
  assert.doesNotMatch(html, /data-go|hfc-transcript/);
});

test('every inline script in an export is valid JavaScript', () => {
  const { html } = buildExportHtml({
    rootEl: root(PAGE),
    title: 'x',
    highlights: [{ exact: 'Sleep improves memory', prefix: '', suffix: '', color: 'green', comment: 'c' }],
  });
  const scripts = Array.from(parse(html).querySelectorAll('script:not([type])'));
  assert.ok(scripts.length >= 2);
  for (const s of scripts) assert.doesNotThrow(() => new Function(s.textContent));
});

test('a saved share link becomes an "Open the chat" button; unsafe links never do', () => {
  const mk = (shareUrl) => parse(buildExportHtml({ rootEl: root(PAGE), title: 'x', highlights: [], shareUrl }).html);
  const a = mk('https://claude.ai/share/abc12345-6789').querySelector('a.go');
  assert.equal(a.getAttribute('href'), 'https://claude.ai/share/abc12345-6789');
  assert.match(a.textContent, /Open on Claude/);
  assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(mk('javascript:alert(1)').querySelector('a.go'), null);
  assert.equal(mk('https://evil.com/share/abc12345').querySelector('a.go'), null);
  assert.equal(mk(undefined).querySelector('a.go'), null);
});

test('custom colours: styled in the export; an undefined custom colour falls back to yellow', () => {
  const hls = [
    { exact: 'Sleep improves memory', prefix: '', suffix: '', color: 'c1', comment: '' },
    { exact: 'Exercise also helps', prefix: '', suffix: '', color: 'c2', comment: '' },
  ];
  const { html } = buildExportHtml({ rootEl: root(PAGE), highlights: hls, customColors: { c1: '#ff8a3d', bad: '#fff' }, colorNames: { c1: 'Method' } });
  const d = parse(html);
  assert.equal(d.querySelectorAll('mark[data-hl="c1"]').length, 1);
  assert.equal(d.querySelectorAll('mark[data-hl="c2"]').length, 0);
  assert.equal(d.querySelectorAll('mark[data-hl="yellow"]').length, 1);
  assert.match(html, /mark\[data-hl="c1"\]\{background:rgba\(255,138,61/);
  assert.match(d.querySelector('.legend').textContent, /Method/);
});
