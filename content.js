/* Tessel: content script (runs on claude.ai and chatgpt.com).
 *
 * Everything that differs between sites (URL shape, conversation container, storage key, export
 * labels) comes from the profile in lib/sites.js, picked by hostname. On any other host this
 * script does nothing.
 *
 * - Highlights are painted with the CSS Custom Highlight API, so the page's DOM is never modified
 *   (safe with React re-renders and streaming responses).
 * - Each highlight is stored as a text quote plus context, per chat, in extension storage, and is
 *   re-located whenever the page changes.
 * - Select text and a small toolbar appears; or press 1-4 / H / C. Alt+Up/Down steps through highlights.
 * - Comments live in a small popover; a badge marks highlights that have one.
 * - No innerHTML is used anywhere, so the page's Trusted Types / CSP settings cannot interfere.
 */
(() => {
  'use strict';
  if (window.__hfcLoaded) return;
  const SITE = self.HFCSites && self.HFCSites.detect(location.hostname);
  if (!SITE) return;
  window.__hfcLoaded = true;

  const ext = globalThis.browser || globalThis.chrome; // `browser` in Firefox, `chrome` in Chromium
  const A = self.HFCAnchor;
  const X = self.HFCExport;
  const K = self.HFCKeys;
  const L = self.HFCLibrary;

  const BASE_COLORS = [
    { key: 'yellow', label: 'Yellow', rgb: '255,213,0' },
    { key: 'green', label: 'Green', rgb: '61,220,132' },
    { key: 'blue', label: 'Blue', rgb: '77,163,255' },
    { key: 'pink', label: 'Pink', rgb: '255,111,181' },
  ];
  let COLORS = BASE_COLORS; // plus the user's custom colours (settings.customColors), see rebuildColors
  const DEFAULTS = { showHighlights: true, showComments: true, selectionToolbar: true, quickKeys: true };
  const keyOf = (id) => SITE.keyPrefix + id;
  const EDITABLE = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])';
  const SUPPORTED = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

  const state = {
    chatId: null,
    data: null, // { id, title, url, updated, highlights: [] }
    ranges: new Map(), // highlight id -> live Range
    openId: null,
    navId: null, // highlight last reached with Alt+Up/Down
    navAt: 0,
    lastColor: 'yellow',
    pendingJump: null,
    lastSaved: '',
    loadP: Promise.resolve(),
  };
  let settings = { ...DEFAULTS };
  let cached = null; // selection captured on right-click
  let draftAt = 0; // when the last highlight was added to a chat that has no URL id yet
  let lastReported = -1; // highlight count last sent to the toolbar-icon badge

  // ---------- small helpers ----------
  const alive = () => {
    try {
      return Boolean(ext.runtime && ext.runtime.id);
    } catch (_) {
      return false;
    }
  };
  const safe = (fn, fallback) => {
    try {
      return Promise.resolve(fn()).catch(() => fallback);
    } catch (_) {
      return Promise.resolve(fallback); // extension context invalidated (extension was reloaded)
    }
  };
  const store = {
    get: (k) => safe(() => ext.storage.local.get(k), {}).then((r) => r || {}),
    set: (o) => safe(() => ext.storage.local.set(o)),
    remove: (k) => safe(() => ext.storage.local.remove(k)),
  };
  function h(tag, props = {}, kids = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v);
    }
    el.append(...[].concat(kids).filter(Boolean));
    return el;
  }
  function commentIcon(size) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M2 3h12v8H7l-3 3v-3H2z');
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
    return svg;
  }
  const uid = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const chatIdFromUrl = () => SITE.chatIdFromPath(location.pathname);
  // The chat the page is showing. The page's own markup wins over the address bar, because the
  // address updates late (or only on reload) in a new chat and can lag behind a chat switch.
  const chatIdFromPage = () => {
    if (!SITE.chatIdFromPage) return null;
    try {
      return SITE.chatIdFromPage(getRoot());
    } catch (_) {
      return null;
    }
  };
  const currentChatId = () => chatIdFromPage() || chatIdFromUrl();
  const idSource = () => (chatIdFromPage() ? 'page' : chatIdFromUrl() ? 'address' : null);
  const cleanTitle = () => document.title.replace(SITE.titleSuffix, '').trim() || 'Untitled chat';
  const getRoot = () => {
    for (const s of SITE.rootSelectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return document.body;
  };
  const ROLE_SEL = SITE.roles.flatMap((r) => r.selectors).join(',');
  // True once the page shows a conversation, so a brand-new chat (no URL id yet) can be highlighted.
  // Messages are recognised by the site profile; if its guess about the markup is wrong, a page with
  // a long body of text still counts, while an empty "how can I help?" home page does not.
  const hasConversation = () => {
    const r = getRoot();
    if (ROLE_SEL && r.querySelector(ROLE_SEL)) return true;
    return (r.textContent || '').length >= 300;
  };
  // Identity of the first message on screen: tells two id-less new chats apart.
  const firstMessage = () => {
    const el = ROLE_SEL && getRoot().querySelector(ROLE_SEL);
    if (!el) return '';
    return el.getAttribute('data-message-id') || el.id || (el.textContent || '').trim().slice(0, 60);
  };
  const routeKey = () => {
    const id = currentChatId();
    return id ? 'id:' + id : 'draft:' + firstMessage();
  };
  const emptyData = (id) => ({ id, title: '', url: '', updated: 0, highlights: [] });
  const getH = (id) => (state.data ? state.data.highlights.find((x) => x.id === id) : undefined);
  const colorOf = (key) => (COLORS.find((c) => c.key === key) || COLORS[0]).rgb;
  const isColor = (key) => COLORS.some((c) => c.key === key);
  const elementOf = (n) => (n && n.nodeType === 1 ? n : n && n.parentElement);
  const inEditable = (n) => {
    const el = elementOf(n);
    return Boolean(el && el.closest && el.closest(EDITABLE));
  };

  // ---------- UI (shadow DOM, so the page's CSS cannot touch it) ----------
  const UI_CSS = `
    :host{--bg:#fff;--fg:#1f1e1d;--bd:#d8d5cf;--mut:#6b6862;--field:#f6f4f0}
    @media (prefers-color-scheme:dark){:host{--bg:#2b2a27;--fg:#ece9e2;--bd:#4a4843;--mut:#a09c94;--field:#1f1e1c}}
    *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    .layer{position:fixed;inset:0;pointer-events:none}
    .badge{position:fixed;pointer-events:auto;width:20px;height:20px;border-radius:50%;border:0;padding:0;display:grid;place-items:center;background:#c96442;color:#fff;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.35)}
    .badge:hover{transform:scale(1.12)}
    .pop{position:fixed;width:320px;max-width:calc(100vw - 16px);background:var(--bg);color:var(--fg);border:1px solid var(--bd);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:12px;font-size:13px;line-height:1.4}
    .pop[hidden],.toast[hidden],.tb[hidden]{display:none}
    .quote{max-height:4.4em;overflow:hidden;color:var(--mut);border-left:3px solid var(--c,#ffd500);padding-left:8px}
    .row{display:flex;gap:8px;align-items:center;margin:10px 0}
    .sw{width:20px;height:20px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}
    .sw[aria-pressed="true"]{border-color:var(--fg)}
    textarea{width:100%;min-height:72px;resize:vertical;border:1px solid var(--bd);border-radius:8px;padding:8px;background:var(--field);color:var(--fg);font-size:13px}
    .actions{display:flex;justify-content:space-between;margin-top:10px}
    .btn{border:1px solid var(--bd);background:transparent;color:var(--fg);border-radius:8px;padding:5px 12px;cursor:pointer;font-size:12.5px}
    .btn.primary{background:#c96442;border-color:#c96442;color:#fff}
    .btn.danger{color:#c0392b}
    .tb{position:fixed;display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--bg);color:var(--fg);border:1px solid var(--bd);border-radius:999px;box-shadow:0 4px 18px rgba(0,0,0,.28)}
    .tsw{width:24px;height:24px;border-radius:50%;border:0;padding:0;cursor:pointer;color:#1f1e1d;font-size:11px;font-weight:600;display:grid;place-items:center}
    .tsw:hover{transform:scale(1.12)}
    .tbtn{display:flex;gap:4px;align-items:center;height:24px;padding:0 8px;border:0;border-radius:999px;background:transparent;color:var(--fg);cursor:pointer;font-size:11px;font-weight:600}
    .tbtn:hover{background:var(--field)}
    .sep{width:1px;height:16px;background:var(--bd)}
    .tact{margin-left:10px;border:0;background:transparent;color:#ffb38a;font:inherit;font-weight:600;cursor:pointer;text-decoration:underline;padding:0}
    .panel{position:fixed;top:12px;right:12px;bottom:12px;width:340px;max-width:calc(100vw - 24px);display:flex;flex-direction:column;background:var(--bg);color:var(--fg);border:1px solid var(--bd);border-radius:14px;box-shadow:0 10px 36px rgba(0,0,0,.3);font-size:13px;line-height:1.4}
    .panel[hidden]{display:none}
    .ph{display:flex;align-items:center;justify-content:space-between;padding:12px 12px 6px 14px;font-weight:600}
    .px{border:0;background:transparent;color:var(--mut);cursor:pointer;font-size:20px;line-height:1;padding:0 7px 2px;border-radius:6px}
    .px:hover{background:var(--field);color:var(--fg)}
    .ps{margin:4px 12px;width:calc(100% - 24px);padding:7px 10px;border:1px solid var(--bd);border-radius:8px;background:var(--field);color:var(--fg);font-size:13px}
    .pchips{display:flex;gap:6px;flex-wrap:wrap;padding:6px 12px 2px}
    .pchip{display:inline-flex;gap:5px;align-items:center;padding:2px 9px;border:1px solid var(--bd);border-radius:999px;background:transparent;color:var(--fg);cursor:pointer;font-size:12px}
    .pchip[aria-pressed="true"]{background:var(--field);border-color:var(--fg)}
    .pdot{width:10px;height:10px;border-radius:50%;flex:none;margin-top:4px}
    .plist{list-style:none;margin:0;padding:8px 8px 10px;overflow:auto;flex:1;display:flex;flex-direction:column;gap:6px}
    .pitem{display:flex;gap:8px;align-items:flex-start;padding:8px 9px;border:1px solid var(--bd);border-radius:10px;cursor:pointer}
    .pitem:hover,.pitem:focus-visible{background:var(--field);outline:none}
    .pitem.miss{opacity:.6}
    .pt{flex:1;min-width:0}
    .pq{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
    .pc{margin-top:4px;color:var(--mut);font-size:12px;white-space:pre-wrap;word-break:break-word}
    .pe{border:0;background:transparent;color:var(--mut);cursor:pointer;padding:2px 5px;border-radius:6px;font-size:13px}
    .pe:hover{background:var(--field);color:var(--fg)}
    .pempty{padding:18px;text-align:center;color:var(--mut)}
    .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1f1e1d;color:#fff;padding:8px 14px;border-radius:999px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.35);max-width:90vw}
  `;
  const host = document.createElement('div');
  host.setAttribute('data-hfc-ui', '');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(UI_CSS);
    shadow.adoptedStyleSheets = [sheet];
  } catch (_) {
    // Some browsers will not adopt a stylesheet made in a content script: fall back to a <style> element.
    shadow.append(h('style', { text: UI_CSS }));
  }

  const layer = h('div', { class: 'layer' });
  const quoteEl = h('div', { class: 'quote' });
  let swatches = [];
  const swatchRow = h('div', { class: 'row' });
  const note = h('textarea', { placeholder: 'Add a comment…  (Ctrl/Cmd+Enter to finish)', rows: '3' });
  const delBtn = h('button', { class: 'btn danger', type: 'button', text: 'Delete' });
  const doneBtn = h('button', { class: 'btn primary', type: 'button', text: 'Done' });
  const copyBtn = h('button', { class: 'btn', type: 'button', text: 'Copy', title: 'Copy as a Markdown quote with a link to this chat' });
  const pop = h('div', { class: 'pop', hidden: '', role: 'dialog', 'aria-label': 'Highlight' }, [
    quoteEl,
    swatchRow,
    note,
    h('div', { class: 'actions' }, [delBtn, copyBtn, doneBtn]),
  ]);

  // Selection toolbar: appears next to selected text. The digits are the matching quick keys.
  let toolbarSwatches = [];
  const toolbarComment = h(
    'button',
    { class: 'tbtn', type: 'button', title: 'Highlight and comment (C)', 'aria-label': 'Highlight and comment' },
    [commentIcon(12), h('span', { text: 'C' })]
  );
  toolbarComment.addEventListener('click', () => createFromSelection(state.lastColor, true));
  const barSep = h('span', { class: 'sep' });
  const bar = h('div', { class: 'tb', hidden: '', role: 'toolbar', 'aria-label': 'Highlight selection' }, [
    barSep,
    toolbarComment,
  ]);
  // Pressing a toolbar button must not clear the text selection it is about to use.
  bar.addEventListener('mousedown', (e) => e.preventDefault());

  // Outline panel: this chat's highlights in reading order, to click through while reading.
  const pTitle = h('span', { text: 'Highlights' });
  const pClose = h('button', { class: 'px', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close panel', text: '×' });
  const pSearch = h('input', { class: 'ps', type: 'search', placeholder: 'Search this chat’s highlights', 'aria-label': 'Search highlights' });
  const pChips = h('div', { class: 'pchips' });
  const pList = h('ul', { class: 'plist' });
  const panel = h('div', { class: 'panel', hidden: '', role: 'complementary', 'aria-label': 'Highlights in this chat' }, [
    h('div', { class: 'ph' }, [pTitle, pClose]),
    pSearch,
    pChips,
    pList,
  ]);

  const toastEl = h('div', { class: 'toast', hidden: '', role: 'status' });
  shadow.append(layer, panel, pop, bar, toastEl);
  document.documentElement.appendChild(host);

  // Keep typing in the comment box and panel away from the site's keyboard shortcuts.
  for (const ev of ['keydown', 'keyup', 'keypress']) {
    pop.addEventListener(ev, (e) => e.stopPropagation());
    panel.addEventListener(ev, (e) => e.stopPropagation());
  }
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setPanel(false);
  });
  pClose.addEventListener('click', () => setPanel(false));
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) closePopover();
  });

  let toastTimer = null;
  function toast(msg, action) {
    toastEl.textContent = msg;
    if (action) {
      const b = h('button', { class: 'tact', type: 'button', text: action.label });
      b.addEventListener('click', () => {
        toastEl.hidden = true;
        action.run();
      });
      toastEl.append(b);
    }
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), action ? 6000 : 2400);
  }

  // Colours: the four built-in ones plus up to four custom ones from the Library (quick keys 5-8).
  // Rebuilds the comment box swatches, the selection toolbar buttons and the highlight styles.
  let customSig = null;
  let customStyle = null;
  function rebuildColors() {
    const custom = L.customColors(settings);
    const sig = JSON.stringify(custom);
    if (sig === customSig) return;
    customSig = sig;
    COLORS = [...BASE_COLORS, ...L.CUSTOM_KEYS.filter((k) => custom[k]).map((k) => ({ key: k, label: k, rgb: L.hexToRgb(custom[k]) }))];
    if (!customStyle) {
      customStyle = document.createElement('style');
      customStyle.setAttribute('data-hfc-css', '');
      (document.head || document.documentElement).append(customStyle);
    }
    customStyle.textContent = COLORS.slice(4).map((c) => '::highlight(hfc-' + c.key + '){background-color:rgba(' + c.rgb + ',0.42)}').join('\n');
    swatches = COLORS.map((c) => {
      const b = h('button', { class: 'sw', type: 'button', title: c.label, 'aria-pressed': 'false' });
      b.style.background = 'rgb(' + c.rgb + ')';
      b.dataset.key = c.key;
      b.addEventListener('click', () => setColor(c.key));
      return b;
    });
    swatchRow.replaceChildren(...swatches);
    for (const b of toolbarSwatches) b.remove();
    toolbarSwatches = COLORS.map((c, i) => {
      const b = h('button', { class: 'tsw', type: 'button', title: c.label, 'aria-label': 'Highlight ' + c.label, text: String(i + 1) });
      b.style.background = 'rgb(' + c.rgb + ')';
      b.addEventListener('click', () => createFromSelection(c.key, false));
      return b;
    });
    for (const b of toolbarSwatches) barSep.before(b);
    const open0 = getH(state.openId);
    if (open0) syncSwatches(open0.color);
  }
  // Colour names the user chose in the Library (tooltips only).
  function applyColorNames() {
    rebuildColors();
    const names = L.colorNames(settings);
    swatches.forEach((b) => (b.title = names[b.dataset.key]));
    toolbarSwatches.forEach((b, i) => (b.title = names[COLORS[i].key] + ' (' + (i + 1) + ')'));
  }

  // ---------- persistence ----------
  async function loadChat() {
    // A chat that has no URL id yet (a brand-new one) keeps its highlights in memory only; if the
    // page then gets an id and shows the same text, they move over to the new chat.
    const carry =
      !state.chatId && state.data && state.data.highlights.length && Date.now() - draftAt < 15 * 60 * 1000
        ? state.data.highlights.slice()
        : null;
    state.chatId = currentChatId();
    state.data = null;
    state.pendingJump = null;
    state.navId = null;
    state.ranges.clear();
    lastReported = -1;
    closePopover();
    const id = state.chatId;
    if (!id) {
      state.data = emptyData(null);
      apply();
      return;
    }
    const key = keyOf(id);
    const r = await store.get([key, 'pendingJump']);
    if (id !== currentChatId()) return; // navigated away while loading
    let data = r[key] || emptyData(id);
    let moved = false;
    if (carry && !r[key]) {
      const idx = A.buildIndex(getRoot());
      if (carry.some((hl) => A.locate(idx, hl))) {
        data = { ...emptyData(id), highlights: carry };
        moved = true;
      }
    }
    state.data = data;
    state.lastSaved = JSON.stringify(state.data);
    const p = r.pendingJump;
    if (p && p.chatId === id && (!p.site || p.site === SITE.id) && Date.now() - p.at < 60000) {
      state.pendingJump = { id: p.id, until: Date.now() + 20000 };
    }
    if (p) store.remove('pendingJump');
    apply();
    if (moved) {
      await saveChat();
      toast('Highlights saved to this chat');
    }
  }

  async function saveChat() {
    if (!alive() || !state.chatId || !state.data) return;
    const d = state.data;
    d.title = cleanTitle();
    d.url = SITE.chatUrl(state.chatId);
    d.updated = Date.now();
    state.lastSaved = JSON.stringify(d);
    // A chat with no highlights is dropped, unless the user starred or tagged it in the Library.
    const keep = d.highlights.length > 0 || d.starred === true || Boolean(d.shareUrl) || (Array.isArray(d.tags) && d.tags.length > 0);
    if (!keep) await store.remove(keyOf(state.chatId));
    else await store.set({ [keyOf(state.chatId)]: d });
  }

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !alive()) return;
    if (changes.settings) {
      settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
      applyColorNames();
      apply();
      updateToolbar();
    }
    if (changes.lastColor && isColor(changes.lastColor.newValue)) state.lastColor = changes.lastColor.newValue;
    const key = keyOf(state.chatId);
    if (state.chatId && changes[key]) {
      const nv = changes[key].newValue;
      if (nv && JSON.stringify(nv) === state.lastSaved) return; // our own write
      state.data = nv || { id: state.chatId, title: '', url: '', updated: 0, highlights: [] };
      state.lastSaved = JSON.stringify(state.data);
      if (state.openId && !getH(state.openId)) closePopover();
      apply();
    }
  });

  // ---------- rendering ----------
  function apply() {
    const byColor = new Map();
    state.ranges.clear();
    if (state.data && state.data.highlights.length && settings.showHighlights) {
      const idx = A.buildIndex(getRoot());
      for (const hl of state.data.highlights) {
        const loc = A.locate(idx, hl);
        if (!loc) continue;
        const r = A.rangeFromOffsets(idx, loc.start, loc.end);
        if (!r) continue;
        state.ranges.set(hl.id, r);
        const ck = isColor(hl.color) ? hl.color : 'yellow'; // a removed custom colour falls back to yellow
        if (!byColor.has(ck)) byColor.set(ck, []);
        byColor.get(ck).push(r);
      }
    }
    if (SUPPORTED) {
      for (const c of COLORS) {
        const rs = byColor.get(c.key);
        if (rs && rs.length) CSS.highlights.set('hfc-' + c.key, new Highlight(...rs));
        else CSS.highlights.delete('hfc-' + c.key);
      }
      for (const k of L.CUSTOM_KEYS) if (!COLORS.some((c) => c.key === k)) CSS.highlights.delete('hfc-' + k);
    }
    renderBadges();
    renderPanel();
    reportCount();
    runPendingJump();
  }

  // Number of highlights on the extension's toolbar icon for this tab.
  function reportCount() {
    const n = state.data ? state.data.highlights.length : 0;
    if (n === lastReported) return;
    lastReported = n;
    safe(() => ext.runtime.sendMessage({ type: 'hfc:count', n }), null);
  }

  let applyTimer = null;
  function scheduleApply(delay = 400) {
    if (applyTimer) return; // throttle, not debounce: streaming never goes quiet
    applyTimer = setTimeout(() => {
      applyTimer = null;
      if (!alive()) return;
      try {
        // Page changes are also the cue to notice a different chat (the address may not have moved).
        if (!checkRoute()) apply();
      } catch (e) {
        console.warn('[Tessel]', e);
      }
    }, delay);
  }

  let frame = 0;
  function scheduleLayout() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderBadges();
      if (!bar.hidden) updateToolbar();
    });
  }
  function renderBadges() {
    layer.textContent = '';
    if (!settings.showHighlights || !settings.showComments || !state.data) return;
    for (const hl of state.data.highlights) {
      if (!hl.comment) continue;
      const r = state.ranges.get(hl.id);
      if (!r) continue;
      const rects = r.getClientRects();
      if (!rects.length) continue;
      const last = rects[rects.length - 1];
      if (last.bottom < 0 || last.top > innerHeight) continue;
      const b = h('button', { class: 'badge', type: 'button', title: hl.comment.slice(0, 120) }, [commentIcon(12)]);
      b.style.left = Math.min(last.right + 4, innerWidth - 26) + 'px';
      b.style.top = last.top + (last.height - 20) / 2 + 'px';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        openPopover(hl.id);
      });
      layer.append(b);
    }
  }

  // ---------- selection toolbar ----------
  let mouseDown = false;
  let mouseDownAt = 0;
  // Highlighting is never refused on a supported site: a chat that has no id yet keeps its
  // highlights in memory and files them under the chat as soon as an id shows up. (Text outside
  // the conversation area, and the prompt box, are still excluded by selectionInfo().)
  const canHighlight = () => true;
  function hideBar() {
    if (!bar.hidden) bar.hidden = true;
  }
  // The current selection, if it is real text inside the conversation (not the prompt box).
  function selectionInfo() {
    const sel = getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (!getRoot().contains(range.commonAncestorContainer) || inEditable(range.commonAncestorContainer)) return null;
    if (!sel.toString().trim()) return null;
    return { sel, range };
  }
  function updateToolbar() {
    checkRoute();
    if (!settings.selectionToolbar || !SUPPORTED || !canHighlight()) return hideBar();
    if (mouseDown && Date.now() - mouseDownAt < 10000) return; // still dragging
    const info = selectionInfo();
    if (!info) return hideBar();
    const rects = info.range.getClientRects();
    if (!rects.length) return hideBar();
    const first = rects[0];
    const last = rects[rects.length - 1];
    bar.hidden = false;
    const bw = bar.offsetWidth;
    const bh = bar.offsetHeight;
    let top = first.top - bh - 8;
    if (top < 8) top = last.bottom + 8;
    if (top > innerHeight - bh - 8) return hideBar();
    bar.style.left = Math.min(Math.max(8, first.left), Math.max(8, innerWidth - bw - 8)) + 'px';
    bar.style.top = top + 'px';
  }

  // ---------- popover ----------
  let saveTimer = null;
  const rangeRect = (r) => {
    const rs = r.getClientRects();
    return rs.length ? rs[rs.length - 1] : r.getBoundingClientRect();
  };
  function syncSwatches(key) {
    for (const s of swatches) s.setAttribute('aria-pressed', String(s.dataset.key === key));
    quoteEl.style.setProperty('--c', 'rgb(' + colorOf(key) + ')');
  }
  function placePopover(rect) {
    const w = 320;
    pop.style.left = Math.min(Math.max(8, rect.left), Math.max(8, innerWidth - w - 8)) + 'px';
    let top = rect.bottom + 8;
    pop.style.top = top + 'px';
    pop.hidden = false;
    const ph = pop.offsetHeight;
    if (top + ph > innerHeight - 8) {
      top = Math.max(8, rect.top - ph - 8);
      pop.style.top = top + 'px';
    }
  }
  function openPopover(id, { focus = false } = {}) {
    const hl = getH(id);
    const r = state.ranges.get(id);
    if (!hl || !r) return;
    flushSave();
    state.openId = id;
    quoteEl.textContent = hl.exact.length > 220 ? hl.exact.slice(0, 220) + '…' : hl.exact;
    note.value = hl.comment || '';
    syncSwatches(hl.color);
    placePopover(rangeRect(r));
    if (focus) note.focus({ preventScroll: true });
  }
  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      saveChat();
    }
  }
  function closePopover() {
    flushSave();
    // Hiding a focused textarea does not move focus until the next frame; until then it would
    // swallow the next shortcut as "typing in our own UI". Release focus explicitly.
    const active = shadow.activeElement;
    if (active && typeof active.blur === 'function') active.blur();
    pop.hidden = true;
    state.openId = null;
    renderBadges();
  }
  function setColor(key) {
    const hl = getH(state.openId);
    if (!hl) return;
    hl.color = key;
    hl.updated = Date.now();
    syncSwatches(key);
    saveChat();
    apply();
  }
  note.addEventListener('input', () => {
    const hl = getH(state.openId);
    if (!hl) return;
    hl.comment = note.value;
    hl.updated = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveChat();
      renderBadges();
    }, 400);
  });
  delBtn.addEventListener('click', () => {
    if (!state.data || !state.openId) return;
    const id = state.openId;
    const removed = getH(id);
    const chatAtDelete = state.chatId;
    state.data.highlights = state.data.highlights.filter((x) => x.id !== id);
    closePopover();
    saveChat();
    apply();
    toast('Highlight deleted', {
      label: 'Undo',
      run: () => {
        if (!removed || !state.data || state.chatId !== chatAtDelete || getH(removed.id)) return;
        state.data.highlights.push(removed);
        saveChat();
        apply();
      },
    });
  });
  copyBtn.addEventListener('click', async () => {
    const hl = getH(state.openId);
    if (!hl) return;
    const md = L.quoteMarkdown(hl, {
      title: (state.data && state.data.title) || cleanTitle(),
      url: state.chatId ? SITE.chatUrl(state.chatId) : location.href,
      site: SITE,
    });
    try {
      await navigator.clipboard.writeText(md);
      toast('Copied as Markdown');
    } catch (_) {
      toast("Couldn't copy to the clipboard.");
    }
  });
  doneBtn.addEventListener('click', closePopover);

  // ---------- creating highlights ----------
  document.addEventListener(
    'contextmenu',
    () => {
      try {
        const info = selectionInfo();
        if (!info) return;
        const root = getRoot();
        const anchor = A.anchorFromRange(A.buildIndex(root), info.range);
        if (anchor) cached = { anchor, chatId: state.chatId, at: Date.now() };
      } catch (_) {
        /* selection caching is best-effort */
      }
    },
    true
  );

  async function createFromSelection(colorIn, withComment) {
    if (!SUPPORTED) {
      toast('This browser is too old for this highlighter.');
      return { ok: false, error: 'unsupported' };
    }
    checkRoute();
    if (!canHighlight()) {
      toast('Open a chat first: there is nothing to highlight on this page.');
      return { ok: false, error: 'no-chat' };
    }
    const color = colorIn === 'last' || !isColor(colorIn) ? state.lastColor : colorIn;
    await state.loadP;
    if (!state.data) return { ok: false, error: 'not-loaded' };

    const root = getRoot();
    const sel = getSelection();
    let anchor = null;
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer) || inEditable(range.commonAncestorContainer)) {
        toast('Select text inside the conversation.');
        return { ok: false, error: 'outside' };
      }
      anchor = A.anchorFromRange(A.buildIndex(root), range);
    } else if (cached && cached.chatId === state.chatId && Date.now() - cached.at < 30000) {
      anchor = cached.anchor;
    }
    if (!anchor) {
      toast('Select some text first.');
      return { ok: false, error: 'no-selection' };
    }

    // Re-highlighting the same passage just recolours it.
    let hl = state.data.highlights.find((x) => x.exact === anchor.exact && x.prefix === anchor.prefix);
    if (hl) {
      hl.color = color;
      hl.updated = Date.now();
    } else {
      hl = { id: uid(), color, ...anchor, comment: '', created: Date.now(), updated: Date.now() };
      state.data.highlights.push(hl);
    }
    state.lastColor = color;
    store.set({ lastColor: color });
    if (!state.chatId) draftAt = Date.now();
    await saveChat();
    apply();
    hideBar();
    if (sel) sel.removeAllRanges();
    if (withComment) openPopover(hl.id, { focus: true });
    else toast(state.chatId ? 'Highlight saved' : 'Highlight added. It is saved as soon as the site names this chat.');
    return { ok: true, id: hl.id };
  }

  // ---------- outline panel ----------
  const pf = { q: '', color: null };
  function setPanel(open) {
    panel.hidden = !open;
    if (open) renderPanel();
    store.set({ panelOpen: open });
  }
  function renderPanel() {
    if (panel.hidden || !state.data) return;
    const names = L.colorNames(settings);
    const hls = state.data.highlights;
    const pos = new Map(orderedIds().map((id, i) => [id, i]));
    const rank = (x) => (pos.has(x.id) ? pos.get(x.id) : 1e9);
    const sorted = [...hls].sort((a, b) => rank(a) - rank(b) || (a.created || 0) - (b.created || 0));
    pTitle.textContent = 'Highlights · ' + hls.length;

    const present = COLORS.filter((c) => hls.some((x) => x.color === c.key));
    if (pf.color && !present.some((c) => c.key === pf.color)) pf.color = null;
    pChips.textContent = '';
    if (present.length > 1) {
      for (const c of [null, ...present]) {
        const chip = h('button', { class: 'pchip', type: 'button', 'aria-pressed': String(pf.color === (c && c.key)) }, [
          c ? h('span', { class: 'pdot' }) : null,
          c ? names[c.key] : 'All',
        ]);
        if (c) chip.querySelector('.pdot').style.background = 'rgb(' + c.rgb + ')';
        chip.addEventListener('click', () => {
          pf.color = c ? c.key : null;
          renderPanel();
        });
        pChips.append(chip);
      }
    }

    const q = pf.q.trim().toLowerCase();
    const shown = sorted.filter(
      (x) => (!pf.color || x.color === pf.color) && (!q || (x.exact + ' ' + (x.comment || '')).toLowerCase().includes(q))
    );
    pList.textContent = '';
    if (!hls.length) {
      pList.append(h('li', { class: 'pempty', text: 'No highlights yet. Select text and press 1–4.' }));
      return;
    }
    if (!shown.length) {
      pList.append(h('li', { class: 'pempty', text: 'Nothing matches.' }));
      return;
    }
    for (const x of shown) {
      const found = state.ranges.has(x.id);
      const dotEl = h('span', { class: 'pdot' });
      dotEl.style.background = 'rgb(' + colorOf(x.color) + ')';
      const edit = h('button', { class: 'pe', type: 'button', title: 'Edit comment or colour', 'aria-label': 'Edit', text: '✎' });
      const row = h('li', { class: 'pitem' + (found ? '' : ' miss'), tabindex: '0', role: 'button' }, [
        dotEl,
        h('div', { class: 'pt' }, [
          h('div', { class: 'pq', text: x.exact }),
          x.comment ? h('div', { class: 'pc', text: x.comment }) : null,
          found ? null : h('div', { class: 'pc', text: 'Not found in the page right now' }),
        ]),
        found ? edit : null,
      ]);
      const go = () => (found ? jumpTo(x.id) : toast("Couldn't find that text on the page."));
      row.addEventListener('click', go);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target === row) go();
      });
      edit.addEventListener('click', (e) => {
        e.stopPropagation();
        jumpTo(x.id);
        openPopover(x.id, { focus: true });
      });
      pList.append(row);
    }
  }
  pSearch.addEventListener('input', () => {
    pf.q = pSearch.value;
    renderPanel();
  });

  // ---------- jumping, stepping, status, export ----------
  let flashTimer = null;
  function jumpTo(id) {
    const r = state.ranges.get(id);
    if (!r) return false;
    const el = elementOf(r.startContainer);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (SUPPORTED) {
      CSS.highlights.set('hfc-focus', new Highlight(r));
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => CSS.highlights.delete('hfc-focus'), 1800);
    }
    return true;
  }
  function runPendingJump() {
    const p = state.pendingJump;
    if (!p) return;
    if (Date.now() > p.until) {
      state.pendingJump = null;
      return;
    }
    if (state.ranges.has(p.id)) {
      state.pendingJump = null;
      setTimeout(() => jumpTo(p.id), 250);
    }
  }
  function orderedIds() {
    return [...state.ranges.entries()]
      .sort((a, b) => a[1].compareBoundaryPoints(Range.START_TO_START, b[1]))
      .map((e) => e[0]);
  }
  // Alt+Down / Alt+Up: walk through this chat's highlights in reading order.
  function stepHighlight(dir) {
    const ids = orderedIds();
    if (!ids.length) {
      toast('No highlights in this chat yet.');
      return;
    }
    if (Date.now() - state.navAt > 30000) state.navId = null;
    let i = ids.indexOf(state.navId);
    if (i === -1) {
      // Start from what is on screen.
      const box = (id) => state.ranges.get(id).getBoundingClientRect();
      if (dir > 0) {
        i = ids.findIndex((id) => box(id).top > 8);
        if (i === -1) i = 0;
      } else {
        i = -1;
        ids.forEach((id, k) => {
          if (box(id).bottom < innerHeight - 8) i = k;
        });
        if (i === -1) i = ids.length - 1;
      }
    } else {
      i = (i + dir + ids.length) % ids.length;
    }
    state.navId = ids[i];
    state.navAt = Date.now();
    jumpTo(ids[i]);
    toast('Highlight ' + (i + 1) + ' of ' + ids.length + '  ·  Enter to open');
  }
  function slug(s) {
    return (
      s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || SITE.id + '-chat'
    );
  }
  function doExport(opts) {
    if (!state.data || !canHighlight()) return { ok: false, error: 'Open a chat first.' };
    const title = state.data.title || cleanTitle();
    const only = Array.isArray(opts.colors) ? opts.colors : null;
    const { html, applied, missing } = X.buildExportHtml({
      shareUrl: state.data.shareUrl,
      rootEl: getRoot(),
      title,
      highlights: only ? state.data.highlights.filter((x) => only.includes(x.color)) : state.data.highlights,
      includeHighlights: opts.highlights !== false,
      includeComments: opts.comments !== false,
      exportedAt: new Date(),
      roles: SITE.roles,
      remove: SITE.exportRemove,
      colorNames: L.colorNames(settings),
      customColors: L.customColors(settings),
    });
    return { ok: true, html, applied, missing, filename: slug(title) + '-highlights.html' };
  }

  // A plain-facts report the popup can show (and the user can paste into a bug report).
  function diagnostics() {
    const rootEl = getRoot();
    const messages = {};
    for (const r of SITE.roles) messages[r.label] = rootEl.querySelectorAll(r.selectors.join(',')).length;
    let version = '';
    try {
      version = ext.runtime.getManifest().version;
    } catch (_) {}
    return {
      version,
      site: SITE.id,
      chatId: state.chatId,
      chatIdFrom: idSource() || (state.chatId ? 'address' : 'none yet (new chat)'),
      address: location.pathname,
      container: rootEl === document.body ? '<body> (no <main> found)' : '<' + rootEl.tagName.toLowerCase() + '>',
      messagesFound: messages,
      highlightApi: SUPPORTED,
      selectionToolbar: settings.selectionToolbar,
      quickKeys: settings.quickKeys,
      highlightsStored: state.data ? state.data.highlights.length : 0,
      highlightsLocated: state.ranges.size,
      pageTextLength: (rootEl.textContent || '').length,
      unsavedHighlights: !state.chatId && state.data ? state.data.highlights.length : 0,
    };
  }

  ext.runtime.onMessage.addListener((msg, _sender, send) => {
    if (!msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'hfc:create':
        createFromSelection(msg.color, Boolean(msg.comment))
          .then(send)
          .catch((e) => send({ ok: false, error: String(e) }));
        return true;
      case 'hfc:jump':
        send({ ok: jumpTo(msg.id) });
        return;
      case 'hfc:status':
        send({
          ok: true,
          site: SITE.id,
          chatId: state.chatId,
          supported: SUPPORTED,
          order: orderedIds(),
          unsaved: !state.chatId && canHighlight() && state.data ? state.data.highlights.length : 0,
          diag: diagnostics(),
        });
        return;
      case 'hfc:share': {
        // Remember (or clear) the link the user pasted for this chat.
        const raw = String(msg.url || '').trim();
        const m = raw ? self.HFCSites.matchShareUrl(raw) : null;
        if (m && m.site !== SITE) {
          send({ ok: false, error: 'That link is for ' + m.site.name + ', not this site.' });
          return;
        }
        if (raw && !m) {
          send({ ok: false, error: 'That is not a link on ' + SITE.hosts.join(' or ') });
          return;
        }
        state.loadP.then(async () => {
          if (!state.data || !state.chatId) return send({ ok: false, error: 'Open a chat first.' });
          if (m) state.data.shareUrl = m.url;
          else delete state.data.shareUrl;
          await saveChat();
          send({ ok: true, url: m ? m.url : '' });
        });
        return true;
      }
      case 'hfc:transcript':
        try {
          const r = X.buildExportHtml({
            rootEl: getRoot(),
            title: (state.data && state.data.title) || cleanTitle(),
            highlights: state.data ? state.data.highlights : [],
            includeHighlights: false,
            includeComments: true,
            roles: SITE.roles,
            remove: SITE.exportRemove,
          });
          send({ ok: true, transcript: r.transcript });
        } catch (e) {
          send({ ok: false, error: String(e && e.message ? e.message : e) });
        }
        return;
      case 'hfc:panel':
        setPanel(msg.open === undefined ? panel.hidden : Boolean(msg.open));
        send({ ok: true, open: !panel.hidden });
        return;
      case 'hfc:export':
        try {
          send(doExport(msg.opts || {}));
        } catch (e) {
          send({ ok: false, error: String(e && e.message ? e.message : e) });
        }
        return;
    }
  });

  // ---------- keyboard ----------
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && !bar.hidden) hideBar();
      if (!settings.quickKeys || e.defaultPrevented || e.composedPath().includes(host)) return;
      const t = e.target;
      const editable = Boolean(t && (t.isContentEditable || inEditable(t)));
      const act = K.decideKey(
        { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, isComposing: e.isComposing },
        {
          quickKeys: settings.quickKeys,
          editable,
          hasSelection: !editable && Boolean(selectionInfo()),
          navActive: Boolean(state.navId && Date.now() - state.navAt < 15000 && state.ranges.has(state.navId)),
        }
      );
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      switch (act.type) {
        case 'highlight':
          if (act.color !== 'last' && !isColor(act.color)) break; // key 5-8 without that custom colour
          createFromSelection(act.color, false);
          break;
        case 'comment':
          createFromSelection('last', true);
          break;
        case 'next':
          stepHighlight(1);
          break;
        case 'prev':
          stepHighlight(-1);
          break;
        case 'open':
          openPopover(state.navId, { focus: true });
          break;
        case 'panel':
          setPanel(panel.hidden);
          break;
      }
    },
    true
  );

  // ---------- pointer: click a highlight to edit it; select text to get the toolbar ----------
  function hitTest(x, y) {
    let best = null;
    let bestLen = Infinity;
    for (const [id, r] of state.ranges) {
      let hit = false;
      for (const q of r.getClientRects()) {
        if (x >= q.left - 1 && x <= q.right + 1 && y >= q.top - 1 && y <= q.bottom + 1) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
      const hl = getH(id);
      const len = hl ? hl.exact.length : Infinity;
      if (len < bestLen) {
        bestLen = len;
        best = id;
      }
    }
    return best;
  }
  document.addEventListener(
    'click',
    (e) => {
      if (e.composedPath().includes(host)) return;
      if (!settings.showHighlights || !state.ranges.size) return;
      const sel = getSelection();
      if (sel && !sel.isCollapsed) return; // user is selecting text
      if (e.target.closest && e.target.closest('a,button,input,textarea,select,summary,[role="button"]')) return;
      const id = hitTest(e.clientX, e.clientY);
      if (id) openPopover(id);
    },
    true
  );
  document.addEventListener(
    'mousedown',
    (e) => {
      if (e.composedPath().includes(host)) return;
      mouseDown = true;
      mouseDownAt = Date.now();
      hideBar();
      if (!pop.hidden) closePopover();
    },
    true
  );
  document.addEventListener(
    'mouseup',
    () => {
      mouseDown = false;
      setTimeout(updateToolbar, 0);
    },
    true
  );
  // Belt and braces: if a site swallows `mouseup`, any later pointer event with no button down
  // clears the "still dragging" flag, so the toolbar can never get stuck hidden.
  for (const ev of ['pointerup', 'pointercancel']) {
    addEventListener(ev, () => (mouseDown = false), true);
  }
  addEventListener(
    'mousemove',
    (e) => {
      if (mouseDown && e.buttons === 0) {
        mouseDown = false;
        setTimeout(updateToolbar, 0);
      }
    },
    true
  );
  // Pressing inside an existing selection starts a text drag, which ends in `dragend` instead of
  // `mouseup`; without these the "still dragging" flag would stay set and the toolbar stay hidden.
  document.addEventListener(
    'dragstart',
    () => {
      mouseDown = false;
      hideBar();
    },
    true
  );
  document.addEventListener(
    'dragend',
    () => {
      mouseDown = false;
      setTimeout(updateToolbar, 0);
    },
    true
  );
  addEventListener('blur', () => {
    mouseDown = false;
  });
  document.addEventListener(
    'keyup',
    (e) => {
      if (e.key === 'Shift' || (typeof e.key === 'string' && e.key.startsWith('Arrow'))) setTimeout(updateToolbar, 0);
    },
    true
  );
  // Selections made without a mouse release (double-click, Select all, keyboard) also get a toolbar.
  let selTimer = null;
  document.addEventListener('selectionchange', () => {
    const sel = getSelection();
    if (!sel || sel.isCollapsed) return hideBar();
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      if (!mouseDown || Date.now() - mouseDownAt >= 10000) updateToolbar();
    }, 220);
  });

  // ---------- keep up with the page ----------
  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      const el = elementOf(m.target);
      if (el && el.closest && el.closest('[data-hfc-ui]')) continue;
      scheduleApply();
      return;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  addEventListener('scroll', scheduleLayout, true);
  addEventListener('resize', scheduleLayout);

  // Both sites are single-page apps: watch for navigation between chats. The path is also
  // re-checked whenever the user selects text or comes back to the tab, so a missed tick can
  // never leave the extension looking at the previous chat.
  let lastRoute = routeKey();
  function checkRoute() {
    const k = routeKey();
    if (k === lastRoute) return false;
    // Between two id-less states the first-message identity can blink empty while the page
    // re-renders; that is not a different chat, so it must not wipe an unsaved draft.
    if (k.startsWith('draft:') && lastRoute.startsWith('draft:') && (k === 'draft:' || lastRoute === 'draft:')) {
      if (k !== 'draft:') lastRoute = k;
      return false;
    }
    lastRoute = k;
    state.loadP = loadChat();
    return true;
  }
  const navTimer = setInterval(() => {
    if (!alive()) {
      clearInterval(navTimer);
      observer.disconnect();
      return;
    }
    checkRoute();
  }, 500);
  addEventListener('popstate', checkRoute);
  addEventListener('focus', checkRoute);
  document.addEventListener('visibilitychange', checkRoute);

  (async () => {
    const r = await store.get(['settings', 'lastColor', 'panelOpen']);
    settings = { ...DEFAULTS, ...(r.settings || {}) };
    if (isColor(r.lastColor)) state.lastColor = r.lastColor;
    applyColorNames();
    if (r.panelOpen === true) panel.hidden = false;
    state.loadP = loadChat();
  })();
})();
