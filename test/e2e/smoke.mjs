#!/usr/bin/env node
// End-to-end smoke test in a real Chromium, driven with real mouse and keyboard input.
//
//   CHROME_PATH="/path/to/chrome" npm run test:e2e
//
// It serves a mock chat page (intercepted: nothing touches the network), injects the extension's content scripts with an in-memory stand-in for the
// extension storage API, then exercises: the selection toolbar, quick keys, comments, stepping
// through highlights, persistence across reload, re-renders, export, and the settings switches.
//
// E2E_SITE picks the mock: claude (default, https://claude.ai/chat/<id>), chatgpt
// (https://chatgpt.com/c/<id>, older ChatGPT markup), chatgpt2 (newer ChatGPT markup, where the page
// itself names the chat) or other (an unsupported host, where the extension must do nothing). `npm run test:e2e` runs all three.
//
// Optional env: CHROME_ARGS (extra flags, space separated), HEADLESS_SHELL=1 (use the headless
// shell build), E2E_SHOTS=<dir> (save screenshots there).

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

if (!process.env.CHROME_PATH) {
  console.error('Set CHROME_PATH to a Chrome/Chromium executable, e.g. CHROME_PATH=/usr/bin/chromium npm run test:e2e');
  process.exit(2);
}

const CHAT_ID = '11111111-2222-3333-4444-555555555555';
const SITES = {
  claude: { url: `https://claude.ai/chat/${CHAT_ID}`, suffix: 'Claude', keyPrefix: 'chat:' },
  chatgpt: { url: `https://chatgpt.com/c/${CHAT_ID}`, suffix: 'ChatGPT', keyPrefix: 'gpt:', family: 'chatgpt' },
  chatgpt2: { url: `https://chatgpt.com/c/${CHAT_ID}`, suffix: 'ChatGPT', keyPrefix: 'gpt:', family: 'chatgpt', domId: true },
  other: { url: `https://example.com/chat/${CHAT_ID}`, suffix: 'Claude', keyPrefix: 'chat:' },
};
SITES.claude.home = 'https://claude.ai/new';
SITES.claude.chatPath = (id) => `/chat/${id}`;
SITES.chatgpt.home = SITES.chatgpt2.home = 'https://chatgpt.com/';
SITES.chatgpt.chatPath = SITES.chatgpt2.chatPath = (id) => `/c/${id}`;
for (const c of Object.values(SITES)) c.family = c.family || 'claude';
const NEW_ID = 'dddddddd-1111-2222-3333-444444444444';
const NEW_ID2 = 'eeeeeeee-1111-2222-3333-444444444444';
const NEW_ID3 = 'ffffffff-1111-2222-3333-444444444444';
const SITE = process.env.E2E_SITE || 'claude';
if (!SITES[SITE]) throw new Error('E2E_SITE must be one of: ' + Object.keys(SITES).join(', '));
const cfg = SITES[SITE];
const CHAT_URL = cfg.url;
const CONTENT_FILES = ['lib/sites.js', 'lib/library.js', 'lib/anchor.js', 'lib/export.js', 'lib/keys.js', 'content.js'];
const PAGE0 = `<!doctype html><html><head><meta charset="utf-8"><title>ESP32 setup - ${cfg.suffix}</title>
<style>body{margin:0;background:#1a1a19;color:#ece9e2;font:17px/1.6 Georgia,serif}
nav{padding:8px 24px;color:#8f8b83}main{padding:24px 64px;max-width:820px}
#composer{margin-top:24px;padding:10px;border:1px solid #444;border-radius:8px}</style></head><body>
<nav id="side">Sidebar: ESP32 setup</nav>
<main>
  <p id="p0">That's it, you're fully set up.</p>
  <p>To recap what you just confirmed working end-to-end:</p>
  <ul><li>Arduino IDE 2 talking to your ESP32 clone</li><li id="drivers">Drivers/port working</li>
  <li>Code compiling and uploading successfully</li></ul>
  <p id="p2">That GPIO2 pin is good to remember.</p>
  <p id="p1">From here you're basically ready to build anything.</p>
  <div id="composer" contenteditable="true">my draft text</div>
</main></body></html>`;
// ChatGPT-style turns: a screen-reader-only heading plus data-message-author-role containers.
const PAGE =
  SITE === 'chatgpt2'
    ? // newer ChatGPT markup: <section data-conversation-id> > ol > li[data-message-role]
      PAGE0.replace(
        '<p id="p0">',
        `<section aria-label="Conversation" data-conversation-id="${CHAT_ID}"><ol data-conversation-transcript>` +
          '<li data-message-role="user" id="m-user-1"><p>Is my board ready?</p></li>' +
          '<li data-message-role="assistant" id="m-asst-1"><p id="p0">'
      ).replace('<div id="composer"', '</li></ol></section><div id="composer"')
    : SITE === 'chatgpt'
    ? PAGE0.replace(
        '<p id="p0">',
        '<article><h6 class="sr-only">You said:</h6><div data-message-author-role="user"><p>Is my board ready?</p></div></article>' +
          '<article><h6 class="sr-only">ChatGPT said:</h6><div data-message-author-role="assistant"><p id="p0">'
      ).replace('<div id="composer"', '</div></article><div id="composer"')
    : PAGE0;

