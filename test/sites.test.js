'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const S = require('../lib/sites.js');
const { buildExportHtml } = require('../lib/export.js');

const ID = '11111111-2222-3333-4444-555555555555';

test('hostnames map to the right profile, exactly', () => {
  assert.equal(S.detect('claude.ai').id, 'claude');
  assert.equal(S.detect('chatgpt.com').id, 'chatgpt');
  assert.equal(S.detect('CHATGPT.COM').id, 'chatgpt');
  for (const bad of ['', null, undefined, 'example.com', 'claude.ai.evil.com', 'evilclaude.ai', 'notchatgpt.com', 'chatgpt.com.evil.io', 'www.chatgpt.com']) {
    assert.equal(S.detect(bad), null, String(bad));
  }
});

test('Claude profile keeps the exact v0.2 values (existing highlights must keep working)', () => {
  const c = S.byId('claude');
  assert.equal(c.keyPrefix, 'chat:');
  assert.deepEqual(c.rootSelectors, ['main']);
  assert.equal(c.chatIdFromPath('/chat/' + ID), ID);
  assert.equal(c.chatUrl(ID), 'https://claude.ai/chat/' + ID);
  assert.equal('ESP32 setup - Claude'.replace(c.titleSuffix, ''), 'ESP32 setup');
  assert.deepEqual(c.roles.map((r) => r.role), ['user', 'claude']);
  assert.deepEqual(c.exportRemove, []);
});

test('chat IDs are read from each site\'s URL shapes', () => {
  assert.deepEqual(S.matchUrl('https://claude.ai/chat/' + ID).id, ID);
  assert.equal(S.matchUrl('https://claude.ai/new'), null);
  assert.equal(S.matchUrl('https://claude.ai/c/' + ID), null, 'ChatGPT path shape is not valid on claude.ai');
  assert.equal(S.matchUrl('https://chatgpt.com/c/' + ID).site.id, 'chatgpt');
  assert.equal(S.matchUrl('https://chatgpt.com/c/' + ID + '?model=gpt-5').id, ID);
  assert.equal(S.matchUrl('https://chatgpt.com/g/g-abc123def-my-gpt/c/' + ID).id, ID, 'custom GPT chat');
  assert.equal(S.matchUrl('https://chatgpt.com/g/g-p-abc123def456-proj/c/' + ID).id, ID, 'project chat');
  assert.equal(S.matchUrl('https://chatgpt.com/uc/' + ID).id, ID, 'signed-out chats live under /uc/');
  assert.equal(S.matchUrl('https://chatgpt.com/'), null, 'new chat has no id yet');
  assert.equal(S.matchUrl('https://chatgpt.com/chat/' + ID), null, 'Claude path shape is not valid on chatgpt.com');
  assert.equal(S.matchUrl('http://chatgpt.com/c/' + ID), null, 'https only');
  assert.equal(S.matchUrl('not a url'), null);
});

test('storage keys round-trip and cannot be confused across sites', () => {
  for (const site of S.PROFILES) {
    const m = S.matchKey(site.keyPrefix + ID);
    assert.equal(m.site, site);
    assert.equal(m.id, ID);
  }
  assert.equal(S.matchKey('settings'), null);
  assert.equal(S.matchKey('pendingJump'), null);
  assert.equal(S.matchKey('chat:short'), null);
  assert.equal(S.matchKey('gpt:../../x'), null);
  assert.equal(new Set(S.PROFILES.map((p) => p.keyPrefix)).size, S.PROFILES.length, 'prefixes are unique');
  assert.ok(S.PROFILES.every((p) => !S.PROFILES.some((q) => q !== p && q.keyPrefix.startsWith(p.keyPrefix))), 'no prefix of another');
});

test('manifest and background cover exactly the profiled hosts', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  const want = S.PROFILES.flatMap((p) => p.hosts.map((h) => 'https://' + h + '/*')).sort();
  assert.deepEqual([...m.host_permissions].sort(), want);
  assert.deepEqual([...m.content_scripts[0].matches].sort(), want);
  assert.equal(m.content_scripts[0].js[0], 'lib/sites.js', 'sites.js must load before the scripts that use it');
  const bg = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  assert.match(bg, /importScripts\('lib\/sites\.js'/);
});

