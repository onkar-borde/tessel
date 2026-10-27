'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../lib/durability.js');

const ID1 = 'aaaaaaaa-1111-2222-3333-444444444444';
const ID2 = 'bbbbbbbb-1111-2222-3333-444444444444';
const hl = (t) => ({ id: 'h' + t, color: 'yellow', exact: t, prefix: '', suffix: '', comment: '', created: 1, updated: 1 });
const rec = (...t) => ({ id: 'x', title: 'T', url: '', updated: 5, highlights: t.map(hl) });

test('chatEntries keeps chat records only', () => {
  const all = { settings: {}, ['chat:' + ID1]: rec('a'), ['gpt:' + ID2]: rec('b'), 'chat:bad': rec('c'), lastColor: 'pink' };
  assert.deepEqual(Object.keys(D.chatEntries(all)).sort(), ['chat:' + ID1, 'gpt:' + ID2].sort());
});

test('restoreFromSnapshot brings back only missing chats, never overwrites', () => {
  const snap = D.makeSnapshot({ ['chat:' + ID1]: rec('old', 'old2'), ['gpt:' + ID2]: rec('b') });
  const live = { snapshot: snap, ['chat:' + ID1]: rec('new') };
  assert.deepEqual(Object.keys(D.restoreFromSnapshot(live)), ['gpt:' + ID2]);
  assert.deepEqual(D.restoreFromSnapshot({}), {});
  assert.deepEqual(D.restoreFromSnapshot({ snapshot: { chats: { 'chat:zz': rec('a') } } }), {});
});

test('backup file names rotate by weekday', () => {
  const [latest, day] = D.backupFiles(new Date('2026-10-26T10:00:00')); // a Monday
  assert.match(latest, /^Tessel backups\/highlights-backup-latest\.json$/);
  assert.match(day, /-mon\.json$/);
});

// ---- the background script, run against a fake extension API ----
function makeEnv(initial = {}, { downloads = true } = {}) {
  const store = JSON.parse(JSON.stringify(initial));
  const L = { installed: [], startup: [], alarm: [], changed: [], msg: [] };
  const downloadsLog = [];
  const alarms = {};
  const ext = {
    runtime: {
      onInstalled: { addListener: (f) => L.installed.push(f) },
      onStartup: { addListener: (f) => L.startup.push(f) },
      onMessage: { addListener: (f) => L.msg.push(f) },
    },
    storage: {
      local: {
        get: async (k) => {
          if (k == null) return JSON.parse(JSON.stringify(store));
          const out = {};
          for (const key of [].concat(k)) if (key in store) out[key] = JSON.parse(JSON.stringify(store[key]));
          return out;
        },
        set: async (o) => {
          const ch = {};
          for (const [k, v] of Object.entries(o)) {
            ch[k] = { oldValue: store[k], newValue: JSON.parse(JSON.stringify(v)) };
            store[k] = JSON.parse(JSON.stringify(v));
          }
          L.changed.forEach((f) => f(ch, 'local'));
        },
        remove: async (keys) => {
          const ch = {};
          for (const k of [].concat(keys)) if (k in store) { ch[k] = { oldValue: store[k] }; delete store[k]; }
          L.changed.forEach((f) => f(ch, 'local'));
        },
      },
      onChanged: { addListener: (f) => L.changed.push(f) },
    },
    alarms: { create: (n, o) => (alarms[n] = o), onAlarm: { addListener: (f) => L.alarm.push(f) } },
    contextMenus: { removeAll: async () => {}, create() {}, onClicked: { addListener() {} } },
    commands: { onCommand: { addListener() {} } },
    tabs: { query: async () => [], sendMessage: async () => {} },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    permissions: { contains: async () => downloads },
    downloads: { download: async (o) => downloadsLog.push(o) },
  };
  const sandbox = { chrome: ext, console, setTimeout, URL, encodeURIComponent, JSON, Date, Promise };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.importScripts = (...files) => {
    for (const f of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox);
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), sandbox);
  return { store, L, downloadsLog, alarms, ext };
}
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test('every edit and deletion is mirrored into the snapshot', async () => {
  const env = makeEnv({});
  await tick();
  await env.ext.storage.local.set({ ['chat:' + ID1]: rec('a') });
  await tick();
  assert.equal(env.store.snapshot.chats['chat:' + ID1].highlights.length, 1);
  await env.ext.storage.local.remove('chat:' + ID1);
  await tick();
  assert.deepEqual(env.store.snapshot.chats, {});
});

test('a deleted chat is not resurrected on the next start', async () => {
  const env = makeEnv({});
  await tick();
  await env.ext.storage.local.set({ ['chat:' + ID1]: rec('a') });
  await env.ext.storage.local.remove('chat:' + ID1);
  await tick();
  env.L.startup.forEach((f) => f());
  await tick();
  assert.equal(Object.keys(env.store).filter((k) => k.startsWith('chat:')).length, 0);
});

test('if all chat records vanish without the user deleting them, startup restores them', async () => {
  const snap = D.makeSnapshot({ ['chat:' + ID1]: rec('a', 'b'), ['gpt:' + ID2]: rec('c') });
  const env = makeEnv({ snapshot: snap });
  await tick();
  assert.equal(env.store['chat:' + ID1].highlights.length, 2);
  assert.equal(env.store['gpt:' + ID2].highlights.length, 1);
  assert.equal(env.store.restoredChats, 2);
});

test('a normal update keeps every record and refreshes the snapshot', async () => {
  const env = makeEnv({ ['chat:' + ID1]: rec('a') });
  await tick();
  env.L.installed.forEach((f) => f({ reason: 'update' }));
  await tick();
  assert.equal(env.store['chat:' + ID1].highlights.length, 1);
  assert.equal(env.store.snapshot.chats['chat:' + ID1].highlights.length, 1);
  assert.equal(env.store.schemaVersion, D.SCHEMA);
});

test('automatic backup writes the latest and weekday files, only when on', async () => {
  const off = makeEnv({ ['chat:' + ID1]: rec('a') });
  await tick();
  off.L.alarm.forEach((f) => f({ name: 'hfc-soon' }));
  await tick();
  assert.equal(off.downloadsLog.length, 0, 'nothing is written unless the user turned it on');

  const on = makeEnv({ ['chat:' + ID1]: rec('hello'), autoBackup: true });
  await tick();
  on.L.alarm.forEach((f) => f({ name: 'hfc-soon' }));
  await tick(60);
  assert.equal(on.downloadsLog.length, 2);
  assert.ok(on.downloadsLog.every((d) => d.conflictAction === 'overwrite' && d.filename.startsWith('Tessel backups/')));
  const body = JSON.parse(decodeURIComponent(on.downloadsLog[0].url.split(',')[1]));
  assert.equal(body.format, 'highlighter-for-claude');
  assert.equal(body.chats['chat:' + ID1].highlights[0].exact, 'hello');
  assert.ok(on.store.lastAutoBackup);
  // Unchanged data is not rewritten on the next tick.
  on.L.alarm.forEach((f) => f({ name: 'hfc-periodic' }));
  await tick(60);
  assert.equal(on.downloadsLog.length, 2);
});

test('without the downloads permission nothing is written and nothing breaks', async () => {
  const env = makeEnv({ ['chat:' + ID1]: rec('a'), autoBackup: true }, { downloads: false });
  await tick();
  env.L.alarm.forEach((f) => f({ name: 'hfc-soon' }));
  await tick();
  assert.equal(env.downloadsLog.length, 0);
});
