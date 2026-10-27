#!/usr/bin/env node
// End-to-end test of the popup and the Library page in a real Chromium, with a stand-in for the
// extension APIs (storage, tabs) seeded with chats from both platforms.
//
//   CHROME_PATH="/path/to/chrome" node test/e2e/ui.mjs     (npm run test:e2e runs it too)

import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!process.env.CHROME_PATH) {
  console.error('Set CHROME_PATH to a Chrome/Chromium executable.');
  process.exit(2);
}
const DAY = 86400000;
const now = Date.now();
const hl = (id, color, exact, comment = '') => ({ id, color, exact, prefix: '', suffix: '', comment, created: now, updated: now });
const ID = (n) => `0000000${n}-aaaa-bbbb-cccc-ddddeeeeffff`;
const seed = () => ({
  ['chat:' + ID(1)]: { title: 'Sleep and memory', updated: now - 3600e3, starred: true, tags: ['research'], highlights: [hl('a', 'green', 'slow-wave sleep', 'core claim'), hl('b', 'blue', 'spindle density'), hl('c', 'yellow', 'effect size')] },
  ['gpt:' + ID(2)]: { title: 'Home office deduction', updated: now - 3 * DAY, highlights: [hl('d', 'pink', 'simplified method'), hl('e', 'yellow', 'regular use')] },
  ['chat:' + ID(3)]: { title: 'ESP32 setup', updated: now - 40 * DAY, highlights: [hl('f', 'yellow', 'GPIO2 pin')] },
  settings: { colorNames: { yellow: 'Claim', blue: 'Term' } },
});
const STUB = (seedJson, tabUrl) => `(() => {
  const data = ${seedJson};
  const L = [];
  window.__sent = [];
  window.chrome = {
    runtime: { getManifest: () => ({ name: 'Test', version: '9.9.9' }), getURL: (p) => 'chrome-extension://x/' + p, id: 'x', sendMessage: async (m) => { window.__sent.push(m); return { ok: true }; } },
    permissions: { request: async (q) => { window.__asked = q; return true; } },
    storage: { onChanged: { addListener: (f) => L.push(f) }, local: { QUOTA_BYTES: 10485760,
      get: async (k) => { if (k == null) return JSON.parse(JSON.stringify(data)); const o = {}; for (const x of [].concat(k)) if (x in data) o[x] = JSON.parse(JSON.stringify(data[x])); return o; },
      set: async (o) => { Object.assign(data, JSON.parse(JSON.stringify(o))); L.forEach((f) => f({}, 'local')); },
      remove: async (k) => { [].concat(k).forEach((x) => delete data[x]); L.forEach((f) => f({}, 'local')); },
      getBytesInUse: async () => 2048 } },
    tabs: { query: async (q) => (q && q.active ? ${tabUrl ? `[{ id: 5, url: '${tabUrl}', title: 'Sleep and memory - Claude' }]` : '[]'} : []),
      sendMessage: async (id, m) => { window.__sent.push(m); if (m.type === 'hfc:status') return { ok: true, site: 'claude', chatId: '${ID(1)}', order: ['a', 'b', 'c'], unsaved: 0, diag: { site: 'claude' } };
        if (m.type === 'hfc:transcript') return { ok: true, transcript: 'Me:\\nhi\\n\\nAssistant:\\nhello' };
        if (m.type === 'hfc:share') return { ok: true, url: m.url };
        if (m.type === 'hfc:export') return { ok: true, html: '<p>x</p>', filename: 'x.html', missing: 0 };
        return { ok: true }; },
      create: async (o) => { window.__created = o.url; }, update: async () => {} },
    windows: { update: async () => {} },
  };
  window.__data = data;
})();`;

const args = (process.env.CHROME_ARGS || '').split(' ').filter(Boolean);
if (process.getuid && process.getuid() === 0 && !args.includes('--no-sandbox')) args.push('--no-sandbox');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, args, headless: process.env.HEADLESS_SHELL ? 'shell' : true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(file, tabUrl) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.evaluateOnNewDocument(STUB(JSON.stringify(seed()), tabUrl));
  await page.evaluateOnNewDocument(() => { HTMLAnchorElement.prototype.click = function () { window.__downloads = (window.__downloads || 0) + 1; }; });
  await page.goto('file://' + root + '/' + file);
  await sleep(300);
  page.errors = errors;
  return page;
}
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
const data = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__data)));

