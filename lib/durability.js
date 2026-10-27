/* Data-safety helpers shared by the background script and the tests.
 *
 * Pure functions over plain objects (the contents of extension storage), no extension APIs.
 *
 * Layers that keep highlights from being lost:
 *   1. Storage is only ever added to or edited by the user's own actions (see content.js).
 *   2. 'snapshot' is a second copy of every chat that follows each edit and deletion. If at startup
 *      every live chat record is gone while the snapshot still has them, they are restored.
 *   3. Optional automatic backup files in the Downloads folder: outside the browser profile, so
 *      they survive uninstalling, reinstalling, profile resets and moving to another computer.
 *      Restore is one click in the Library.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const S = isNode ? require('./sites.js') : root.HFCSites;

  const SCHEMA = 2;
  const BACKUP_DIR = 'Tessel backups';
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  // Only the chat records ('chat:<id>', 'gpt:<id>'), never settings or bookkeeping keys.
  function chatEntries(all) {
    const out = {};
    for (const [k, v] of Object.entries(all || {})) {
      if (S.matchKey(k) && v && Array.isArray(v.highlights)) out[k] = v;
    }
    return out;
  }
  const countHighlights = (entries) => Object.values(entries).reduce((n, c) => n + c.highlights.length, 0);

  function makeSnapshot(all, now = Date.now()) {
    const chats = chatEntries(all);
    return { at: now, schema: SCHEMA, chats };
  }

  /**
   * Given everything in storage, returns the records to write back from the snapshot (possibly
   * empty): only chats that are missing, never one that exists.
   */
  function restoreFromSnapshot(all) {
    const snap = all && all.snapshot;
    if (!snap || typeof snap !== 'object' || !snap.chats) return {};
    const live = chatEntries(all);
    const out = {};
    for (const [k, v] of Object.entries(snap.chats)) {
      if (!S.matchKey(k) || !v || !Array.isArray(v.highlights) || !v.highlights.length) continue;
      if (!live[k]) out[k] = v;
    }
    return out;
  }

  // Weekly rotation: a latest file plus one per weekday, so seven days of history take a fixed
  // amount of space and nothing needs deleting.
  function backupFiles(date = new Date()) {
    return [`${BACKUP_DIR}/highlights-backup-latest.json`, `${BACKUP_DIR}/highlights-backup-${DAYS[date.getDay()]}.json`];
  }

  const api = { SCHEMA, BACKUP_DIR, chatEntries, countHighlights, makeSnapshot, restoreFromSnapshot, backupFiles };
  if (isNode) module.exports = api;
  else root.HFCDurability = api;
})(typeof self !== 'undefined' ? self : this);