test('ChatGPT export: roles labelled, screen-reader headings dropped, Claude labels absent', () => {
  const dom = new JSDOM(
    '<!doctype html><body><main>' +
      '<article><h6 class="sr-only">You said:</h6><div data-message-author-role="user"><p>Is it ready?</p></div></article>' +
      '<article><h6 class="sr-only">ChatGPT said:</h6><div data-message-author-role="assistant"><p>Yes, it is ready.</p></div></article>' +
      '</main></body>'
  );
  const site = S.byId('chatgpt');
  const { html, applied } = buildExportHtml({
    rootEl: dom.window.document.querySelector('main'),
    title: 'T',
    highlights: [{ exact: 'it is ready', prefix: 'Yes, ', suffix: '.', color: 'blue', comment: '' }],
    roles: site.roles,
    remove: site.exportRemove,
  });
  assert.equal(applied, 1);
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelector('[data-hfc-role="user"]').textContent.trim(), 'Is it ready?');
  assert.equal(doc.querySelector('[data-hfc-role="chatgpt"] mark').textContent, 'it is ready');
  assert.ok(html.includes('content:"ChatGPT"') && !html.includes('content:"Claude"'));
  assert.ok(!html.includes('said:'));
});

test('without options the export behaves as before (Claude labels)', () => {
  const dom = new JSDOM('<!doctype html><body><main><div class="font-claude-response"><p>Hi there</p></div></main></body>');
  const { html } = buildExportHtml({ rootEl: dom.window.document.querySelector('main'), highlights: [] });
  assert.ok(html.includes('data-hfc-role="claude"') && html.includes('content:"Claude"'));
});

test('ChatGPT: the page itself names the chat, in either markup generation', () => {
  const site = S.byId('chatgpt');
  const root = (html) => new JSDOM('<!doctype html><body><main>' + html + '</main></body>').window.document.querySelector('main');
  assert.equal(site.chatIdFromPage(root('<section data-conversation-id="' + ID + '"><ol></ol></section>')), ID);
  assert.equal(site.chatIdFromPage(root('<p>nothing</p>')), null);
  assert.equal(site.chatIdFromPage(root('<section data-conversation-id="x"></section>')), null, 'implausible ids are ignored');
  assert.equal(site.chatIdFromPage(root('<section data-conversation-id="../../etc/passwd"></section>')), null);
  assert.equal(S.byId('claude').chatIdFromPage, undefined, 'Claude relies on its address');

  const sel = (role) => site.roles.find((r) => r.role === role).selectors.join(',');
  const old = root('<div data-message-author-role="user">q</div><div data-message-author-role="assistant">a</div>');
  const neu = root('<ol><li data-message-role="user" id="u">q</li><li data-message-role="assistant" id="a">a</li></ol>');
  for (const r of [old, neu]) {
    assert.equal(r.querySelectorAll(sel('user')).length, 1);
    assert.equal(r.querySelectorAll(sel('chatgpt')).length, 1);
  }
});

test('ChatGPT export labels work with the newer message markup', () => {
  const dom = new JSDOM(
    '<!doctype html><body><main><ol><li data-message-role="user" id="u"><p>Is it ready?</p></li>' +
      '<li data-message-role="assistant" id="a"><p>Yes, it is ready.</p></li></ol></main></body>'
  );
  const site = S.byId('chatgpt');
  const { html } = buildExportHtml({ rootEl: dom.window.document.querySelector('main'), title: 'T', highlights: [], roles: site.roles, remove: site.exportRemove });
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelector('[data-hfc-role="user"]').textContent.trim(), 'Is it ready?');
  assert.ok(doc.querySelector('[data-hfc-role="chatgpt"]'));
});

test('a pasted share link is accepted only for a supported site, over https, without tricks', () => {
  const ok = S.matchShareUrl('https://claude.ai/share/abc12345-6789#frag');
  assert.equal(ok.site.id, 'claude');
  assert.equal(ok.url, 'https://claude.ai/share/abc12345-6789');
  assert.equal(S.matchShareUrl('https://chatgpt.com/share/e/abc123').site.id, 'chatgpt');
  for (const bad of ['javascript:alert(1)', 'http://claude.ai/share/abc123', 'https://evil.com/share/abc123',
    'https://claude.ai.evil.com/share/abc123', 'https://user:pw@claude.ai/share/abc123', 'https://claude.ai:8443/share/abc123',
    'https://claude.ai/', '', null, 'not a url']) {
    assert.equal(S.matchShareUrl(bad), null, String(bad));
  }
  assert.ok(S.byId('claude').newChat.endsWith('?q=') && S.byId('chatgpt').newChat.endsWith('?q='));
});