let failed = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log('  ok    ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL  ' + name + '\n        ' + String(e.message || e).split('\n').join('\n        '));
  }
}

console.log('Popup and Library: end-to-end test\n');

{
  const p = await open('library/library.html');
  await step('library lists chats from both platforms, starred first, with the sidebar counts', async () => {
    assert.deepEqual(await texts(p, '.card .card-title a'), ['Sleep and memory', 'Home office deduction', 'ESP32 setup']);
    const nav = await texts(p, '#nav .navitem');
    assert.deepEqual(nav, ['All chats3', 'Claude2', 'ChatGPT1', '★ Starred1']);
    assert.match((await texts(p, '#summary'))[0], /3 chats · 6 highlights/);
  });
  await step('platform filter and starred filter', async () => {
    await p.evaluate(() => [...document.querySelectorAll('#nav .navitem')].find((b) => b.textContent.startsWith('ChatGPT')).click());
    assert.deepEqual(await texts(p, '.card .card-title a'), ['Home office deduction']);
    await p.evaluate(() => [...document.querySelectorAll('#nav .navitem')].find((b) => b.textContent.startsWith('★')).click());
    assert.deepEqual(await texts(p, '.card .card-title a'), ['Sleep and memory']);
    await p.evaluate(() => [...document.querySelectorAll('#nav .navitem')][0].click());
  });
  await step('colour names show in the sidebar; colour filter narrows chats and highlights', async () => {
    const colours = await texts(p, '#colors .navitem');
    assert.deepEqual(colours, ['Claim3', 'Green1', 'Term1', 'Pink1']);
    await p.evaluate(() => [...document.querySelectorAll('#colors .navitem')].find((b) => b.textContent.startsWith('Term')).click());
    assert.deepEqual(await texts(p, '.card .card-title a'), ['Sleep and memory']);
    assert.deepEqual(await texts(p, '.card .hl .quote'), ['spindle density']);
    await p.evaluate(() => [...document.querySelectorAll('#summary .chip')].find((b) => b.textContent.startsWith('Term')).click());
    assert.equal((await texts(p, '.card')).length, 3);
  });
  await step('search finds text in highlights, comments and titles', async () => {
    await p.type('#q', 'core claim');
    assert.deepEqual(await texts(p, '.card .card-title a'), ['Sleep and memory']);
    await p.$eval('#q', (e) => ((e.value = 'home'), e.dispatchEvent(new Event('input'))));
    assert.deepEqual(await texts(p, '.card .card-title a'), ['Home office deduction']);
    await p.$eval('#q', (e) => ((e.value = ''), e.dispatchEvent(new Event('input'))));
  });
  await step('star toggles and is stored', async () => {
    await p.evaluate(() => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('ESP32')).querySelector('.star').click());
    await sleep(150);
    assert.equal((await data(p))['chat:' + ID(3)].starred, true);
    assert.equal((await texts(p, '.card .card-title a'))[1], 'ESP32 setup', 'starred chats float up');
  });
  await step('adding and removing a tag', async () => {
    await p.evaluate(() => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('Home office')).querySelector('.tagrow .btn').click());
    await p.keyboard.type('Taxes');
    await p.keyboard.press('Enter');
    await sleep(200);
    assert.deepEqual((await data(p))['gpt:' + ID(2)].tags, ['Taxes']);
    assert.ok((await texts(p, '#tags .navitem')).some((t) => t.startsWith('#Taxes')), 'tag appears in the sidebar');
    await p.evaluate(() => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('Home office')).querySelector('.tag button').click());
    await sleep(200);
    assert.deepEqual((await data(p))['gpt:' + ID(2)].tags, []);
  });
  await step('"Show all" expands a card', async () => {
    const card = () => p.evaluate(() => document.querySelector('.card').querySelectorAll('.hl').length);
    assert.equal(await card(), 3);
    await p.evaluate(() => document.querySelector('.card .more') && document.querySelector('.card .more').click());
    assert.equal(await card(), 3, 'a chat with exactly 3 highlights has no "show all"');
  });
  await step('backup downloads a v2 file with both platforms and records the time', async () => {
    await p.evaluate(() => {
      window.__blobs = [];
      URL.createObjectURL = (b) => (window.__blobs.push(b), 'blob:x');
      HTMLAnchorElement.prototype.click = function () {};
    });
    await p.click('#go-settings');
    await p.click('#btn-backup');
    await sleep(300);
    const text = await p.evaluate(() => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsText(window.__blobs[0]); }));
    const b = JSON.parse(text);
    assert.equal(b.version, 2);
    assert.deepEqual(Object.keys(b.chats).sort(), ['chat:' + ID(1), 'chat:' + ID(3), 'gpt:' + ID(2)].sort());
    assert.ok((await data(p)).lastBackup > now);
    assert.equal(b.settings.colorNames.yellow, 'Claim');
  });
  await step('automatic backups: asks for the downloads permission, saves the choice, triggers a first backup', async () => {
    await p.evaluate(() => document.querySelector('#t-auto').click());
    await sleep(300);
    assert.deepEqual(await p.evaluate(() => window.__asked), { permissions: ['downloads'] });
    assert.equal((await data(p)).autoBackup, true);
    assert.ok(await p.evaluate(() => window.__sent.some((m) => m.type === 'hfc:backup-now')));
    assert.match(await p.$eval('#auto-status', (e) => e.textContent), /Downloads|first file/);
  });
  await step('colour names can be edited and reset', async () => {
    await p.$eval('#name-pink', (e) => ((e.value = 'To check'), e.dispatchEvent(new Event('change'))));
    await sleep(200);
    assert.equal((await data(p)).settings.colorNames.pink, 'To check');
    await p.click('#names-reset');
    await sleep(200);
    assert.equal((await data(p)).settings.colorNames, undefined);
  });
  await step('custom colours can be added, recoloured, named and removed', async () => {
    await p.click('#color-add');
    await sleep(300);
    assert.ok(await p.$('#hex-c1'), 'a colour picker for the new colour');
    await p.$eval('#hex-c1', (e) => ((e.value = '#112233'), e.dispatchEvent(new Event('change'))));
    await sleep(250);
    await p.$eval('#name-c1', (e) => ((e.value = 'Method'), e.dispatchEvent(new Event('change'))));
    await sleep(250);
    const st = (await data(p)).settings;
    assert.equal(st.customColors.c1, '#112233');
    assert.equal(st.colorNames.c1, 'Method');
    await p.evaluate(() => [...document.querySelectorAll('#names .btn')].find((b) => b.textContent === 'Remove').click());
    await sleep(300);
    assert.equal((await data(p)).settings.customColors.c1, undefined);
    assert.equal(await p.$('#hex-c1'), null);
  });
  await step('delete a chat (two clicks), then delete everything (two clicks)', async () => {
    await p.click('#back');
    const del = () => p.evaluate(() => { const b = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('ESP32')).querySelector('.btn.danger'); b.click(); return b.textContent; });
    assert.match(await del(), /Delete 1 highlight\?/);
    await del();
    await sleep(200);
    assert.equal((await data(p))['chat:' + ID(3)], undefined);
    await p.click('#go-settings');
    await p.click('#btn-wipe');
    await p.click('#btn-wipe');
    await sleep(200);
    const left = Object.keys(await data(p)).filter((k) => /^(chat|gpt):/.test(k));
    assert.deepEqual(left, []);
  });
  await step('empty library on a fresh install offers to restore from a backup file', async () => {
    await p.evaluate(() => chrome.storage.local.remove('lastBackup'));
    await p.click('#back');
    await sleep(200);
    assert.match(await p.$eval('#banner', (e) => e.textContent), /Reinstalled/);
  });
  await step('no errors on the library page', async () => assert.deepEqual(p.errors, []));
  await p.close();
}

