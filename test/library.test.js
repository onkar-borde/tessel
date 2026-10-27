'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const L = require('../lib/library.js');
const { buildExportHtml } = require('../lib/export.js');

const ID1 = '11111111-2222-3333-4444-555555555555';
const ID2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ID3 = 'cccccccc-1111-2222-3333-444444444444';
const hl = (exact, color = 'yellow', comment = '', extra = {}) => ({ id: 'h-' + exact, color, exact, prefix: '', suffix: '', comment, created: 1, updated: 1, ...extra });
const store = () => ({
  ['chat:' + ID1]: { title: 'Sleep research', url: '', updated: 30, highlights: [hl('memory consolidation', 'green', 'key claim'), hl('REM sleep', 'blue')] },
  ['gpt:' + ID2]: { title: 'Tax questions', updated: 20, starred: true, tags: ['finance', 'Finance', ' q3 '], highlights: [hl('standard deduction', 'pink', 'check 2026')] },
  ['gpt:' + ID3]: { title: 'Empty but tagged', updated: 10, tags: ['later'], highlights: [] },
  settings: { colorNames: { yellow: 'Claim', blue: '   ', green: 'X'.repeat(60) } },
  lastColor: 'green',
  pendingJump: {},
  'chat:short': { highlights: [] },
});

test('colour names: custom names win, blanks fall back, length is capped', () => {
  const n = L.colorNames(store().settings);
  assert.equal(n.yellow, 'Claim');
  assert.equal(n.blue, 'Blue');
  assert.equal(n.green.length, L.MAX_NAME_LEN);
  assert.equal(n.pink, 'Pink');
  const base = { ...L.COLOR_LABELS, c1: 'Custom 1', c2: 'Custom 2', c3: 'Custom 3', c4: 'Custom 4' };
  assert.deepEqual(L.colorNames(undefined), base);
  assert.deepEqual(L.colorNames({ colorNames: 'nope' }), base);
});

test('tags are trimmed, de-duplicated ignoring case, and limited', () => {
  assert.deepEqual(L.cleanTags(['  a  b ', 'A B', '', 5, 'x'.repeat(100)]).map((t) => t.length), [3, 30]);
  assert.equal(L.cleanTags(Array.from({ length: 40 }, (_, i) => 't' + i)).length, L.MAX_TAGS);
  assert.deepEqual(L.cleanTags('not a list'), []);
});

test('chatsFrom lists only real chats from both sites, newest first, with defaults filled in', () => {
  const chats = L.chatsFrom(store());
  assert.deepEqual(chats.map((c) => c.id), [ID1, ID2, ID3]);
  assert.equal(chats[0].site.id, 'claude');
  assert.equal(chats[0].url, 'https://claude.ai/chat/' + ID1, 'url is rebuilt when missing');
  assert.equal(chats[1].starred, true);
  assert.deepEqual(chats[1].tags, ['finance', 'q3']);
  assert.equal(chats[0].starred, false);
});

test('filters: platform, starred, tag, colour and text combine', () => {
  const chats = L.chatsFrom(store());
  const ids = (f) => L.filterChats(chats, f).map((r) => r.chat.id);
  assert.deepEqual(ids({ platform: 'chatgpt' }), [ID2, ID3]);
  assert.deepEqual(ids({ platform: 'claude' }), [ID1]);
  assert.deepEqual(ids({ starred: true }), [ID2]);
  assert.deepEqual(ids({ tag: 'FINANCE' }), [ID2]);
  assert.deepEqual(ids({ color: 'blue' }), [ID1]);
  assert.deepEqual(ids({ q: 'deduction' }), [ID2]);
  assert.deepEqual(ids({ q: 'check 2026' }), [ID2], 'comments are searched');
  assert.deepEqual(ids({ q: 'tax' }), [ID2], 'titles are searched');
  assert.deepEqual(ids({ q: 'later' }), [ID3], 'tags are searched');
  assert.deepEqual(ids({ q: 'zzz' }), []);
  assert.deepEqual(ids({ platform: 'claude', color: 'pink' }), []);
  const m = L.filterChats(chats, { q: 'rem' })[0];
  assert.deepEqual(m.matches.map((x) => x.exact), ['REM sleep'], 'only matching highlights are returned');
});

