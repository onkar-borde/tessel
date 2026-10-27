// Tessel: background script (service worker in Chromium, event page in Firefox).
// Adds the right-click menu and browser-level shortcuts; the content script does the real work.

const ext = globalThis.browser || globalThis.chrome;
// Chromium runs this as a service worker (pull the site list in here); Firefox lists
// lib/sites.js ahead of this file in the manifest instead.
if (typeof importScripts === 'function') importScripts('lib/sites.js', 'lib/library.js', 'lib/durability.js');
const SITES = self.HFCSites;
const LIB = self.HFCLibrary;
const DUR = self.HFCDurability;

const COLORS = [
  ['yellow', '🟨 Yellow'],
  ['green', '🟩 Green'],
  ['blue', '🟦 Blue'],
  ['pink', '🩷 Pink'],
];

ext.runtime.onInstalled.addListener((details) => {
  guard(details && details.reason);
  ext.contextMenus.removeAll().then(() => {
    ext.contextMenus.create({
      id: 'hfc',
      title: 'Tessel',
      contexts: ['selection'],
      documentUrlPatterns: SITES.PROFILES.flatMap((p) => p.hosts.map((h) => 'https://' + h + '/*')),
    });
    for (const [key, label] of COLORS) {
      ext.contextMenus.create({
        id: 'hfc-hl-' + key,
        parentId: 'hfc',
        title: 'Highlight  ' + label,
        contexts: ['selection'],
      });
    }
    ext.contextMenus.create({ id: 'hfc-sep', parentId: 'hfc', type: 'separator', contexts: ['selection'] });
    ext.contextMenus.create({
      id: 'hfc-comment',
      parentId: 'hfc',
      title: 'Highlight + add comment…',
      contexts: ['selection'],
    });
  });
});

function send(tabId, msg) {
  ext.tabs.sendMessage(tabId, msg).catch(() => {
    // Content script not running (tab was open before install). The user needs to reload the tab.
  });
}

ext.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id == null) return;
  const id = String(info.menuItemId);
  if (id.startsWith('hfc-hl-')) send(tab.id, { type: 'hfc:create', color: id.slice('hfc-hl-'.length), comment: false });
  else if (id === 'hfc-comment') send(tab.id, { type: 'hfc:create', color: 'yellow', comment: true });
});

// Browser-level shortcuts (remappable in the browser's extension-shortcuts page).
// The everyday keys (1-4, H, C, Alt+Up/Down) are handled inside the page by content.js.
ext.commands.onCommand.addListener(async (command) => {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null || !tab.url) return;
  let site = null;
  try {
    const u = new URL(tab.url);
    site = u.protocol === 'https:' && SITES.detect(u.hostname);
  } catch (_) {}
  if (!site) return;
  if (command === 'highlight-selection') send(tab.id, { type: 'hfc:create', color: 'last', comment: false });
  if (command === 'comment-selection') send(tab.id, { type: 'hfc:create', color: 'last', comment: true });
});

// Highlight count on the toolbar icon, reported by the content script for its own tab.
ext.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'hfc:count' || !sender || !sender.tab || sender.tab.id == null) return;
  const n = Number(msg.n) || 0;
  const tabId = sender.tab.id;
  const text = n > 0 ? (n > 999 ? '999+' : String(n)) : '';
  Promise.resolve(ext.action.setBadgeText({ tabId, text })).catch(() => {});
  if (n > 0) Promise.resolve(ext.action.setBadgeBackgroundColor({ tabId, color: '#c96442' })).catch(() => {});
});

// ---------- keeping highlights safe ----------
// See lib/durability.js for the layers. Everything here is best-effort and never throws into the
// browser: a failure to protect data must not break highlighting itself.
const get = (k) => Promise.resolve(ext.storage.local.get(k)).catch(() => ({}));
const set = (o) => Promise.resolve(ext.storage.local.set(o));

// Startup check: if every chat record has vanished (storage corruption, a bug, a bad update) while
// the mirror copy still has them, put them back. The mirror follows every edit and deletion the
// user makes (see below), so a highlight the user deleted is never resurrected.
async function guard(reason) {
  try {
    const all = await get(null);
    if (!Object.keys(DUR.chatEntries(all)).length) {
      const back = DUR.restoreFromSnapshot(all);
      if (Object.keys(back).length) {
        await set({ ...back, restoredAt: Date.now(), restoredChats: Object.keys(back).length });
        Object.assign(all, back);
      }
    }
    if (!all.snapshot || reason === 'update') await set({ snapshot: DUR.makeSnapshot(all) });
    if (all.schemaVersion !== DUR.SCHEMA) await set({ schemaVersion: DUR.SCHEMA });
    ensureAlarms();
  } catch (e) {
    console.warn('[highlighter] guard failed', e);
  }
}
ext.runtime.onStartup.addListener(() => guard('startup'));