// Stand-in for the extension APIs the content script uses, backed by localStorage so it survives reloads.
const STUB = `(() => {
  const KEY = '__stubstore';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } };
  const save = (o) => localStorage.setItem(KEY, JSON.stringify(o));
  const changeListeners = [];
  const msgListeners = [];
  const fire = (changes) => setTimeout(() => changeListeners.forEach((fn) => fn(changes, 'local')), 0);
  const pick = (s, keys) => {
    if (keys == null) return { ...s };
    const out = {};
    for (const k of [].concat(keys)) if (k in s) out[k] = s[k];
    return out;
  };
  window.chrome = {
    runtime: { id: 'stub-extension', onMessage: { addListener: (fn) => msgListeners.push(fn) } },
    storage: {
      onChanged: { addListener: (fn) => changeListeners.push(fn) },
      local: {
        get: async (keys) => pick(load(), keys),
        set: async (obj) => {
          const s = load(); const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            const nv = JSON.parse(JSON.stringify(v));
            changes[k] = { oldValue: s[k], newValue: nv }; s[k] = nv;
          }
          save(s); fire(changes);
        },
        remove: async (keys) => {
          const s = load(); const changes = {};
          for (const k of [].concat(keys)) if (k in s) { changes[k] = { oldValue: s[k] }; delete s[k]; }
          save(s); fire(changes);
        },
      },
    },
  };
  window.__send = (msg) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no response to ' + msg.type)), 3000);
    for (const fn of msgListeners) fn(msg, {}, (r) => { clearTimeout(t); resolve(r); });
  });
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = (process.env.CHROME_ARGS || '').split(' ').filter(Boolean);
if (process.getuid && process.getuid() === 0 && !args.includes('--no-sandbox')) args.push('--no-sandbox');

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  args,
  headless: process.env.HEADLESS_SHELL ? 'shell' : true,
});
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 560 });
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pageErrors.push(m.text());
});
await page.setRequestInterception(true);
page.on('request', (req) => {
  if (req.url() === CHAT_URL || req.url() === cfg.home) req.respond({ status: 200, contentType: 'text/html', body: PAGE });
  else req.respond({ status: 204, body: '' });
});
await page.evaluateOnNewDocument(STUB);

async function inject() {
  await page.addStyleTag({ content: read('content.css') });
  for (const f of CONTENT_FILES) await page.addScriptTag({ content: read(f) });
}
async function load() {
  await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded' });
  await inject();
  await page.waitForFunction(() => window.__hfcLoaded === true);
  await sleep(300);
}

const getState = () =>
  page.evaluate((prefix) => {
    const sr = document.querySelector('[data-hfc-ui]').shadowRoot;
    const tb = sr.querySelector('.tb');
    const pop = sr.querySelector('.pop');
    const toast = sr.querySelector('.toast');
    const store = JSON.parse(localStorage.getItem('__stubstore') || '{}');
    const chat = store[prefix + location.pathname.split('/').pop()];
    const painted = {};
    for (const c of ['yellow', 'green', 'blue', 'pink']) {
      const hl = CSS.highlights.get('hfc-' + c);
      painted[c] = hl ? [...hl].map((r) => ({ text: r.toString(), live: r.startContainer.isConnected })) : [];
    }
    return {
      toolbar: !tb.hidden,
      popup: !pop.hidden,
      popupText: pop.querySelector('textarea').value,
      toast: toast.hidden ? '' : toast.textContent,
      undo: Boolean(sr.querySelector('.tact')),
      panel: !sr.querySelector('.panel').hidden,
      panelItems: [...sr.querySelectorAll('.pitem .pq')].map((e) => e.textContent),
      focusFlash: CSS.highlights.has('hfc-focus'),
      badges: sr.querySelectorAll('.badge').length,
      painted,
      focus: sr.activeElement ? sr.activeElement.tagName : null,
      saved: chat ? chat.highlights.map((h) => ({ color: h.color, exact: h.exact, comment: h.comment })) : [],
    };
  }, cfg.keyPrefix);

async function waitFor(label, pred, ms = 4000) {
  const end = Date.now() + ms;
  let s;
  while (Date.now() < end) {
    s = await getState();
    if (pred(s)) return s;
    await sleep(50);
  }
  throw new Error(`timed out waiting for: ${label}\nlast state: ${JSON.stringify(s)}`);
}
// Select an element's text with a real mouse drag across it (a headless triple-click does not select).
async function selectText(sel) {
  const box = await page.evaluate((s) => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector(s));
    const b = r.getBoundingClientRect();
    return { l: b.left, r: b.right, y: b.top + b.height / 2 };
  }, sel);
  await page.mouse.move(box.l + 1, box.y);
  await page.mouse.down();
  await page.mouse.move(box.r - 1, box.y, { steps: 8 });
  await page.mouse.up();
}
const chord = async (mod, key) => {
  await page.keyboard.down(mod);
  await page.keyboard.press(key);
  await page.keyboard.up(mod);
};
const shot = async (name) => {
  if (!process.env.E2E_SHOTS) return;
  mkdirSync(process.env.E2E_SHOTS, { recursive: true });
  await page.screenshot({ path: join(process.env.E2E_SHOTS, name), clip: { x: 0, y: 0, width: 960, height: 420 } });
};

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

console.log('Tessel: end-to-end smoke test  [site: ' + SITE + ']');
console.log('browser: ' + (await browser.version()) + '\n');

if (SITE === 'other') {
  // An unsupported host: the content scripts are injected as if the manifest matched, and must do nothing.
  await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded' });
  await inject();
  await sleep(300);
  await step('does nothing on an unsupported site', async () => {
    const r = await page.evaluate(() => ({
      loaded: window.__hfcLoaded === true,
      ui: document.querySelectorAll('[data-hfc-ui]').length,
      painted: CSS.highlights.size,
    }));
    assert.deepEqual(r, { loaded: false, ui: 0, painted: 0 });
    await selectText('#drivers');
    await page.keyboard.press('2');
    await sleep(300);
    assert.equal(await page.evaluate(() => localStorage.getItem('__stubstore')), null, 'nothing is stored');
  });
  await step('a custom colour gets a toolbar swatch, quick key 5 and its own highlight style', async () => {
  await page.evaluate(() =>
    chrome.storage.local.set({ settings: { selectionToolbar: true, quickKeys: true, showHighlights: true, showComments: true, customColors: { c1: '#ff8a3d' } } })
  );
  await sleep(300);
  await selectText('#p1');
  await waitFor('toolbar', (s) => s.toolbar);
  const n = await page.evaluate(() => document.querySelector('[data-hfc-ui]').shadowRoot.querySelectorAll('.tb .tsw').length);
  assert.equal(n, 5, 'toolbar should show four built-in swatches plus one custom');
  await page.keyboard.press('5');
  await sleep(450);
  const st = await getState();
  assert.equal(st.saved[st.saved.length - 1].color, 'c1');
  const css = await page.evaluate(() => document.querySelector('style[data-hfc-css]').textContent);
  assert.match(css, /::highlight\(hfc-c1\)/);
  await page.keyboard.press('6'); // no sixth colour defined: must do nothing
  await sleep(300);
  assert.equal((await getState()).saved.length, st.saved.length);
});

await step('no uncaught errors on the page', async () => assert.deepEqual(pageErrors, []));
  await browser.close();
  console.log(failed ? `\n${failed} step(s) failed` : '\nall steps passed');
  process.exit(failed ? 1 : 0);
}

await load();

await step('content script loads with nothing highlighted yet', async () => {
  const s = await getState();
  assert.equal(s.saved.length, 0);
  assert.equal(Object.values(s.painted).flat().length, 0);
});

await step('selecting text in the conversation shows the toolbar', async () => {
  await selectText('#drivers');
  await waitFor('toolbar', (s) => s.toolbar);
  await shot('1-toolbar.png');
});

await step('key 2 highlights the selection green and hides the toolbar', async () => {
  await page.keyboard.press('2');
  const s = await waitFor('green highlight', (st) => st.saved.length === 1 && st.painted.green.length === 1 && !st.toolbar);
  assert.equal(s.saved[0].exact, 'Drivers/port working');
  assert.equal(s.saved[0].color, 'green');
  assert.equal(s.painted.green[0].text, 'Drivers/port working');
});

await step('C highlights in the last colour and opens a focused comment box', async () => {
  await selectText('#p2');
  await waitFor('toolbar', (s) => s.toolbar);
  await page.keyboard.press('c');
  const s = await waitFor('comment box', (st) => st.popup && st.saved.length === 2);
  assert.equal(s.focus, 'TEXTAREA', 'comment box should have keyboard focus');
  assert.equal(s.saved[1].color, 'green', 'H/C reuse the last colour');
  await page.keyboard.type('check this');
  await waitFor('comment saved', (st) => st.saved[1] && st.saved[1].comment === 'check this');
  await shot('2-comment.png');
  await chord('Control', 'Enter');
  const done = await waitFor('comment box closed', (st) => !st.popup);
  assert.equal(done.badges, 1, 'a comment badge should be shown');
});

await step('Alt+Down steps through highlights, Enter opens the one you reached', async () => {
  await chord('Alt', 'ArrowDown');
  await waitFor('1 of 2', (s) => s.toast.includes('Highlight 1 of 2'));
  await chord('Alt', 'ArrowDown');
  await waitFor('2 of 2', (s) => s.toast.includes('Highlight 2 of 2'));
  await page.keyboard.press('Enter');
  const s = await waitFor('popup via Enter', (st) => st.popup);
  assert.equal(s.popupText, 'check this');
  await page.keyboard.press('Escape');
  await waitFor('popup closed', (st) => !st.popup);
});

await step('Alt+Up wraps around backwards', async () => {
  await chord('Alt', 'ArrowUp');
  await waitFor('1 of 2', (s) => s.toast.includes('Highlight 1 of 2'));
});

await step('text outside the conversation (sidebar) gets no toolbar', async () => {
  await selectText('#side');
  await sleep(350);
  assert.equal((await getState()).toolbar, false);
  await page.mouse.click(20, 500); // collapse the selection
});

await step('status and export report both highlights and leave the prompt box out', async () => {
  const st = await page.evaluate(() => window.__send({ type: 'hfc:status' }));
  assert.equal(st.ok, true);
  assert.equal(st.order.length, 2);
  const r = await page.evaluate(() => window.__send({ type: 'hfc:export', opts: {} }));
  assert.equal(r.ok, true);
  assert.equal(r.applied, 2);
  assert.equal(r.missing, 0);
  assert.equal(r.filename, 'esp32-setup-highlights.html', 'the site name is stripped from the title');
  assert.ok(r.html.includes('<mark data-hl="green">'));
  assert.ok(r.html.includes('data-comment="check this"'));
  assert.ok(r.html.includes('Drivers/port working'));
  assert.ok(!r.html.includes('my draft text'), 'prompt box text must not be exported');
  assert.ok(r.html.includes('id="t-hl"') && r.html.includes('id="t-cm"'), 'recipient toggles');
  if (cfg.family === 'chatgpt') {
    assert.ok(r.html.includes('data-hfc-role="chatgpt"') && r.html.includes('data-hfc-role="user"'), 'role labels');
    assert.ok(r.html.includes('content:"ChatGPT"') && !r.html.includes('content:"Claude"'));
    assert.ok(!r.html.includes('said:'), 'screen-reader-only headings must not be exported');
    assert.ok(r.html.includes('Is my board ready?'));
  } else {
    assert.ok(r.html.includes('content:"Claude"') && !r.html.includes('content:"ChatGPT"'));
  }
});

await step('typing in the prompt box never triggers highlighting', async () => {
  await selectText('#composer');
  await page.keyboard.press('1');
  await sleep(350);
  const s = await getState();
  assert.equal(s.saved.length, 2, 'no highlight should be created from the prompt box');
  assert.equal(s.toolbar, false);
});

await step('highlights survive a full reload', async () => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await inject();
  await page.waitForFunction(() => window.__hfcLoaded === true);
  const s = await waitFor('restored', (st) => st.painted.green.length === 2 && st.badges === 1);
  assert.deepEqual(s.painted.green.map((r) => r.text).sort(), ['Drivers/port working', 'That GPIO2 pin is good to remember.']);
  assert.ok(s.painted.green.every((r) => r.live));
});

await step('highlights re-attach when the page re-renders its DOM', async () => {
  await page.evaluate(() => {
    const m = document.querySelector('main');
    m.innerHTML = m.innerHTML; // brand-new nodes, same text
  });
  const s = await waitFor(
    're-attached',
    (st) => st.painted.green.length === 2 && st.painted.green.every((r) => r.live && r.text.length > 0)
  );
  assert.deepEqual(s.painted.green.map((r) => r.text).sort(), ['Drivers/port working', 'That GPIO2 pin is good to remember.']);
});

const FILL = '<p>' + 'A long research answer, sentence after sentence. '.repeat(10) + '</p>';
const mod2 = async (key) => {
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.keyboard.press(key);
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');
};
const storeKeys = () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('__stubstore') || '{}')));
const storeGet = (k) => page.evaluate((key) => (JSON.parse(localStorage.getItem('__stubstore') || '{}'))[key], k);

await step('Alt+Shift+L opens the highlights panel in reading order; clicking jumps; search filters; Esc closes', async () => {
  await page.mouse.click(20, 500);
  await mod2('KeyL');
  const s = await waitFor('panel', (st) => st.panel);
  assert.deepEqual(s.panelItems, ['Drivers/port working', 'That GPIO2 pin is good to remember.']);
  await page.evaluate(() => document.querySelector('[data-hfc-ui]').shadowRoot.querySelector('.pitem').click());
  await waitFor('flash on jump', (st) => st.focusFlash);
  await page.evaluate(() => {
    const i = document.querySelector('[data-hfc-ui]').shadowRoot.querySelector('.ps');
    i.value = 'gpio';
    i.dispatchEvent(new Event('input'));
  });
  const f = await waitFor('filtered', (st) => st.panelItems.length === 1);
  assert.equal(f.panelItems[0], 'That GPIO2 pin is good to remember.');
  await shot('3-panel.png');
  await page.evaluate(() => {
    const i = document.querySelector('[data-hfc-ui]').shadowRoot.querySelector('.ps');
    i.focus();
  });
  await page.keyboard.press('Escape');
  await waitFor('panel closed', (st) => !st.panel);
  await page.evaluate(() => {
    const i = document.querySelector('[data-hfc-ui]').shadowRoot.querySelector('.ps');
    i.value = '';
  });
});

await step('deleting a highlight offers Undo, and Undo brings it back', async () => {
  const pt = await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#drivers'));
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  await page.mouse.click(pt.x, pt.y);
  await waitFor('popover', (st) => st.popup);
  await page.evaluate(() => document.querySelector('[data-hfc-ui]').shadowRoot.querySelector('.btn.danger').click());
  const gone = await waitFor('deleted', (st) => st.saved.length === 1 && st.undo);
  assert.ok(gone.toast.startsWith('Highlight deleted'));
  await page.evaluate(() => document.querySelector('[data-hfc-ui]').shadowRoot.querySelector('.tact').click());
  const back = await waitFor('restored', (st) => st.saved.length === 2 && st.painted.green.length === 2);
  assert.deepEqual(back.saved.map((x) => x.exact).sort(), ['Drivers/port working', 'That GPIO2 pin is good to remember.']);
});

await step('the toolbar still appears when the site swallows mouseup and pointerup', async () => {
  await page.evaluate(() => {
    for (const ev of ['mouseup', 'pointerup']) addEventListener(ev, (e) => e.stopImmediatePropagation(), true);
  });
  await selectText('#p1');
  await page.mouse.move(30, 520); // the pointer moving with no button down is the recovery signal
  await waitFor('toolbar despite swallowed mouseup', (s) => s.toolbar);
  await page.keyboard.press('Escape');
  await page.mouse.click(20, 500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await inject();
  await page.waitForFunction(() => window.__hfcLoaded === true);
  await waitFor('restored after reload', (st) => st.painted.green.length === 2);
});

if (!cfg.domId) {
await step('new chat with no URL id: highlighting works, then moves to the chat once it gets an id', async () => {
  await page.goto(cfg.home, { waitUntil: 'domcontentloaded' });
  await inject();
  await page.waitForFunction(() => window.__hfcLoaded === true);
  await page.evaluate((f) => document.querySelector('main').insertAdjacentHTML('afterbegin', f), FILL);
  await sleep(300);
  const before = (await storeKeys()).filter((k) => /^(chat|gpt):/.test(k));
  await selectText('#drivers');
  await waitFor('toolbar on a chat with no id', (s) => s.toolbar);
  await page.keyboard.press('3');
  const s = await waitFor('draft highlight', (st) => st.painted.blue.length === 1 && /saved as soon as the site names/.test(st.toast));
  assert.equal(s.painted.blue[0].text, 'Drivers/port working');
  assert.deepEqual((await storeKeys()).filter((k) => /^(chat|gpt):/.test(k)), before, 'nothing is written without an id');
  const st = await page.evaluate(() => window.__send({ type: 'hfc:status' }));
  assert.equal(st.unsaved, 1);
  assert.equal(st.chatId, null);
  // The app gives the chat its address (client-side navigation, as the real sites do).
  await page.evaluate((path) => history.pushState({}, '', path), cfg.chatPath(NEW_ID));
  await waitFor('moved to the new chat', (x) => x.saved.length === 1 && x.saved[0].exact === 'Drivers/port working' && x.saved[0].color === 'blue');
  const rec = await storeGet(cfg.keyPrefix + NEW_ID);
  assert.equal(rec.highlights.length, 1);
  assert.equal(rec.url, cfg.chatPath(NEW_ID) && cfg.url.replace(CHAT_ID, NEW_ID));
});

await step('an unsaved highlight is not carried into an unrelated chat', async () => {
  await page.goto(cfg.home, { waitUntil: 'domcontentloaded' });
  await inject();
  await page.waitForFunction(() => window.__hfcLoaded === true);
  await page.evaluate((f) => document.querySelector('main').insertAdjacentHTML('afterbegin', f), FILL);
  await sleep(300);
  await selectText('#p2');
  await page.keyboard.press('1');
  await waitFor('draft highlight', (st) => st.painted.yellow.length === 1);
  await page.evaluate((path) => {
    // The user opens a different, existing chat: the page content is completely different.
    document.querySelector('main').innerHTML = '<p>Something else entirely about cooking pasta.</p>';
    history.pushState({}, '', path);
  }, cfg.chatPath(NEW_ID2));
  await sleep(1200);
  assert.equal(await storeGet(cfg.keyPrefix + NEW_ID2), undefined);
  assert.equal((await getState()).painted.yellow.length, 0);
});

await step('an empty new-chat page is never refused, but nothing is stored without a chat', async () => {
  await page.goto(cfg.home, { waitUntil: 'domcontentloaded' });
  await inject();
  await page.waitForFunction(() => window.__hfcLoaded === true);
  await page.evaluate(() => {
    document.querySelector('main').innerHTML = '<h1 id="hi">How can I help you today?</h1><p>Try a suggestion</p>';
  });
  await sleep(300);
  const before = (await storeKeys()).filter((k) => /^(chat|gpt):/.test(k)).sort();
  await selectText('#hi');
  await waitFor('toolbar', (s) => s.toolbar);
  await page.keyboard.press('1');
  await sleep(400);
  assert.deepEqual((await storeKeys()).filter((k) => /^(chat|gpt):/.test(k)).sort(), before);
});
}

// Back to the main chat for the settings steps below.
await load();

if (SITE !== 'other') {
  await step('share link: wrong-site links are refused; a good one is stored and appears in the export; transcript has no mention of highlights', async () => {
    const mine = cfg.family === 'chatgpt' ? 'https://chatgpt.com/share/abcdef123' : 'https://claude.ai/share/abcdef123';
    const theirs = cfg.family === 'chatgpt' ? 'https://claude.ai/share/abcdef123' : 'https://chatgpt.com/share/abcdef123';
    const send = (m) => page.evaluate((x) => window.__send(x), m);
    assert.equal((await send({ type: 'hfc:share', url: theirs })).ok, false);
    assert.equal((await send({ type: 'hfc:share', url: 'javascript:alert(1)' })).ok, false);
    assert.equal((await send({ type: 'hfc:share', url: mine })).ok, true);
    const key = cfg.keyPrefix + CHAT_ID;
    await sleep(200);
    assert.equal((await storeGet(key)).shareUrl, mine);
    const ex = await send({ type: 'hfc:export', opts: {} });
    assert.ok(ex.html.includes('href="' + mine + '"'), 'link is in the exported file');
    const t = await send({ type: 'hfc:transcript' });
    assert.equal(t.ok, true);
    assert.doesNotMatch(t.transcript, /highlight/i);
    assert.equal((await send({ type: 'hfc:share', url: '' })).ok, true);
    await sleep(200);
    assert.equal((await storeGet(key)).shareUrl, undefined);
  });
}

await step('selection toolbar can be switched off in settings', async () => {
  await page.evaluate(() =>
    chrome.storage.local.set({ settings: { selectionToolbar: false, quickKeys: true, showHighlights: true, showComments: true } })
  );
  await sleep(200);
  await selectText('#p1');
  await sleep(350);
  assert.equal((await getState()).toolbar, false);
});

await step('quick keys can be switched off in settings', async () => {
  await page.evaluate(() =>
    chrome.storage.local.set({ settings: { selectionToolbar: true, quickKeys: false, showHighlights: true, showComments: true } })
  );
  await sleep(200);
  await selectText('#p1');
  await waitFor('toolbar', (s) => s.toolbar);
  await page.keyboard.press('1');
  await sleep(350);
  assert.equal((await getState()).saved.length, 2, 'key 1 must do nothing when quick keys are off');
});

await step('a custom colour gets a toolbar swatch, quick key 5 and its own highlight style', async () => {
  await page.evaluate(() =>
    chrome.storage.local.set({ settings: { selectionToolbar: true, quickKeys: true, showHighlights: true, showComments: true, customColors: { c1: '#ff8a3d' } } })
  );
  await sleep(300);
  await selectText('#p1');
  await waitFor('toolbar', (s) => s.toolbar);
  const n = await page.evaluate(() => document.querySelector('[data-hfc-ui]').shadowRoot.querySelectorAll('.tb .tsw').length);
  assert.equal(n, 5, 'toolbar should show four built-in swatches plus one custom');
  await page.keyboard.press('5');
  await sleep(450);
  const st = await getState();
  assert.equal(st.saved[st.saved.length - 1].color, 'c1');
  const css = await page.evaluate(() => document.querySelector('style[data-hfc-css]').textContent);
  assert.match(css, /::highlight\(hfc-c1\)/);
  await page.keyboard.press('6'); // no sixth colour defined: must do nothing
  await sleep(300);
  assert.equal((await getState()).saved.length, st.saved.length);
});

await step('no uncaught errors on the page', async () => {
  assert.deepEqual(pageErrors, []);
});

await browser.close();
console.log(failed ? `\n${failed} step(s) failed` : '\nall steps passed');
process.exit(failed ? 1 : 0);
