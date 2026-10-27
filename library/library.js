'use strict';

const { ext, $, h, plural, dot, sitePill, relTime, makeToast, download, slug, stamp, sGet, sSet, sRemove, patchChat, openChat, COLOR_HEX, syncCustomColors } = self.HFCUI;
const S = self.HFCSites;
const L = self.HFCLibrary;

const DAY = 86400000;
const state = {
  all: {},
  chats: [],
  nav: 'all', // 'all' | a site id | 'starred'
  tag: null,
  color: null,
  q: '',
  sort: 'recent',
  expanded: new Set(),
  names: L.colorNames(),
  settings: { showHighlights: true, showComments: true, selectionToolbar: true, quickKeys: true },
};
const toast = makeToast($('#toast'));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// A two-click button: the first click arms it, the second (within 3 s) does the thing.
function armed(btn, label, confirmLabel, run) {
  btn.textContent = label;
  btn.addEventListener('click', () => {
    if (btn.hasAttribute('data-armed')) {
      btn.removeAttribute('data-armed');
      btn.textContent = label;
      run();
      return;
    }
    btn.setAttribute('data-armed', '');
    btn.textContent = confirmLabel;
    setTimeout(() => {
      btn.removeAttribute('data-armed');
      btn.textContent = label;
    }, 3000);
  });
  return btn;
}

// ---------- data ----------
async function reload() {
  state.all = await sGet(null);
  state.chats = L.chatsFrom(state.all);
  state.settings = { ...state.settings, ...(state.all.settings || {}) };
  state.names = L.colorNames(state.all.settings);
  syncCustomColors(state.all.settings);
}
const visible = () =>
  L.filterChats(state.chats, {
    platform: S.byId(state.nav) ? state.nav : 'all',
    starred: state.nav === 'starred',
    tag: state.tag,
    color: state.color,
    q: state.q,
  });

// ---------- rail ----------
function renderRail() {
  const { counts, tags } = L.counts(state.chats);
  const nav = $('#nav');
  nav.textContent = '';
  const items = [
    ['all', 'All chats', null, counts.all],
    ...S.PROFILES.map((p) => [p.id, p.name, h('span', { class: 'sq', 'data-site': p.id }), counts[p.id]]),
    ['starred', '★ Starred', null, counts.starred],
  ];
  for (const [id, label, icon, n] of items) {
    nav.append(
      h(
        'button',
        {
          class: 'navitem',
          type: 'button',
          'aria-current': String(state.nav === id && $('#view-library').hidden === false),
          onclick: () => {
            state.nav = id;
            showLibrary();
          },
        },
        [h('span', { class: 'lbl' }, [icon, label]), h('span', { class: 'n', text: String(n) })]
      )
    );
  }

  $('#tags-wrap').hidden = !tags.length;
  const tg = $('#tags');
  tg.textContent = '';
  for (const t of tags) {
    tg.append(
      h(
        'button',
        {
          class: 'navitem',
          type: 'button',
          'aria-current': String(state.tag && state.tag.toLowerCase() === t.name.toLowerCase()),
          onclick: () => {
            state.tag = state.tag && state.tag.toLowerCase() === t.name.toLowerCase() ? null : t.name;
            showLibrary();
          },
        },
        [h('span', { class: 'lbl', text: '#' + t.name }), h('span', { class: 'n', text: String(t.n) })]
      )
    );
  }
  const dl = $('#tag-list');
  dl.textContent = '';
  for (const t of tags) dl.append(h('option', { value: t.name }));

  const cg = $('#colors');
  cg.textContent = '';
  for (const c of L.colorList(state.all.settings)) {
    const total = state.chats.reduce((n, ch) => n + ch.highlights.filter((x) => x.color === c).length, 0);
    cg.append(
      h(
        'button',
        {
          class: 'navitem',
          type: 'button',
          'aria-current': String(state.color === c),
          onclick: () => {
            state.color = state.color === c ? null : c;
            showLibrary();
          },
        },
        [h('span', { class: 'lbl' }, [dot(c), state.names[c]]), h('span', { class: 'n', text: String(total) })]
      )
    );
  }
  $('#go-settings').setAttribute('aria-current', String($('#view-settings').hidden === false));
}

