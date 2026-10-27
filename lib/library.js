/* Library logic shared by the popup and the Library page: listing and filtering saved chats,
 * Markdown output, tags, backup and restore.
 *
 * Pure functions over plain objects (the contents of extension storage), with no DOM or extension
 * APIs, so they are unit-tested in Node.
 *
 * Storage layout (chrome.storage.local):
 *   'chat:<id>'  Claude chats      \  { id, title, url, updated, highlights: [...], starred?, tags? }
 *   'gpt:<id>'   ChatGPT chats     /
 *   'settings'   { showHighlights, showComments, selectionToolbar, quickKeys, colorNames? }
 *   'lastColor', 'pendingJump', 'lastBackup', 'panelOpen'
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const S = isNode ? require('./sites.js') : root.HFCSites;

  const COLOR_KEYS = ['yellow', 'green', 'blue', 'pink'];
  const COLOR_LABELS = { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink' };
  // Up to four extra colours the user defines themselves: c1..c4, each a hex value (settings.customColors).
  const CUSTOM_KEYS = ['c1', 'c2', 'c3', 'c4'];
  const ALL_KEYS = [...COLOR_KEYS, ...CUSTOM_KEYS];
  const HEX_RE = /^#[0-9a-fA-F]{6}$/;
  const MAX_TAGS = 12;
  const MAX_TAG_LEN = 30;
  const MAX_NAME_LEN = 24;

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

  // ---------- colour names ----------
  // Users can rename the four colours ("Claim", "Stat", "To check", "Term").
  // { c1: '#aabbcc' } for the custom colours that are defined and valid.
  function customColors(settings) {
    const src = settings && typeof settings.customColors === 'object' && settings.customColors;
    const out = {};
    if (src) for (const k of CUSTOM_KEYS) if (has(src, k) && typeof src[k] === 'string' && HEX_RE.test(src[k])) out[k] = src[k].toLowerCase();
    return out;
  }
  // Keys in use: the four built-in colours plus any custom ones, in order.
  function colorList(settings) {
    const c = customColors(settings);
    return [...COLOR_KEYS, ...CUSTOM_KEYS.filter((k) => has(c, k))];
  }
  function hexToRgb(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
  }
  function colorNames(settings) {
    const out = { ...COLOR_LABELS };
    CUSTOM_KEYS.forEach((k, i) => (out[k] = 'Custom ' + (i + 1)));
    const custom = settings && typeof settings.colorNames === 'object' && settings.colorNames;
    if (custom) {
      for (const k of ALL_KEYS) {
        const v = has(custom, k) ? str(custom[k], MAX_NAME_LEN).trim() : '';
        if (v) out[k] = v;
      }
    }
    return out;
  }

  // ---------- tags ----------
  function cleanTags(list) {
    const seen = new Set();
    const out = [];
    for (const raw of Array.isArray(list) ? list : []) {
      const t = str(raw, 200).replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LEN);
      const k = t.toLowerCase();
      if (t && !seen.has(k)) {
        seen.add(k);
        out.push(t);
      }
      if (out.length >= MAX_TAGS) break;
    }
    return out;
  }

  const shareOf = (u) => {
    const m = typeof u === 'string' ? S.matchShareUrl(u) : null;
    return m ? m.url : '';
  };

  // ---------- listing ----------
  // All stored chats as a flat list, newest first. Starred chats are not floated here; callers sort.
  function chatsFrom(all) {
    const out = [];
    for (const [key, v] of Object.entries(all || {})) {
      const m = S.matchKey(key);
      if (!m || !v || !Array.isArray(v.highlights)) continue;
      out.push({
        key,
        id: m.id,
        site: m.site,
        title: str(v.title, 300),
        url: str(v.url, 500) || m.site.chatUrl(m.id),
        updated: Number(v.updated) || 0,
        starred: v.starred === true,
        tags: cleanTags(v.tags),
        shareUrl: shareOf(v.shareUrl),
        highlights: v.highlights,
      });
    }
    return out.sort((a, b) => b.updated - a.updated);
  }

  const textOf = (x) => (x.exact || '') + ' ' + (x.comment || '');
  const commentCount = (chat) => chat.highlights.filter((x) => x.comment).length;

  /**
   * @param {Array} chats  from chatsFrom()
   * @param {{platform?:string, q?:string, tag?:string, starred?:boolean, color?:string}} f
   * Returns [{ chat, matches }] where `matches` are the highlights that satisfy the text/colour
   * filter (all of them when only platform/tag/starred filters are active).
   */
  function filterChats(chats, f = {}) {
    const q = (f.q || '').trim().toLowerCase();
    const tagKey = f.tag ? f.tag.toLowerCase() : '';
    const out = [];
    for (const chat of chats) {
      if (f.platform && f.platform !== 'all' && chat.site.id !== f.platform) continue;
      if (f.starred && !chat.starred) continue;
      if (tagKey && !chat.tags.some((t) => t.toLowerCase() === tagKey)) continue;
      let matches = chat.highlights;
      if (f.color) matches = matches.filter((x) => x.color === f.color);
      const titleHit = q && (chat.title + ' ' + chat.tags.join(' ')).toLowerCase().includes(q);
      if (q) {
        const textHits = matches.filter((x) => textOf(x).toLowerCase().includes(q));
        if (!textHits.length && !titleHit) continue;
        if (textHits.length) matches = textHits;
      }
      if (f.color && !matches.length) continue; // colour filter: the chat must have that colour
      out.push({ chat, matches });
    }
    return out;
  }

  const SORTS = {
    recent: (a, b) => b.updated - a.updated,
    count: (a, b) => b.highlights.length - a.highlights.length || b.updated - a.updated,
    title: (a, b) => (a.title || '~').localeCompare(b.title || '~'),
  };
  function sortChats(chats, how, starredFirst = true) {
    const cmp = SORTS[how] || SORTS.recent;
    return [...chats].sort((a, b) => (starredFirst && a.starred !== b.starred ? (a.starred ? -1 : 1) : cmp(a, b)));
  }

  // { all, claude, chatgpt, starred } and the tag list, for the sidebar.
  function counts(chats) {
    const c = { all: chats.length, starred: 0 };
    for (const p of S.PROFILES) c[p.id] = 0;
    const tags = new Map();
    for (const chat of chats) {
      c[chat.site.id]++;
      if (chat.starred) c.starred++;
      for (const t of chat.tags) {
        const k = t.toLowerCase();
        tags.set(k, { name: tags.get(k) ? tags.get(k).name : t, n: (tags.get(k) ? tags.get(k).n : 0) + 1 });
      }
    }
    return { counts: c, tags: [...tags.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)) };
  }

  // ---------- Markdown ----------
  function chatMarkdown(chat, opts = {}) {
    const names = opts.colorNames || COLOR_LABELS;
    const hls = opts.highlights || chat.highlights;
    const lines = ['# ' + (chat.title || chat.site.name + ' chat'), ''];
    lines.push('*' + chat.site.name + (chat.url ? ' · ' + chat.url : '') + '*');
    if (chat.tags && chat.tags.length) lines.push('', 'Tags: ' + chat.tags.map((t) => '`' + t + '`').join(' '));
    lines.push('');
    for (const x of hls) {
      lines.push(...String(x.exact).split('\n').map((l) => '> ' + l), '', '*' + (names[x.color] || x.color) + '*');
      if (x.comment) lines.push('', '**Comment:** ' + x.comment);
      lines.push('', '---', '');
    }
    return lines.join('\n');
  }

  function libraryMarkdown(chats, opts = {}) {
    const date = (opts.now || new Date()).toISOString().slice(0, 10);
    const out = ['# Highlights library', '', 'Exported ' + date + ' · ' + chats.length + ' chats', ''];
    for (const p of S.PROFILES) {
      const mine = chats.filter((c) => c.site.id === p.id);
      if (!mine.length) continue;
      out.push('## ' + p.name, '');
      for (const chat of mine) out.push(chatMarkdown(chat, opts).replace(/^# /, '### '));
    }
    return out.join('\n');
  }

  // A single highlight as a quotable snippet with its source.
  function quoteMarkdown(hl, chat) {
    const q = String(hl.exact).split('\n').map((l) => '> ' + l).join('\n');
    const src = chat && chat.url ? '\n\n— [' + (chat.title || chat.site.name + ' chat') + '](' + chat.url + ')' : '';
    return q + src + (hl.comment ? '\n\n' + hl.comment : '');
  }

  // ---------- backup / restore ----------
  function cleanHighlight(x, newId) {
    if (!x || typeof x !== 'object' || typeof x.exact !== 'string' || !x.exact || x.exact.length > 20000) return null;
    return {
      id: typeof x.id === 'string' && x.id.length > 0 && x.id.length <= 64 ? x.id : newId(),
      color: typeof x.color === 'string' && ALL_KEYS.includes(x.color) ? x.color : 'yellow',
      exact: x.exact,
      prefix: str(x.prefix, 200),
      suffix: str(x.suffix, 200),
      comment: str(x.comment, 20000),
      created: Number(x.created) || Date.now(),
      updated: Number(x.updated) || Date.now(),
    };
  }

  // Version 2 keys chats by storage key ('chat:<id>', 'gpt:<id>') and carries star and tags.
  // Version 1 (Claude only) listed bare chat IDs and had neither; restore still reads it.
  function buildBackup(all, now = new Date()) {
    const chats = {};
    for (const c of chatsFrom(all)) {
      chats[c.key] = {
        title: c.title,
        url: c.url,
        updated: c.updated,
        starred: c.starred,
        tags: c.tags,
        shareUrl: c.shareUrl || undefined,
        highlights: c.highlights,
      };
    }
    const settings = all && all.settings && typeof all.settings === 'object' ? all.settings : null;
    return {
      format: 'highlighter-for-claude',
      version: 2,
      exportedAt: now.toISOString(),
      settings: settings && (settings.colorNames || settings.customColors)
        ? { colorNames: colorNames(settings), customColors: customColors(settings) }
        : undefined,
      chats,
    };
  }

  /**
   * Merge a backup into existing storage contents without overwriting anything.
   * Returns { out, added } where `out` is the object to write to storage.
   */
  function applyBackup(existing, obj, newId) {
    if (!obj || obj.format !== 'highlighter-for-claude' || !obj.chats || typeof obj.chats !== 'object') {
      throw new Error('not a Highlighter backup');
    }
    const out = {};
    let added = 0;
    for (const [name, c] of Object.entries(obj.chats)) {
      if (!c || !Array.isArray(c.highlights)) continue;
      const m = S.matchKey(name) || (S.ID_RE.test(name) ? S.matchKey('chat:' + name) : null);
      if (!m) continue;
      const key = m.site.keyPrefix + m.id;
      const cur = (existing && existing[key]) || { id: m.id, title: '', url: '', updated: 0, highlights: [] };
      const have = new Set(cur.highlights.map((x) => x.id));
      for (const raw of c.highlights.slice(0, 5000)) {
        const hl = cleanHighlight(raw, newId);
        if (hl && !have.has(hl.id)) {
          cur.highlights.push(hl);
          have.add(hl.id);
          added++;
        }
      }
      cur.title = cur.title || str(c.title, 300);
      cur.url = m.site.chatUrl(m.id);
      cur.updated = Math.max(Number(cur.updated) || 0, Number(c.updated) || 0);
      cur.starred = cur.starred === true || c.starred === true;
      cur.tags = cleanTags([...(cur.tags || []), ...(Array.isArray(c.tags) ? c.tags : [])]);
      cur.shareUrl = shareOf(cur.shareUrl) || shareOf(c.shareUrl) || undefined;
      if (!cur.shareUrl) delete cur.shareUrl;
      out[key] = cur;
    }
    // Colour names only fill in when the user has not set their own.
    const cn = obj.settings && obj.settings.colorNames;
    const cur = existing && existing.settings;
    if (cn && typeof cn === 'object' && !(cur && cur.colorNames)) {
      out.settings = { ...(cur || {}), colorNames: colorNames({ colorNames: cn }) };
    }
    const cc = customColors(obj.settings);
    if (Object.keys(cc).length && !(cur && cur.customColors && Object.keys(customColors(cur)).length)) {
      out.settings = { ...(out.settings || cur || {}), customColors: cc };
    }
    return { out, added };
  }

  const api = {
    COLOR_KEYS, ALL_KEYS, CUSTOM_KEYS, customColors, colorList, hexToRgb, COLOR_LABELS, MAX_TAGS, MAX_TAG_LEN, MAX_NAME_LEN,
    colorNames, cleanTags, chatsFrom, filterChats, sortChats, counts, commentCount,
    chatMarkdown, libraryMarkdown, quoteMarkdown, cleanHighlight, buildBackup, applyBackup,
  };
  if (isNode) module.exports = api;
  else root.HFCLibrary = api;
})(typeof self !== 'undefined' ? self : this);
