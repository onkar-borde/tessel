#!/usr/bin/env node
// Builds one package per browser family into dist/ (a folder to load unpacked, plus a store-ready zip).
//
//   npm run build                 -> dist/chromium, dist/firefox (+ zips)
//   GECKO_ID=you@yourdomain npm run build   -> use your own Firefox add-on id
//
// The source in the repo root is the Chromium build. Firefox differs only in the manifest:
// it runs the background script as an event page (not a service worker) and needs an add-on id.

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const INCLUDE = ['background.js', 'content.js', 'content.css', 'lib', 'popup', 'library', 'icons', 'LICENSE'];
const GECKO_ID = process.env.GECKO_ID || 'tessel@example.com';

const base = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

const targets = {
  // Chrome, Edge, Brave, Opera, Vivaldi, Arc and other Chromium browsers.
  chromium: (m) => m,
  // Firefox 140+ (first release with the CSS Custom Highlight API).
  firefox: (m) => {
    const f = structuredClone(m);
    delete f.minimum_chrome_version;
    f.background = { scripts: ['lib/sites.js', 'lib/library.js', 'lib/durability.js', 'background.js'] };
    f.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
      // The data-collection key needs Android 142+. (Touch selection is not a target; this only
      // keeps the manifest consistent.)
      gecko_android: { strict_min_version: '142.0' },
    };
    return f;
  },
};

function zipDir(dir) {
  const files = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files[relative(dir, p).split(sep).join('/')] = new Uint8Array(readFileSync(p));
    }
  };
  walk(dir);
  return zipSync(files, { level: 9 });
}

rmSync(dist, { recursive: true, force: true });
for (const [name, transform] of Object.entries(targets)) {
  const out = join(dist, name);
  mkdirSync(out, { recursive: true });
  for (const item of INCLUDE) cpSync(join(root, item), join(out, item), { recursive: true });
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(transform(base), null, 2) + '\n');
  const zipPath = join(dist, `tessel-${name}-${base.version}.zip`);
  writeFileSync(zipPath, zipDir(out));
  console.log(`built ${relative(root, out)}  ->  ${relative(root, zipPath)}`);
}
if (!process.env.GECKO_ID) {
  console.log('note: Firefox build uses the placeholder id ' + GECKO_ID + '. Set GECKO_ID before publishing it.');
}