// ---------- library ----------
function renderBanner() {
  const b = $('#banner');
  const total = state.chats.reduce((n, c) => n + c.highlights.length, 0);
  const last = Number(state.all.lastBackup) || 0;
  const auto = state.all.autoBackup === true;
  let text = '';
  let label = '';
  let run = null;
  if (!state.chats.length && !last) {
    text = 'Reinstalled, or moved to a new browser? Restore your highlights from a backup file.';
    label = 'Restore from backup…';
    run = () => $('#file').click();
  } else if (total > 0 && !auto) {
    text = last
      ? `Your last backup was ${relTime(last)}. Turn on automatic backups so a reinstall can never lose your highlights.`
      : 'Your highlights live only in this browser. Turn on automatic backups so a reinstall can never lose them.';
    label = 'Turn on automatic backups';
    run = () => setAutoBackup(true);
  } else if (total > 0 && auto && state.all.backupError) {
    text = 'Automatic backup could not write a file: ' + state.all.backupError;
    label = 'Back up now';
    run = backup;
  } else if (state.all.restoredAt && Date.now() - state.all.restoredAt < 7 * DAY && !state.all.restoredSeen) {
    text = `Recovered ${plural(state.all.restoredChats || 0, 'chat')} from the safety copy after a storage problem.`;
    label = 'OK';
    run = () => sSet({ restoredSeen: true });
  }
  b.hidden = !text;
  if (!text) return;
  b.textContent = '';
  b.append(h('span', { text }), h('button', { class: 'btn primary small', type: 'button', text: label, onclick: run }));
}

function renderCards() {
  const res = visible();
  const totalHl = res.reduce((n, r) => n + r.matches.length, 0);
  const byKey = new Map(res.map((r) => [r.chat.key, r.matches]));
  const ordered = L.sortChats(
    res.map((r) => r.chat),
    state.sort,
    true
  );

  // summary line with removable filter chips
  const sum = $('#summary');
  sum.textContent = '';
  sum.append(h('span', { text: plural(ordered.length, 'chat') + ' · ' + plural(totalHl, 'highlight') }));
  const chip = (label, clear) => h('button', { class: 'chip', type: 'button', title: 'Remove filter', onclick: clear, text: label + ' ×' });
  if (state.tag) sum.append(chip('#' + state.tag, () => ((state.tag = null), showLibrary())));
  if (state.color) sum.append(chip(state.names[state.color], () => ((state.color = null), showLibrary())));

  const root = $('#cards');
  root.textContent = '';
  if (!state.chats.length) {
    root.append(
      h('li', { class: 'empty' }, [
        h('p', { text: 'No highlights yet.' }),
        h('p', { class: 'hint', text: 'Open a chat on Claude or ChatGPT, select some text and press 1–4. Your highlights will be organised here.' }),
      ])
    );
    return;
  }
  if (!ordered.length) {
    root.append(h('li', { class: 'empty', text: 'Nothing matches these filters.' }));
    return;
  }
  const searching = Boolean(state.q.trim() || state.color);
  for (const c of ordered) root.append(card(c, byKey.get(c.key) || c.highlights, searching));
}

