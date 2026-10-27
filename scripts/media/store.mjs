#!/usr/bin/env node
// Renders the store images from the screenshots in docs/img: five 1280x800 screenshots with a
// headline, the 440x280 small promo tile and the 1400x560 marquee.
//   CHROME_PATH=/path/to/chrome node scripts/media/store.mjs [outDir]
// Regenerate docs/img first (scripts/media/shots.mjs) if the UI changed.
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.CHROME_PATH) {
  console.error('Set CHROME_PATH to a Chrome/Chromium executable.');
  process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = resolve(process.argv[2] || join(root, 'docs', 'store'));
mkdirSync(out, { recursive: true });
const img = (name) => 'data:image/png;base64,' + readFileSync(join(root, name)).toString('base64');
const ICON = img('icons/icon128.png');
const pngWidth = (name) => readFileSync(join(root, name)).readUInt32BE(16);

// Headline words wrapped in *stars* get the yellow highlight, like a Tessel highlight.
const mark = (s) => s.replace(/\*(.+?)\*/g, '<mark>$1</mark>');

// [file name, source image, headline, subline, crop]. crop = [x, y, width] in source pixels: the part
// of the capture that fills the frame (the captures are 2x and mostly empty at the bottom).
const SHOTS = [
  ['1-highlights', 'chat-highlights.png', 'Highlights that *stay*.', 'Mark what matters in your Claude chats. It is still there next week, next month.', [590, 0, 2040]],
  ['2-comments', 'chat-popover.png', 'Add a *comment* to any passage.', 'Your notes live with the highlight. Click it later to edit, recolour or copy.', [590, 0, 2040]],
  ['3-keyboard', 'chat-panel.png', '*Keyboard-first.*', 'Select text, press 1 to 4. Alt + arrow keys jump between highlights; one panel lists them all.', [840, 0, 2040]],
  ['4-library', 'library-search.png', 'One *searchable* library.', 'Every highlight and comment across every chat, with tags, stars and colour filters.', [0, 0, 2400]],
  ['5-share', 'export.png', '*Share* a chat as one page.', 'A single HTML file with your highlights and comments. No account, no servers.', [0, 0, 2400]],
];

const BASE = `
*{box-sizing:border-box;margin:0}
body{width:var(--w);height:var(--h);overflow:hidden;background:radial-gradient(120% 90% at 20% 0%,#34302c 0%,#1c1b1a 60%,#161514 100%);
  color:#f4f1ec;font-family:Inter,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
mark{background:#e9b916;color:#1c1b1a;padding:0 .14em;border-radius:.12em}
`;

const FRAME_W = 1120;
const shotHtml = (file, head, sub, [x, y, w]) => `<style>${BASE}
:root{--w:1280px;--h:800px}
h1{position:absolute;left:80px;right:80px;top:56px;font-size:50px;font-weight:750;letter-spacing:-.02em;text-align:center}
p{position:absolute;left:140px;right:140px;top:132px;font-size:21px;line-height:1.4;color:#bdb6ad;text-align:center}
.win{position:absolute;left:80px;right:80px;top:208px;height:640px;border-radius:14px;overflow:hidden;
  border:1px solid #4a4540;box-shadow:0 30px 80px rgba(0,0,0,.55)}
.win img{display:block;width:${(pngWidth('docs/img/' + file) * FRAME_W) / w}px;max-width:none;margin:${(-y * FRAME_W) / w}px 0 0 ${(-x * FRAME_W) / w}px}
</style><h1>${mark(head)}</h1><p>${sub}</p><div class="win"><img src="${img('docs/img/' + file)}"></div>`;

const tileHtml = `<style>${BASE}
:root{--w:440px;--h:280px}
.c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center}
img{width:72px;height:72px}
h1{font-size:42px;font-weight:800;letter-spacing:-.02em}
p{font-size:18px;line-height:1.35;color:#d6d0c8;padding:0 28px}
</style><div class="c"><img src="${ICON}"><h1>Tessel</h1><p><mark>Highlights &amp; comments</mark> for your Claude chats</p></div>`;

const marqueeHtml = `<style>${BASE}
:root{--w:1400px;--h:560px}
.l{position:absolute;left:90px;top:0;bottom:0;width:520px;display:flex;flex-direction:column;justify-content:center;gap:18px}
.l img{width:84px;height:84px}
h1{font-size:64px;font-weight:800;letter-spacing:-.02em}
p{font-size:26px;line-height:1.4;color:#d6d0c8}
.win{position:absolute;left:680px;top:70px;width:820px;height:560px;border-radius:14px;overflow:hidden;border:1px solid #4a4540;box-shadow:0 30px 80px rgba(0,0,0,.55)}
.win img{width:100%;height:100%;object-fit:cover;object-position:top left;display:block}
</style><div class="l"><img src="${ICON}"><h1>Tessel</h1><p><mark>Permanent highlights</mark> and comments for your Claude chats. Keyboard-first, private, free.</p></div>
<div class="win"><img src="${img('docs/img/chat-highlights.png')}"></div>`;

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const page = await browser.newPage();
async function render(html, width, height, name) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent('<!doctype html><meta charset="utf-8">' + html, { waitUntil: 'load' });
  await page.screenshot({ path: join(out, name + '.png'), clip: { x: 0, y: 0, width, height } });
  console.log(`${name}.png  ${width}x${height}`);
}
for (const [name, file, head, sub, crop] of SHOTS) await render(shotHtml(file, head, sub, crop), 1280, 800, 'screenshot-' + name);
await render(tileHtml, 440, 280, 'promo-small-440x280');
await render(marqueeHtml, 1400, 560, 'promo-marquee-1400x560');
await browser.close();
