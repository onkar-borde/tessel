#!/usr/bin/env node
// Runs the end-to-end tests: the chat-page flow once per mock site (claude, chatgpt, an unsupported
// host), then the popup and Library pages.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const smoke = join(dirname(fileURLToPath(import.meta.url)), 'smoke.mjs');
let failed = 0;
for (const site of ['claude', 'chatgpt', 'chatgpt2', 'other']) {
  const r = spawnSync(process.execPath, [smoke], { stdio: 'inherit', env: { ...process.env, E2E_SITE: site } });
  if (r.status !== 0) failed++;
  console.log();
}
const ui = spawnSync(process.execPath, [join(dirname(smoke), 'ui.mjs')], { stdio: 'inherit', env: process.env });
if (ui.status !== 0) failed++;
process.exit(failed ? 1 : 0);