function card(c, matches, searching) {
  const open = expanded(c);
  const shown = open ? matches : matches.slice(0, 3);
  const comments = L.commentCount(c);

  const star = h('button', {
    class: 'star',
    type: 'button',
    'aria-pressed': String(c.starred),
    'aria-label': 'Star',
    title: c.starred ? 'Unstar' : 'Star this chat to keep it at the top',
    text: c.starred ? '★' : '☆',
    onclick: () => patchChat(c.key, (r) => (r.starred = !r.starred)),
  });
  const title = h('a', { href: c.url, title: c.title, text: c.title || 'Untitled chat' });
  title.addEventListener('click', (e) => {
    e.preventDefault();
    openChat(c.site, c.id);
  });

  const tagRow = h('div', { class: 'tagrow' });
  for (const t of c.tags) {
    tagRow.append(
      h('span', { class: 'tag' }, [
        t,
        h('button', { type: 'button', 'aria-label': 'Remove tag ' + t, text: '×', onclick: () => patchChat(c.key, (r) => (r.tags = L.cleanTags(r.tags).filter((x) => x.toLowerCase() !== t.toLowerCase()))) }),
      ])
    );
  }
  const addTag = h('button', { class: 'btn small', type: 'button', text: '+ tag' });
  addTag.addEventListener('click', () => {
    const input = h('input', { type: 'text', list: 'tag-list', placeholder: 'tag name', maxlength: String(L.MAX_TAG_LEN), 'aria-label': 'New tag' });
    let done = false;
    const commit = (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      input.blur(); // release focus first, or the list would not refresh when the change lands
      if (save && v) patchChat(c.key, (r) => (r.tags = L.cleanTags([...(r.tags || []), v])));
      else renderCards();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit(true);
      if (e.key === 'Escape') commit(false);
    });
    input.addEventListener('blur', () => commit(true));
    addTag.replaceWith(input);
    input.focus();
  });
  if (c.tags.length < L.MAX_TAGS) tagRow.append(addTag);

  const list = h('ul', { class: 'hls' });
  for (const x of shown) {
    const b = h('button', { class: 'hl', type: 'button', title: 'Open the chat at this highlight · ' + (state.names[x.color] || x.color) }, [
      dot(x.color),
      h('div', { class: 'body' }, [h('div', { class: 'quote', text: x.exact }), x.comment ? h('div', { class: 'comment', text: x.comment }) : null]),
    ]);
    b.addEventListener('click', () => openChat(c.site, c.id, x.id));
    list.append(h('li', {}, [b]));
  }
  const more =
    matches.length > 3
      ? h('button', {
          class: 'btn small more',
          type: 'button',
          text: open ? 'Show fewer' : `Show all ${matches.length}`,
          onclick: () => {
            if (open) state.expanded.delete(c.key);
            else state.expanded.add(c.key);
            renderCards();
          },
        })
      : null;

  const wipe = armed(h('button', { class: 'btn small danger', type: 'button' }), 'Delete', 'Delete ' + plural(c.highlights.length, 'highlight') + '?', async () => {
    await sRemove(c.key);
    toast('Deleted from the library');
  });

  return h('li', { class: 'card' }, [
    h('div', { class: 'card-head' }, [
      star,
      h('div', { class: 'card-title' }, [
        title,
        h('div', { class: 'meta' }, [
          sitePill(c.site),
          h('span', { text: plural(c.highlights.length, 'highlight') + (comments ? ' · ' + plural(comments, 'comment') : '') }),
          c.updated ? h('span', { text: '· ' + relTime(c.updated) }) : null,
          searching && matches.length !== c.highlights.length ? h('span', { text: '· ' + matches.length + ' match' + (matches.length === 1 ? '' : 'es') }) : null,
        ]),
      ]),
    ]),
    tagRow,
    list,
    more,
    h('div', { class: 'card-actions' }, [
      h('button', { class: 'btn small', type: 'button', text: 'Open chat', onclick: () => openChat(c.site, c.id) }),
      h('button', {
        class: 'btn small',
        type: 'button',
        text: 'Copy Markdown',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(L.chatMarkdown(c, { colorNames: state.names }));
            toast('Copied as Markdown');
          } catch (_) {
            toast("Couldn't copy to the clipboard.");
          }
        },
      }),
      h('button', { class: 'btn small', type: 'button', text: 'Download .md', onclick: () => download(slug(c.title || c.site.id) + '-highlights.md', L.chatMarkdown(c, { colorNames: state.names }), 'text/markdown') }),
      h('span', { class: 'spacer' }),
      wipe,
    ]),
  ]);
}
const expanded = (c) => state.expanded.has(c.key);

function exportView() {
  const chats = L.sortChats(visible().map((r) => r.chat), state.sort, true);
  if (!chats.length) return toast('Nothing to export.');
  const byKey = new Map(visible().map((r) => [r.chat.key, r.matches]));
  // Export only the highlights that match an active colour filter; everything otherwise.
  const trimmed = chats.map((c) => ({ ...c, highlights: state.color ? byKey.get(c.key) : c.highlights }));
  download('highlights-library-' + stamp() + '.md', L.libraryMarkdown(trimmed, { colorNames: state.names }), 'text/markdown');
}

// ---------- settings & data ----------
function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