{
  const p = await open('popup/popup.html', 'https://claude.ai/chat/' + ID(1));
  await p.setViewport({ width: 400, height: 700 });
  await step('popup shows the current chat with its platform, count, and colour-named chips', async () => {
    assert.match((await texts(p, '#ctx'))[0], /Claude\s*★?\s*Sleep and memory\s*3 highlights · 1 comment/);
    assert.deepEqual(await texts(p, '#list .quote'), ['slow-wave sleep', 'spindle density', 'effect size']);
    assert.deepEqual(await texts(p, '#chips .chip'), ['All', 'Claim', 'Green', 'Term']);
  });
  await step('colour chip filters the list and renames the export button', async () => {
    await p.evaluate(() => [...document.querySelectorAll('#chips .chip')].find((b) => b.textContent === 'Term').click());
    assert.deepEqual(await texts(p, '#list .quote'), ['spindle density']);
    assert.equal((await texts(p, '#btn-export'))[0], 'Export Term');
    await p.click('#btn-export');
    await sleep(200);
    const sent = await p.evaluate(() => window.__sent.filter((m) => m.type === 'hfc:export'));
    assert.deepEqual(sent[0].opts.colors, ['blue']);
    await p.evaluate(() => [...document.querySelectorAll('#chips .chip')][0].click());
  });
  await step('All chats tab: platform segments with counts, and search', async () => {
    await p.click('#tab-all');
    await sleep(150);
    assert.deepEqual(await texts(p, '#seg button'), ['All 3', 'Claude 2', 'ChatGPT 1']);
    await p.evaluate(() => [...document.querySelectorAll('#seg button')][2].click());
    await sleep(100);
    assert.deepEqual(await texts(p, '#all-list .ct'), ['Home office deduction']);
    await p.evaluate(() => [...document.querySelectorAll('#seg button')][0].click());
    await p.type('#allq', 'gpio');
    await sleep(100);
    assert.deepEqual(await texts(p, '#all-list .ct'), ['ESP32 setup']);
  });
  await step('settings view shows diagnostics from the page', async () => {
    await p.click('#btn-gear');
    assert.match((await texts(p, '#diag-out'))[0], /"site": "claude"/);
  });
  await step('popup: continue in the other platform opens a prefilled new chat; share link is saved via the page', async () => {
    await p.click('#tab-chat');
    await p.evaluate(() => (document.querySelector('#more').open = true));
    await p.click('#go-chatgpt');
    await sleep(300);
    const url = await p.evaluate(() => window.__created);
    assert.ok(url.startsWith('https://chatgpt.com/?q='), url);
    assert.match(decodeURIComponent(url.split('?q=')[1]), /Me:\nhi/);
    await p.click('#go-claude');
    await sleep(300);
    assert.ok((await p.evaluate(() => window.__created)).startsWith('https://claude.ai/new?q='));
    await p.$eval('#share-url', (e) => (e.value = 'https://claude.ai/share/abcdef123'));
    await p.click('#share-save');
    await sleep(200);
    const sent = await p.evaluate(() => window.__sent.filter((m) => m.type === 'hfc:share'));
    assert.equal(sent.at(-1).url, 'https://claude.ai/share/abcdef123');
  });
  await step('no errors on the popup', async () => assert.deepEqual(p.errors, []));
  await p.close();

  const off = await open('popup/popup.html', null);
  await step('popup on a non-chat tab opens on All chats and points the way', async () => {
    assert.equal(await off.$eval('#view-all', (e) => e.hidden), false);
    await off.click('#tab-chat');
    assert.match((await texts(off, '#ctx'))[0], /Not on a chat page/);
    assert.deepEqual(await texts(off, '#ctx .btn'), ['Open claude.ai', 'Open chatgpt.com']);
    assert.deepEqual(off.errors, []);
  });
}

await browser.close();
console.log(failed ? `\n${failed} step(s) failed` : '\nall steps passed');
process.exit(failed ? 1 : 0);
