// Renders video/launch.html to launch.mp4 (needs Playwright's Chromium and ffmpeg).
//   node video/render.mjs [Name shown on the end card] [fps]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2] || 'Tessel';
const fps = Number(process.argv[3]) || 30;
const out = join(here, process.env.VIDEO_OUT || 'launch.mp4');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('file://' + join(here, process.env.VIDEO_HTML || 'launch2.html') + '?name=' + encodeURIComponent(name));
const total = await page.evaluate(() => window.TOTAL);
const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const n = Math.round(total * fps);
for (let i = 0; i < n; i++) {
  await page.evaluate((t) => window.setT(t), i / fps);
  const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
console.log('wrote', resolve(out));