async function renderSettings() {
  $('#t-hl').checked = state.settings.showHighlights;
  $('#t-cm').checked = state.settings.showComments;
  $('#t-tb').checked = state.settings.selectionToolbar;
  $('#t-qk').checked = state.settings.quickKeys;

  const box = $('#names');
  const keys = L.colorList(state.all.settings);
  const custom = L.customColors(state.all.settings);
  const sig = keys.join(',') + JSON.stringify(custom);
  if (box.dataset.sig !== sig && !(box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && box.dataset.sig)) {
    box.dataset.sig = sig;
    box.textContent = '';
    for (const c of keys) {
      const isCustom = L.CUSTOM_KEYS.includes(c);
      const input = h('input', { type: 'text', id: 'name-' + c, maxlength: String(L.MAX_NAME_LEN), placeholder: L.COLOR_LABELS[c] || 'Custom', 'aria-label': 'Name for ' + (L.COLOR_LABELS[c] || 'custom colour').toLowerCase() });
      input.addEventListener('change', saveNames);
      const kids = [];
      if (isCustom) {
        const pick = h('input', { type: 'color', id: 'hex-' + c, value: custom[c], 'aria-label': 'Colour for ' + c, class: 'swatch-input' });
        pick.addEventListener('change', () => saveCustom(c, pick.value));
        kids.push(pick);
      } else kids.push(dot(c));
      kids.push(input);
      if (isCustom) kids.push(h('button', { class: 'btn small', type: 'button', text: 'Remove', onclick: () => removeCustom(c) }));
      box.append(h('label', {}, kids));
    }
  }
  for (const c of keys) {
    const el = $('#name-' + c);
    const def = L.COLOR_LABELS[c] || '';
    if (el && document.activeElement !== el) el.value = state.names[c] === def || /^Custom \d$/.test(state.names[c]) ? '' : state.names[c];
  }
  const free = L.CUSTOM_KEYS.filter((k) => !custom[k]);
  $('#color-add').hidden = !free.length;

  let used = 0;
  try {
    used = await ext.storage.local.getBytesInUse(null);
  } catch (_) {}
  const quota = (ext.storage.local && ext.storage.local.QUOTA_BYTES) || 10485760;
  const total = state.chats.reduce((n, c) => n + c.highlights.length, 0);
  $('#usage').textContent = `${plural(state.chats.length, 'chat')}, ${plural(total, 'highlight')} · ${used ? fmtBytes(used) + ' of ' + fmtBytes(quota) + ' used' : 'storage use unavailable'}`;
  $('#meter-fill').style.width = Math.min(100, (used / quota) * 100) + '%';
  const last = Number(state.all.lastBackup) || 0;
  $('#last-backup').textContent = last ? 'Last backup: ' + new Date(last).toLocaleString() : 'No backup made yet.';
  $('#t-auto').checked = state.all.autoBackup === true;
  $('#auto-status').textContent =
    state.all.autoBackup === true
      ? state.all.backupError
        ? 'Last attempt failed: ' + state.all.backupError
        : state.all.lastAutoBackup
        ? 'Files are in Downloads/' + BACKUP_DIR + '/ (a "latest" file plus one per weekday). Last written ' + new Date(state.all.lastAutoBackup).toLocaleString() + '.'
        : 'On. The first file is written shortly after your next change.'
      : 'Off. Asks the browser for permission to save files to your Downloads folder.';
  try {
    const m = ext.runtime.getManifest();
    $('#about').textContent = m.name + ' ' + m.version + ' · open source, no analytics, no network requests.';
  } catch (_) {}
}

async function saveCustom(key, hex) {
  const cur = (await sGet('settings')).settings || {};
  const customColors = { ...L.customColors(cur), [key]: hex };
  await sSet({ settings: { ...cur, customColors } });
}
async function addCustom() {
  const cur = (await sGet('settings')).settings || {};
  const have = L.customColors(cur);
  const key = L.CUSTOM_KEYS.find((k) => !have[k]);
  if (!key) return;
  const palette = ['#ff8a3d', '#a78bfa', '#2dd4bf', '#f43f5e'];
  await sSet({ settings: { ...cur, customColors: { ...have, [key]: palette[L.CUSTOM_KEYS.indexOf(key)] } } });
  toast('Colour added. Quick key ' + (5 + L.CUSTOM_KEYS.indexOf(key)));
}
async function removeCustom(key) {
  const cur = (await sGet('settings')).settings || {};
  const customColors = { ...L.customColors(cur) };
  delete customColors[key];
  const colorNames = { ...(cur.colorNames || {}) };
  delete colorNames[key];
  await sSet({ settings: { ...cur, customColors, colorNames } });
  toast('Colour removed. Highlights that used it show as yellow.');
}
async function saveNames() {
  const colorNames = {};
  for (const c of L.colorList(state.all.settings)) {
    const el = $('#name-' + c);
    if (!el) continue;
    const v = el.value.trim();
    if (v) colorNames[c] = v.slice(0, L.MAX_NAME_LEN);
  }
  const cur = (await sGet('settings')).settings || {};
  await sSet({ settings: { ...cur, colorNames } });
  toast('Colour names saved');
}
async function saveSetting(patch) {
  const cur = (await sGet('settings')).settings || {};
  await sSet({ settings: { ...cur, ...patch } });
}