test('sorting floats starred chats and honours the chosen order', () => {
  const chats = L.chatsFrom(store());
  assert.deepEqual(L.sortChats(chats, 'recent').map((c) => c.id), [ID2, ID1, ID3]);
  assert.deepEqual(L.sortChats(chats, 'recent', false).map((c) => c.id), [ID1, ID2, ID3]);
  assert.deepEqual(L.sortChats(chats, 'count', false).map((c) => c.id), [ID1, ID2, ID3]);
  assert.deepEqual(L.sortChats(chats, 'title', false).map((c) => c.title), ['Empty but tagged', 'Sleep research', 'Tax questions']);
});

test('counts per platform, starred and tags', () => {
  const { counts, tags } = L.counts(L.chatsFrom(store()));
  assert.deepEqual(counts, { all: 3, starred: 1, claude: 1, chatgpt: 2 });
  assert.deepEqual(tags.map((t) => t.name).sort(), ['finance', 'later', 'q3']);
});

test('Markdown for a chat, a quote and the whole library', () => {
  const [c1, c2] = L.chatsFrom(store());
  const names = L.colorNames(store().settings);
  const md = L.chatMarkdown(c1, { colorNames: names });
  assert.match(md, /^# Sleep research/);
  assert.match(md, /\*Claude · https:\/\/claude\.ai\/chat\//);
  assert.match(md, /> memory consolidation\n\n\*Green\*|> memory consolidation\n\n\*XXXX/);
  assert.match(md, /\*\*Comment:\*\* key claim/);
  assert.match(L.chatMarkdown(c2, { colorNames: names }), /Tags: `finance` `q3`/);
  const q = L.quoteMarkdown(c1.highlights[0], c1);
  assert.equal(q.split('\n')[0], '> memory consolidation');
  assert.match(q, /— \[Sleep research\]\(https:\/\/claude\.ai\/chat\//);
  const lib = L.libraryMarkdown(L.chatsFrom(store()), { now: new Date('2026-10-25T00:00:00Z') });
  assert.match(lib, /Exported 2026-10-25 · 3 chats/);
  assert.ok(lib.indexOf('## Claude') < lib.indexOf('## ChatGPT'));
  assert.match(lib, /### Tax questions/);
});

test('backup v2 round-trips both sites, stars, tags and colour names', () => {
  const b = L.buildBackup(store(), new Date('2026-10-25T00:00:00Z'));
  assert.equal(b.version, 2);
  assert.deepEqual(Object.keys(b.chats).sort(), ['chat:' + ID1, 'gpt:' + ID2, 'gpt:' + ID3].sort());
  assert.equal(b.chats['gpt:' + ID2].starred, true);
  const { out, added } = L.applyBackup({}, JSON.parse(JSON.stringify(b)), () => 'new');
  assert.equal(added, 3);
  assert.equal(out['gpt:' + ID2].starred, true);
  assert.deepEqual(out['gpt:' + ID2].tags, ['finance', 'q3']);
  assert.equal(out.settings.colorNames.yellow, 'Claim');
});

test('restore merges without duplicating or overwriting, and still reads v1 backups', () => {
  const existing = store();
  const b = L.buildBackup(existing);
  const again = L.applyBackup(existing, b, () => 'x');
  assert.equal(again.added, 0, 'nothing new');
  assert.equal(again.out.settings, undefined, 'own colour names are kept');

  const v1 = { format: 'highlighter-for-claude', version: 1, chats: { [ID3]: { title: 'old', highlights: [hl('legacy')] }, 'not an id': { highlights: [hl('x')] } } };
  const r = L.applyBackup({}, v1, () => 'n1');
  assert.deepEqual(Object.keys(r.out), ['chat:' + ID3], 'a bare id means a Claude chat');
  assert.equal(r.out['chat:' + ID3].url, 'https://claude.ai/chat/' + ID3);
});

test('restore rejects other files and sanitises hostile content', () => {
  assert.throws(() => L.applyBackup({}, { hello: 1 }, () => 'x'));
  assert.throws(() => L.applyBackup({}, null, () => 'x'));
  const evil = {
    format: 'highlighter-for-claude',
    version: 2,
    chats: {
      ['chat:' + ID1]: { starred: 'yes', tags: ['<b>x</b>', 7], highlights: [{ exact: 'ok', color: '__proto__', comment: 5 }, { exact: '' }, null, { exact: 'x'.repeat(30000) }] },
      '__proto__': { highlights: [hl('a')] },
      'gpt:../../etc': { highlights: [hl('a')] },
    },
  };
  const { out, added } = L.applyBackup({}, evil, () => 'gen');
  assert.equal(added, 1);
  const c = out['chat:' + ID1];
  assert.equal(c.highlights[0].color, 'yellow');
  assert.equal(c.highlights[0].comment, '');
  assert.equal(c.highlights[0].id, 'gen');
  assert.equal(c.starred, false, 'only a real true counts');
  assert.deepEqual(Object.keys(out), ['chat:' + ID1]);
});

test('export legend lists only custom-named colours that are used', () => {
  const dom = new JSDOM('<!doctype html><body><main><p>Alpha beta gamma delta</p></main></body>');
  const rootEl = dom.window.document.querySelector('main');
  const base = { rootEl, title: 'T', colorNames: { yellow: 'Claim', green: 'Green', blue: 'Term', pink: 'Pink' } };
  const hls = [hl('Alpha', 'yellow'), { ...hl('delta', 'green'), prefix: 'gamma ' }];
  const html = buildExportHtml({ ...base, highlights: hls }).html;
  const doc = new JSDOM(html).window.document;
  const legend = [...doc.querySelectorAll('.legend .lg')].map((e) => e.textContent);
  assert.deepEqual(legend, ['Claim'], 'Green is default-named, Term is unused');
  const none = new JSDOM(buildExportHtml({ ...base, highlights: hls, includeHighlights: false }).html).window.document;
  assert.equal(none.querySelector('.legend'), null);
  const plain = new JSDOM(buildExportHtml({ rootEl, title: 'T', highlights: hls }).html).window.document;
  assert.equal(plain.querySelector('.legend'), null);
});

test('share links survive backup and restore, and unsafe ones are dropped', () => {
  const ID = 'aaaaaaaa-1111-2222-3333-444444444444';
  const rec = (u) => ({ title: 't', updated: 1, shareUrl: u, highlights: [{ id: 'h1', color: 'yellow', exact: 'x', prefix: '', suffix: '', comment: '', created: 1, updated: 1 }] });
  const b = L.buildBackup({ ['chat:' + ID]: rec('https://claude.ai/share/abcdef123') });
  assert.equal(b.chats['chat:' + ID].shareUrl, 'https://claude.ai/share/abcdef123');
  const { out } = L.applyBackup({}, JSON.parse(JSON.stringify(b)), () => 'n1');
  assert.equal(out['chat:' + ID].shareUrl, 'https://claude.ai/share/abcdef123');
  const evil = L.applyBackup({}, { format: 'highlighter-for-claude', chats: { ['chat:' + ID]: rec('javascript:alert(1)') } }, () => 'n2');
  assert.equal(evil.out['chat:' + ID].shareUrl, undefined);
});

test('custom colours: validated, named, kept in backups and merged on restore', () => {
  const s = { customColors: { c1: '#FF8A3D', c2: 'red', c9: '#000000' }, colorNames: { c1: 'Method' } };
  assert.deepEqual(L.customColors(s), { c1: '#ff8a3d' });
  assert.deepEqual(L.colorList(s), ['yellow', 'green', 'blue', 'pink', 'c1']);
  assert.equal(L.colorNames(s).c1, 'Method');
  assert.equal(L.colorNames({}).c2, 'Custom 2');
  assert.equal(L.hexToRgb('#ff8a3d'), '255,138,61');
  const all = { settings: s, ['chat:' + ID1]: { id: ID1, title: 't', url: '', updated: 1, highlights: [hl('x', 'c1')] } };
  const b = L.buildBackup(all);
  assert.deepEqual(b.settings.customColors, { c1: '#ff8a3d' });
  const { out } = L.applyBackup({}, JSON.parse(JSON.stringify(b)), () => 'n1');
  assert.deepEqual(out.settings.customColors, { c1: '#ff8a3d' });
  const k = Object.keys(out).find((x) => x !== 'settings');
  assert.equal(out[k].highlights[0].color, 'c1');
  const keep = L.applyBackup({ settings: { customColors: { c1: '#111111' } } }, JSON.parse(JSON.stringify(b)), () => 'n2');
  assert.deepEqual(keep.out.settings.customColors, { c1: '#111111' });
});
