#!/usr/bin/env node
// Renders the README / video screenshots from the real extension code: the real popup and Library
// pages, and the real content script running on a neutral mock chat page. A stand-in for the
// extension APIs supplies seeded data.   node scripts/media/shots.mjs [outDir]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = resolve(process.argv[2] || join(root, 'docs', 'img'));
mkdirSync(out, { recursive: true });
const read = (p) => readFileSync(join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DAY = 86400000;
const now = Date.now();
const CHAT = '0a1b2c3d-1111-2222-3333-444455556666';
const ID = (n) => `0000000${n}-aaaa-bbbb-cccc-ddddeeeeffff`;
const hl = (id, color, exact, comment = '') => ({ id, color, exact, prefix: '', suffix: '', comment, created: now, updated: now });

const THIS_CHAT = {
  title: 'Sleep and memory consolidation: a literature review',
  url: 'https://claude.ai/chat/' + CHAT,
  updated: now - 2 * 3600e3,
  starred: true,
  tags: ['research', 'sleep'],
  highlights: [
    hl('h1', 'green', 'Slow-wave sleep supports declarative memory consolidation', 'Core claim for section 2'),
    hl('h2', 'yellow', 'effect size d = 0.62 across 14 studies', 'check the confidence interval'),
    hl('h3', 'blue', 'sleep spindle density'),
    hl('h4', 'pink', 'one large study did not replicate'),
  ],
};
const seed = {
  ['chat:' + CHAT]: THIS_CHAT,
  ['gpt:' + ID(2)]: { title: 'Reviewer 2 response: statistical power', url: '', updated: now - 3 * DAY, tags: ['paper'], highlights: [hl('f', 'pink', 'power of 0.8 requires n = 64 per group', 'cite in rebuttal'), hl('g', 'yellow', 'report the exact p-value')] },
  ['chat:' + ID(3)]: { title: 'Postgres partial indexes for multi-tenant queries', updated: now - 6 * DAY, tags: ['backend'], starred: true, highlights: [hl('i', 'green', 'a partial index only helps when the query filter matches its predicate', 'check on prod data'), hl('j', 'blue', 'CREATE INDEX CONCURRENTLY')] },
  ['gpt:' + ID(4)]: { title: 'ESP32 deep-sleep current draw', updated: now - 11 * DAY, tags: ['hardware'], highlights: [hl('k', 'yellow', 'strapping pins must stay at their boot levels'), hl('l', 'green', 'measure with the USB data lines disconnected')] },
  ['chat:' + ID(5)]: { title: 'Grant proposal: aims and milestones', updated: now - 20 * DAY, highlights: [hl('m', 'blue', 'milestones tied to deliverables')] },
  settings: { colorNames: { yellow: 'Claim', green: 'Evidence', blue: 'Term', pink: 'To check' } },
  lastBackup: now - 2 * DAY, autoBackup: true, lastAutoBackup: now - 2 * 3600e3,
};

// ---------- extension API stand-in ----------
const STUB = (seedJson, tabUrl, withMsg) => `(() => {
  const KEY = '__stubstore';
  let data = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (!data) { data = ${seedJson}; localStorage.setItem(KEY, JSON.stringify(data)); }
  const L = []; const M = [];
  const pick = (k) => { if (k == null) return JSON.parse(JSON.stringify(data)); const o = {}; for (const x of [].concat(k)) if (x in data) o[x] = JSON.parse(JSON.stringify(data[x])); return o; };
  const save = () => localStorage.setItem(KEY, JSON.stringify(data));
  window.__sent = [];
  window.chrome = {
    runtime: { id: 'x', getManifest: () => ({ name: 'Tessel', version: '0.7.0' }), getURL: (p) => 'chrome-extension://x/' + p,
      onMessage: { addListener: (f) => M.push(f) }, sendMessage: async () => ({ ok: true }) },
    permissions: { request: async () => true },
    storage: { onChanged: { addListener: (f) => L.push(f) }, local: { QUOTA_BYTES: 10485760,
      get: async (k) => pick(k),
      set: async (o) => { const ch = {}; for (const [k, v] of Object.entries(o)) { ch[k] = { oldValue: data[k], newValue: JSON.parse(JSON.stringify(v)) }; data[k] = JSON.parse(JSON.stringify(v)); } save(); setTimeout(() => L.forEach((f) => f(ch, 'local')), 0); },
      remove: async (k) => { const ch = {}; [].concat(k).forEach((x) => { ch[x] = { oldValue: data[x] }; delete data[x]; }); save(); setTimeout(() => L.forEach((f) => f(ch, 'local')), 0); },
      getBytesInUse: async () => 41200 } },
    tabs: { query: async (q) => (q && q.active && ${JSON.stringify(Boolean(tabUrl))} ? [{ id: 5, url: ${JSON.stringify(tabUrl || '')}, title: 'Sleep and memory consolidation - Claude' }] : []),
      sendMessage: async (id, m) => { window.__sent.push(m);
        if (m.type === 'hfc:status') return { ok: true, site: 'claude', chatId: ${JSON.stringify(CHAT)}, order: ['h1','h3','h2','h4'], unsaved: 0, diag: { site: 'claude' } };
        return { ok: true }; },
      create: async () => {}, update: async () => {} },
    windows: { update: async () => {} },
  };
  window.__send = (msg) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('no response')), 3000); for (const f of M) f(msg, {}, (r) => { clearTimeout(t); res(r); }); });
})();`;

// ---------- a neutral mock chat page ----------
const CHAT_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Sleep and memory consolidation: a literature review - Claude</title>
<style>
body{margin:0;background:#262624;color:#e8e4dc;font:17.5px/1.7 Georgia,'Times New Roman',serif;display:flex;min-height:100vh}
nav{width:250px;flex:none;background:#1f1e1d;border-right:1px solid #3a3835;padding:22px 16px;font:14px/1.4 system-ui,sans-serif;color:#9a958b}
nav b{display:block;color:#d9d4c9;margin-bottom:14px;font-size:15px}
nav div{padding:8px 10px;border-radius:8px;margin-bottom:2px}nav div.on{background:#33312d;color:#ece9e2}
main{flex:1;padding:44px 0 120px;overflow:hidden}
.col{max-width:740px;margin:0 auto;padding:0 28px}
.you{background:#33312d;display:inline-block;border-radius:14px;padding:10px 18px;margin:0 0 26px;font:15.5px system-ui,sans-serif;color:#d6d1c7}
h3{font:600 17px system-ui,sans-serif;margin:26px 0 6px;color:#f1eee8}
p{margin:0 0 14px}
</style></head><body>
<nav><b>Recents</b><div class="on">Sleep and memory consolidation</div><div>Postgres partial indexes</div><div>Reviewer 2 response</div><div>ESP32 deep-sleep current</div><div>Grant proposal: aims</div></nav>
<main><div class="col">
<div class="you" data-testid="user-message"><p style="margin:0">What does the evidence say about sleep and memory consolidation?</p></div>
<div class="font-claude-response">
<p>The evidence is strongest for a division of labour between sleep stages. <span id="s1">Slow-wave sleep supports declarative memory consolidation</span>, while REM sleep appears more important for procedural and emotional memory.</p>
<h3>Effect sizes</h3>
<p>A recent meta-analysis found <span id="s2">effect size d = 0.62 across 14 studies</span> comparing sleep with wake after learning, with moderate heterogeneity between paradigms.</p>
<h3>Mechanisms</h3>
<p>Coupling between slow oscillations and spindles is the leading account. Higher <span id="s3">sleep spindle density</span> after learning predicts better retention the next day, although <span id="s4">one large study did not replicate</span> the association in older adults.</p>
<p id="sel">Open questions remain about causality: most human data are correlational, and targeted memory reactivation during sleep is the most promising causal tool.</p>
</div></div></main></body></html>`;

const rects = {};
const R = async (pg, name, sel, shadow = false) => {
  const r = await pg.evaluate(({ sel, shadow }) => {
    const root = shadow ? document.querySelector('[data-hfc-ui]').shadowRoot : document;
    const el = root.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height, vw: innerWidth, vh: innerHeight };
  }, { sel, shadow });
  if (r) rects[name] = r; else console.warn('no rect for', name);
};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
const seedJson = JSON.stringify(seed);
await ctx.addInitScript({ content: STUB(seedJson, 'https://claude.ai/chat/' + CHAT) });
await ctx.route('https://claude.ai/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: CHAT_HTML }));

// ---- chat page with the real content script ----
const page = await ctx.newPage();
await page.goto('https://claude.ai/chat/' + CHAT, { waitUntil: 'domcontentloaded' });
await page.addStyleTag({ content: read('content.css') });
for (const f of ['lib/sites.js', 'lib/library.js', 'lib/anchor.js', 'lib/export.js', 'lib/keys.js', 'content.js']) await page.addScriptTag({ content: read(f) });
await page.waitForFunction(() => window.__hfcLoaded === true);
await sleep(700);
await page.screenshot({ path: join(out, 'chat-highlights.png') });
for (const n of ['s1', 's2', 's3', 's4']) await R(page, 'chat-' + n, '#' + n);
await R(page, 'chat-col', '.col');

// toolbar on a fresh selection
async function select(sel) {
  const b = await page.evaluate((s) => { const r = document.createRange(); r.selectNodeContents(document.querySelector(s)); const x = r.getBoundingClientRect(); return { l: x.left, r: x.right, y: x.top + x.height / 2 }; }, sel);
  await page.mouse.move(b.l + 1, b.y); await page.mouse.down(); await page.mouse.move(b.r - 1, b.y, { steps: 6 }); await page.mouse.up();
}
await page.evaluate(() => { const p = document.getElementById('sel'); p.innerHTML = p.innerHTML.replace('targeted memory reactivation during sleep', '<span id="pick">targeted memory reactivation during sleep</span>'); });
await sleep(300);
await select('#pick');
await sleep(500);
await R(page, 'chat-pick', '#pick');
await R(page, 'chat-tb', '.tb', true);
await page.screenshot({ path: join(out, 'chat-toolbar.png') });
await page.mouse.click(700, 60);
await sleep(300);

// comment popover on an existing highlight
const r2 = await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('s2')); const b = r.getBoundingClientRect(); return { x: b.left + 30, y: b.top + b.height / 2 }; });
await page.mouse.click(r2.x, r2.y);
await sleep(500);
await R(page, 'chat-pop', '.pop', true);
await page.screenshot({ path: join(out, 'chat-popover.png') });
await page.keyboard.press('Escape');
await page.mouse.click(700, 840);
await sleep(300);

// outline panel
await page.evaluate(() => window.__send({ type: 'hfc:panel', open: true }));
await sleep(500);
await R(page, 'chat-panel', '.panel', true);
rects['chat-panel-items'] = await page.evaluate(() => [...document.querySelector('[data-hfc-ui]').shadowRoot.querySelectorAll('.panel .item, .panel li, .panel .row')].map((e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, vw: innerWidth, vh: innerHeight }; }));
await page.screenshot({ path: join(out, 'chat-panel.png') });
await page.evaluate(() => window.__send({ type: 'hfc:panel', open: false }));

// export
const ex = await page.evaluate(() => window.__send({ type: 'hfc:export', opts: {} }));
writeFileSync(join(out, 'sample-export.html'), ex.html);
const epage = await ctx.newPage();
await epage.setViewportSize({ width: 1200, height: 800 });
await epage.goto('file://' + join(out, 'sample-export.html'));
await sleep(300);
await R(epage, 'export-bar', '.bar');
await R(epage, 'export-go', '[data-go]');
await R(epage, 'export-toggles', '#t-hl');
await epage.screenshot({ path: join(out, 'export.png') });

// ---- popup and library (real pages) ----
const pop = await (await browser.newContext({ viewport: { width: 400, height: 700 }, deviceScaleFactor: 2, colorScheme: 'dark' })).newPage();
await pop.context().addInitScript({ content: STUB(seedJson, 'https://claude.ai/chat/' + CHAT) });
await pop.goto('file://' + join(root, 'popup/popup.html'));
await sleep(700);
await R(pop, 'popup-export', '#btn-export');
await R(pop, 'popup-card', '.card, #ctx, header + *');
await pop.screenshot({ path: join(out, 'popup-chat.png') });
await pop.evaluate(() => (document.querySelector('#more').open = true));
await sleep(200);
await pop.setViewportSize({ width: 400, height: 860 });
await R(pop, 'popup-more', '#more');
await R(pop, 'popup-goclaude', '#go-claude');
await pop.screenshot({ path: join(out, 'popup-share.png') });
await pop.click('#tab-all');
await sleep(400);
await pop.setViewportSize({ width: 400, height: 700 });
await pop.screenshot({ path: join(out, 'popup-all.png') });

const lib = await (await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2, colorScheme: 'dark' })).newPage();
await lib.context().addInitScript({ content: STUB(seedJson, '') });
await lib.goto('file://' + join(root, 'library/library.html'));
await sleep(700);
await R(lib, 'lib-q', '#q');
await R(lib, 'lib-card1', '.card');
await R(lib, 'lib-rail', '.rail, aside, nav');
await lib.screenshot({ path: join(out, 'library.png') });
await lib.fill('#q', 'spindle');
await sleep(400);
await lib.screenshot({ path: join(out, 'library-search.png') });
await lib.fill('#q', '');
await lib.click('#go-settings');
await sleep(500);
await R(lib, 'set-auto', '#t-auto');
await R(lib, 'set-backup', '#btn-backup');
await R(lib, 'set-names', '#names');
await lib.screenshot({ path: join(out, 'library-settings.png'), fullPage: true });

writeFileSync(join(out, 'rects.json'), JSON.stringify(rects, null, 1));
writeFileSync(join(root, 'video', 'rects.js'), 'window.RECTS = ' + JSON.stringify(rects) + ';\n');
await browser.close();
console.log('screenshots written to', out);