const BACKUP_DIR = 'Tessel backups';
async function setAutoBackup(on) {
  if (on) {
    let ok = false;
    try {
      ok = await ext.permissions.request({ permissions: ['downloads'] });
    } catch (_) {}
    if (!ok) {
      toast('Permission to save files was not granted.');
      return renderAll();
    }
  }
  await sSet({ autoBackup: on, backupError: '' });
  if (on) {
    try {
      await ext.runtime.sendMessage({ type: 'hfc:backup-now' });
    } catch (_) {}
  }
  await reload();
  toast(on ? 'Automatic backups are on' : 'Automatic backups are off');
}

async function backup() {
  await reload();
  const payload = L.buildBackup(state.all);
  download('highlights-backup-' + stamp() + '.json', JSON.stringify(payload, null, 2), 'application/json');
  await sSet({ lastBackup: Date.now() });
  toast('Backup downloaded');
}

async function restore(file) {
  const obj = JSON.parse(await file.text());
  const existing = await sGet(null);
  const { out, added } = L.applyBackup(existing, obj, uid);
  await sSet(out);
  return added;
}

// ---------- routing ----------
function showLibrary() {
  $('#view-library').hidden = false;
  $('#view-settings').hidden = true;
  if (location.hash) history.replaceState(null, '', location.pathname);
  renderAll();
}
function showSettings() {
  $('#view-library').hidden = true;
  $('#view-settings').hidden = false;
  if (location.hash !== '#settings') history.replaceState(null, '', '#settings');
  renderAll();
}
function renderAll() {
  renderRail();
  renderBanner();
  if ($('#view-settings').hidden) renderCards();
  else renderSettings();
}

async function init() {
  try {
    document.title = ext.runtime.getManifest().name + ' · Library';
    $('#brand-name').textContent = ext.runtime.getManifest().name;
  } catch (_) {}
  await reload();

  $('#q').addEventListener('input', (e) => ((state.q = e.target.value), renderCards()));
  $('#sort').addEventListener('change', (e) => ((state.sort = e.target.value), renderCards()));
  $('#btn-export-view').addEventListener('click', exportView);
  $('#go-settings').addEventListener('click', showSettings);
  $('#back').addEventListener('click', showLibrary);
  $('#t-hl').addEventListener('change', (e) => saveSetting({ showHighlights: e.target.checked }));
  $('#t-cm').addEventListener('change', (e) => saveSetting({ showComments: e.target.checked }));
  $('#t-tb').addEventListener('change', (e) => saveSetting({ selectionToolbar: e.target.checked }));
  $('#t-qk').addEventListener('change', (e) => saveSetting({ quickKeys: e.target.checked }));
  $('#color-add').addEventListener('click', addCustom);
  $('#names-reset').addEventListener('click', async () => {
    const cur = (await sGet('settings')).settings || {};
    delete cur.colorNames;
    await sSet({ settings: cur });
    toast('Colour names reset');
  });
  $('#btn-backup').addEventListener('click', backup);
  $('#t-auto').addEventListener('change', (e) => setAutoBackup(e.target.checked));
  $('#btn-restore').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const n = await restore(f);
      toast(n ? `Restored ${plural(n, 'highlight')}` : 'Nothing new to restore');
    } catch (err) {
      toast('Restore failed: ' + (err.message || err));
    }
  });
  $('#btn-export-all').addEventListener('click', () => {
    const chats = L.sortChats(state.chats, 'recent', true);
    if (!chats.length) return toast('Nothing to export.');
    download('highlights-library-' + stamp() + '.md', L.libraryMarkdown(chats, { colorNames: state.names }), 'text/markdown');
  });
  armed($('#btn-wipe'), 'Delete all highlights…', 'Click again to delete everything', async () => {
    const keys = state.chats.map((c) => c.key);
    if (keys.length) await sRemove(keys);
    toast('All highlights deleted');
  });

  ext.storage.onChanged.addListener(async (_changes, area) => {
    if (area !== 'local') return;
    await reload();
    // Don't rebuild the list while someone is typing a tag or a colour name.
    const typing = document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.id !== 'q';
    if (!typing) renderAll();
    else renderRail();
  });

  if (location.hash === '#settings') showSettings();
  else showLibrary();
}

init();
