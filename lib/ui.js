/* Small helpers shared by the popup and the Library page (extension pages only). */
(function (root) {
  'use strict';

  const ext = globalThis.browser || globalThis.chrome; // `browser` in Firefox, `chrome` in Chromium
  const S = root.HFCSites;
  const COLOR_HEX = { yellow: '#FFD500', green: '#3DDC84', blue: '#4DA3FF', pink: '#FF6FB5' };
  const $ = (sel, el = document) => el.querySelector(sel);

  function h(tag, props = {}, kids = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    el.append(...[].concat(kids).filter(Boolean));
    return el;
  }
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const excerpt = (s, n = 160) => (s.length > n ? s.slice(0, n) + '…' : s);

  // Custom colours (c1..c4) live in settings; keep the swatch table in step with them.
  function syncCustomColors(settings) {
    const src = (settings && settings.customColors) || {};
    for (const k of ['c1', 'c2', 'c3', 'c4']) {
      if (typeof src[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(src[k])) COLOR_HEX[k] = src[k];
      else delete COLOR_HEX[k];
    }
  }
  function dot(color) {
    const d = h('span', { class: 'dot' });
    d.style.background = COLOR_HEX[color] || COLOR_HEX.yellow;
    return d;
  }
  // A small coloured pill naming the platform a chat lives on.
  const sitePill = (site) => h('span', { class: 'pill', 'data-site': site.id, text: site.name });

  function relTime(ts) {
    if (!ts) return '';
    const d = Math.floor((Date.now() - ts) / 86400000);
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 7) return d + ' days ago';
    return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
  }

  function makeToast(el) {
    let t;
    return (msg) => {
      el.textContent = msg;
      el.hidden = false;
      clearTimeout(t);
      t = setTimeout(() => (el.hidden = true), 2600);
    };
  }

  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'chat';
  const stamp = () => new Date().toISOString().slice(0, 10);

  // ---------- storage ----------
  const sGet = (k) => ext.storage.local.get(k).then((x) => x || {});
  const sSet = (o) => ext.storage.local.set(o);
  const sRemove = (k) => ext.storage.local.remove(k);
  // Read-modify-write one chat record (star, tags). The page's content script picks the change up.
  async function patchChat(key, fn) {
    const cur = (await sGet(key))[key];
    if (!cur) return null;
    fn(cur);
    await sSet({ [key]: cur });
    return cur;
  }

  // Open a chat: reuse the tab it is already open in, otherwise open a new one. Optionally scroll
  // to one highlight.
  async function openChat(site, id, hid) {
    const url = site.chatUrl(id);
    let tabs = [];
    try {
      tabs = await ext.tabs.query({ url: site.hosts.map((x) => 'https://' + x + '/*') });
    } catch (_) {}
    const existing = tabs.find((t) => {
      const m = t.url && S.matchUrl(t.url);
      return m && m.site === site && m.id === id;
    });
    if (existing) {
      try {
        await ext.tabs.update(existing.id, { active: true });
        if (existing.windowId != null) await ext.windows.update(existing.windowId, { focused: true });
        if (hid) {
          const r = await ext.tabs.sendMessage(existing.id, { type: 'hfc:jump', id: hid });
          if (r && r.ok) return;
        } else return;
      } catch (_) {
        /* content script not running there: fall through to a fresh load */
      }
    }
    if (hid) await sSet({ pendingJump: { site: site.id, chatId: id, id: hid, at: Date.now() } });
    if (existing) await ext.tabs.update(existing.id, { url, active: true });
    else await ext.tabs.create({ url });
  }

  root.HFCUI = {
    ext, $, h, plural, excerpt, dot, sitePill, relTime, makeToast, download, slug, stamp,
    sGet, sSet, sRemove, patchChat, openChat, COLOR_HEX, syncCustomColors,
  };
})(self);