function ensureAlarms() {
  try {
    ext.alarms.create('hfc-periodic', { delayInMinutes: 30, periodInMinutes: 30 });
  } catch (_) {}
}

// Every change to a chat is mirrored into 'snapshot' straight away (one at a time, in order), and
// also schedules a backup file a couple of minutes later, so a burst of highlights becomes one file.
let mirror = Promise.resolve();
ext.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const keys = Object.keys(changes).filter((k) => SITES.matchKey(k));
  if (!keys.length) return;
  mirror = mirror
    .then(async () => {
      const r = await get('snapshot');
      const snap = r.snapshot && r.snapshot.chats ? r.snapshot : { at: 0, schema: DUR.SCHEMA, chats: {} };
      for (const k of keys) {
        const nv = changes[k].newValue;
        if (nv && Array.isArray(nv.highlights) && nv.highlights.length) snap.chats[k] = nv;
        else delete snap.chats[k];
      }
      snap.at = Date.now();
      await set({ snapshot: snap });
    })
    .catch(() => {});
  try {
    ext.alarms.create('hfc-soon', { delayInMinutes: 2 });
  } catch (_) {}
});

async function hasDownloads() {
  try {
    return Boolean(ext.downloads) && (await ext.permissions.contains({ permissions: ['downloads'] }));
  } catch (_) {
    return false;
  }
}

// Writes highlights-backup-latest.json and the weekday file into Downloads/<BACKUP_DIR>/.
async function autoBackup() {
  const all = await get(null);
  if (all.autoBackup !== true || !(await hasDownloads())) return { ok: false, reason: 'off' };
  const entries = DUR.chatEntries(all);
  if (!DUR.countHighlights(entries) && !Object.keys(entries).length) return { ok: false, reason: 'empty' };
  const fingerprint = JSON.stringify(entries) + JSON.stringify((all.settings && all.settings.colorNames) || {});
  const sig = String(fingerprint.length) + ':' + hashStr(fingerprint);
  if (all.lastAutoSig === sig && Date.now() - (Number(all.lastAutoBackup) || 0) < 20 * 3600 * 1000) {
    return { ok: true, reason: 'unchanged' };
  }
  try {
    const text = JSON.stringify(LIB.buildBackup(all), null, 2);
    // Firefox refuses data: URLs in downloads.download but accepts blob: URLs from its background page;
    // Chrome's service worker has no URL.createObjectURL, so it uses a data: URL.
    const canBlob = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof Blob !== 'undefined';
    const dataUrl = () => 'data:application/json;charset=utf-8,' + encodeURIComponent(text);
    const blobUrl = canBlob ? URL.createObjectURL(new Blob([text], { type: 'application/json' })) : null;
    try {
      for (const filename of DUR.backupFiles(new Date())) {
        try {
          await ext.downloads.download({ url: blobUrl || dataUrl(), filename, conflictAction: 'overwrite', saveAs: false });
        } catch (err) {
          if (!blobUrl) throw err;
          await ext.downloads.download({ url: dataUrl(), filename, conflictAction: 'overwrite', saveAs: false });
        }
      }
    } finally {
      if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    }
    await set({ lastAutoBackup: Date.now(), lastAutoSig: sig, lastBackup: Date.now(), backupError: '' });
    return { ok: true, reason: 'written' };
  } catch (e) {
    await set({ backupError: String((e && e.message) || e).slice(0, 200) });
    return { ok: false, reason: 'error' };
  }
}
function hashStr(t) {
  let x = 5381;
  for (let i = 0; i < t.length; i++) x = ((x * 33) ^ t.charCodeAt(i)) >>> 0;
  return x.toString(36);
}

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'hfc-soon' || alarm.name === 'hfc-periodic') autoBackup().catch(() => {});
});

// The Library page asks for an immediate backup after the user turns the option on.
ext.runtime.onMessage.addListener((msg, _sender, send) => {
  if (!msg || msg.type !== 'hfc:backup-now') return;
  autoBackup().then(send, () => send({ ok: false }));
  return true;
});

guard('wake');
