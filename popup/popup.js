'use strict';

const { ext, $, h, plural, excerpt, dot, sitePill, relTime, makeToast, download, sGet, sSet, sRemove, patchChat, openChat, syncCustomColors } = self.HFCUI;
const S = self.HFCSites;
const L = self.HFCLibrary;

const state = {
  tab: null,
  site: null, // profile of the chat in the active tab (a chat page with an id)
  host: null, // profile of the site the tab is on, chat page or not
  chatId: null,
  data: null,
  order: null, // highlight ids in reading order, or null if the page can't be reached
  status: null,
  reachable: false,
  color: null,
  q: '',
  allQ: '',
  platform: 'all',
  names: L.colorNames(),
  settings: { showHighlights: true, showComments: true, selectionToolbar: true, quickKeys: true },
};
const toast = makeToast($('#toast'));
const chatKey = () => state.site.keyPrefix + state.chatId;
const pageTitle = () => (state.tab && state.tab.title ? state.tab.title.replace(state.site ? state.site.titleSuffix : /$^/, '').trim() : '');

function sortedHighlights() {
  const hls = (state.data && state.data.highlights) || [];
  const pos = new Map((state.order || []).map((id, i) => [id, i]));
  return [...hls].sort((a, b) => {
    const pa = pos.has(a.id) ? pos.get(a.id) : Infinity;
    const pb = pos.has(b.id) ? pos.get(b.id) : Infinity;
    return pa !== pb ? pa - pb : (a.created || 0) - (b.created || 0);
  });
}
const thisChat = () => (state.data ? L.chatsFrom({ [chatKey()]: state.data })[0] : null);
const openUrl = (url) => ext.tabs.create({ url });

// ---------- views ----------
function showView(name) {
  for (const v of ['chat', 'all']) $('#view-' + v).hidden = name !== v;
  $('#settings').hidden = name !== 'settings';
  $('#tab-chat').classList.toggle('active', name === 'chat');
  $('#tab-all').classList.toggle('active', name === 'all');
  $('#btn-gear').setAttribute('aria-expanded', String(name === 'settings'));
  if (name === 'all') renderAll();
  else if (name === 'chat') renderChat();
  else renderDiag();
}
const currentView = () => (!$('#settings').hidden ? 'settings' : !$('#view-all').hidden ? 'all' : 'chat');

// ---------- the page this popup was opened on ----------
async function refreshChat() {
  state.data = null;
  state.order = null;
  state.status = null;
  state.reachable = false;
  // Ask the page which chat it is showing: the address bar can lag behind (a new chat only gets
  // its address seconds later, or after a reload), the page cannot.
  if (state.host && state.tab) {
    try {
      const r = await ext.tabs.sendMessage(state.tab.id, { type: 'hfc:status' });
      if (r && r.ok) {
        state.status = r;
        state.order = r.order;
        state.reachable = true;
        state.chatId = r.chatId || null;
        state.site = r.chatId ? state.host : null;
      }
    } catch (_) {
      /* the content script is not running in this tab: fall back to what the address says */
    }
  }
  if (state.site) state.data = (await sGet(chatKey()))[chatKey()] || null;
}

function renderContext() {
  const c = $('#ctx');
  c.textContent = '';
  if (state.site) {
    const chat = thisChat();
    const n = chat ? chat.highlights.length : 0;
    const comments = chat ? L.commentCount(chat) : 0;
    const star = chat
      ? h('button', {
          class: 'star',
          type: 'button',
          'aria-pressed': String(chat.starred),
          title: chat.starred ? 'Unstar this chat' : 'Star this chat',
          'aria-label': 'Star',
          text: chat.starred ? '★' : '☆',
          onclick: () => patchChat(chatKey(), (r) => (r.starred = !r.starred)),
        })
      : null;
    c.append(
      h('div', { class: 'row' }, [sitePill(state.site), star]),
      h('div', { class: 'ttl', title: pageTitle(), text: (state.data && state.data.title) || pageTitle() || 'This chat' }),
      h('div', {
        class: 'sub',
        text: n ? plural(n, 'highlight') + (comments ? ' · ' + plural(comments, 'comment') : '') : 'No highlights yet',
      })
    );
  } else if (state.host) {
    const unsaved = (state.status && state.status.unsaved) || 0;
    c.append(
      h('div', { class: 'row' }, [sitePill(state.host)]),
      h('div', { class: 'ttl', text: unsaved ? 'New chat' : 'New chat or no chat open' }),
      h('div', {
        class: 'sub',
        text: unsaved
          ? plural(unsaved, 'highlight') + ' here. They are filed under this chat as soon as the site names it.'
          : 'Select text in the conversation to highlight it. A new chat is saved once the site gives it an address.',
      })
    );
  } else {
    c.append(
      h('div', { class: 'ttl', text: 'Not on a chat page' }),
      h('div', { class: 'sub', text: 'Open a chat on Claude or ChatGPT to highlight it.' }),
      h(
        'div',
        { class: 'links' },
        S.PROFILES.map((p) => h('button', { class: 'btn small', type: 'button', text: 'Open ' + p.hosts[0], onclick: () => openUrl('https://' + p.hosts[0] + '/') }))
      )
    );
  }
}

// ---------- this chat ----------
function setNote(msg) {
  const n = $('#chat-note');
  n.textContent = msg || '';
  n.hidden = !msg;
}

function renderChat() {
  renderContext();
  const list = $('#list');
  const chips = $('#chips');
  list.textContent = '';
  chips.textContent = '';
  const live = Boolean(state.site);
  $('#q').disabled = !live;
  $('#btn-export').disabled = !live;
  $('#btn-md').disabled = !live;
  for (const id of ['go-claude', 'go-chatgpt', 'share-save', 'share-clear']) $('#' + id).disabled = !state.reachable;
  if (document.activeElement !== $('#share-url')) $('#share-url').value = (state.data && state.data.shareUrl) || '';
  $('#btn-panel').disabled = !state.reachable;

  if (!state.site) {
    setNote(state.host ? '' : 'Pick a chat in the All chats tab, or open one.');
    $('#btn-export').textContent = 'Export HTML';
    return;
  }
  setNote(state.reachable ? '' : 'Reload this ' + state.site.name + ' tab to activate the highlighter. Saved highlights are listed below.');

  const all = sortedHighlights();
  const present = (state.colorKeys || L.COLOR_KEYS).filter((c) => all.some((x) => x.color === c));
  if (state.color && !present.includes(state.color)) state.color = null;
  if (present.length > 1) {
    for (const c of [null, ...present]) {
      chips.append(
        h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.color === c), onclick: () => ((state.color = c), renderChat()) }, [
          c ? dot(c) : null,
          c ? state.names[c] : 'All',
        ])
      );
    }
  }
  $('#btn-export').textContent = state.color ? 'Export ' + state.names[state.color] : 'Export HTML';

  const q = state.q.toLowerCase();
  const shown = all.filter((x) => (!state.color || x.color === state.color) && (!q || (x.exact + ' ' + (x.comment || '')).toLowerCase().includes(q)));
  if (!all.length) {
    list.append(h('li', { class: 'empty', text: 'No highlights yet. Select text in the chat, then press 1–4 (or C to add a comment).' }));
    return;
  }
  if (!shown.length) {
    list.append(h('li', { class: 'empty', text: 'Nothing matches.' }));
    return;
  }
  for (const x of shown) {
    const missing = state.order && !state.order.includes(x.id);
    const del = h('button', { class: 'btn small danger', type: 'button', text: 'Delete' });
    del.addEventListener('click', () => {
      if (!del.dataset.armed) {
        del.dataset.armed = '1';
        del.setAttribute('data-armed', '');
        del.textContent = 'Confirm?';
        setTimeout(() => {
          delete del.dataset.armed;
          del.removeAttribute('data-armed');
          del.textContent = 'Delete';
        }, 3000);
        return;
      }
      deleteHighlight(x.id);
    });
    list.append(
      h('li', { class: 'item' }, [
        dot(x.color),
        h('div', { class: 'body' }, [
          h('div', { class: 'quote', text: x.exact }),
          x.comment ? h('div', { class: 'comment', text: x.comment }) : null,
          missing ? h('div', { class: 'warn', text: 'Not found in the page right now' }) : null,
        ]),
        h('div', { class: 'btns' }, [
          h('button', { class: 'btn small', type: 'button', text: 'Jump', onclick: () => jump(x.id) }),
          h('button', { class: 'btn small', type: 'button', text: 'Copy', onclick: () => copyQuote(x) }),
          del,
        ]),
      ])
    );
  }
}

async function jump(id) {
  try {
    const r = await ext.tabs.sendMessage(state.tab.id, { type: 'hfc:jump', id });
    if (!r || !r.ok) toast("Couldn't find that text on the page.");
  } catch (_) {
    toast('Reload the ' + state.site.name + ' tab first.');
  }
}

async function copy(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch (_) {
    toast("Couldn't copy to the clipboard.");
  }
}
const copyQuote = (x) => copy(L.quoteMarkdown(x, thisChat()), 'Copied as a Markdown quote');

async function deleteHighlight(id) {
  const cur = await patchChat(chatKey(), (c) => {
    c.highlights = c.highlights.filter((x) => x.id !== id);
    c.updated = Date.now();
  });
  if (cur && !cur.highlights.length && !cur.starred && !(cur.tags && cur.tags.length)) await sRemove(chatKey());
  await refreshChat();
  renderChat();
}

async function exportHtml() {
  try {
    const r = await ext.tabs.sendMessage(state.tab.id, {
      type: 'hfc:export',
      opts: { highlights: $('#x-hl').checked, comments: $('#x-cm').checked, colors: state.color ? [state.color] : undefined },
    });
    if (!r || !r.ok) throw new Error((r && r.error) || 'no response');
    download(r.filename, r.html, 'text/html');
    toast(r.missing ? `Exported. ${plural(r.missing, 'highlight')} not found on the page were skipped.` : 'Exported. Open the file to check it before sharing.');
  } catch (e) {
    toast('Export failed: ' + (e.message || e) + ' (reload the tab?)');
  }
}

// Copies the chat as a prompt, then opens the other platform's new-chat page with as much of it
// as fits in the address (the clipboard has all of it).
async function continueIn(siteId) {
  const target = S.byId(siteId);
  try {
    const r = await ext.tabs.sendMessage(state.tab.id, { type: 'hfc:transcript' });
    if (!r || !r.ok || !r.transcript) throw new Error((r && r.error) || 'no response');
    const small = r.transcript.length <= 6000;
    const q = small ? r.transcript : 'An earlier conversation is on my clipboard. I will paste it below this line.\n\n';
    try {
      await navigator.clipboard.writeText(r.transcript);
    } catch (_) {}
    await ext.tabs.create({ url: target.newChat + encodeURIComponent(q) });
    toast(small ? 'Opened ' + target.name + '. The text is also copied.' : 'Copied. Paste it into the new ' + target.name + ' chat.');
  } catch (e) {
    toast("Couldn't read the chat: " + (e.message || e) + ' (reload the tab?)');
  }
}

async function saveShare(clear) {
  try {
    const r = await ext.tabs.sendMessage(state.tab.id, { type: 'hfc:share', url: clear ? '' : $('#share-url').value });
    if (!r || !r.ok) throw new Error((r && r.error) || 'no response');
    $('#share-url').value = r.url;
    toast(r.url ? 'Link saved. It will be added to exports.' : 'Link removed.');
  } catch (e) {
    toast(String(e.message || e));
  }
}

function copyMarkdown() {
  const chat = thisChat();
  if (!chat || !chat.highlights.length) return toast('Nothing to copy yet.');
  const hls = sortedHighlights().filter((x) => !state.color || x.color === state.color);
  copy(L.chatMarkdown(chat, { colorNames: state.names, highlights: hls }), 'Copied as Markdown');
}

async function togglePanel() {
  try {
    await ext.tabs.sendMessage(state.tab.id, { type: 'hfc:panel' });
    window.close();
  } catch (_) {
    toast('Reload the tab first.');
  }
}

// ---------- all chats ----------
async function renderAll() {
  const all = await sGet(null);
  const chats = L.chatsFrom(all);
  const { counts } = L.counts(chats);

  const seg = $('#seg');
  seg.textContent = '';
  const tabs = [['all', 'All'], ...S.PROFILES.map((p) => [p.id, p.name])];
  for (const [id, label] of tabs) {
    seg.append(h('button', { type: 'button', 'aria-pressed': String(state.platform === id), onclick: () => ((state.platform = id), renderAll()), text: label + ' ' + counts[id] }));
  }

  const res = L.filterChats(chats, { platform: state.platform, q: state.allQ });
  const byKey = new Map(res.map((r) => [r.chat.key, r.matches]));
  const ordered = L.sortChats(
    res.map((r) => r.chat),
    'recent'
  );

  const root = $('#all-list');
  root.textContent = '';
  if (!chats.length) {
    root.append(h('li', { class: 'empty', text: 'No highlights saved yet.' }));
    return;
  }
  if (!ordered.length) {
    root.append(h('li', { class: 'empty', text: 'Nothing matches.' }));
    return;
  }
  const q = state.allQ.trim();
  for (const c of ordered) {
    const matches = q ? byKey.get(c.key) || [] : [];
    root.append(
      h('li', { class: 'chat' }, [
        h('div', { class: 'chat-head' }, [
          h('button', {
            class: 'star',
            type: 'button',
            'aria-pressed': String(c.starred),
            'aria-label': 'Star',
            title: c.starred ? 'Unstar' : 'Star',
            text: c.starred ? '★' : '☆',
            onclick: () => patchChat(c.key, (r) => (r.starred = !r.starred)),
          }),
          h('button', { class: 'chat-open', type: 'button', onclick: () => openChat(c.site, c.id) }, [
            h('div', { class: 'ct', text: c.title || 'Untitled chat' }),
            h('div', { class: 'cm' }, [
              sitePill(c.site),
              h('span', { text: plural(c.highlights.length, 'highlight') + (c.updated ? ' · ' + relTime(c.updated) : '') }),
              ...c.tags.slice(0, 3).map((t) => h('span', { text: '#' + t })),
            ]),
          ]),
        ]),
        ...matches.slice(0, 4).map((m) =>
          h('button', { class: 'match', type: 'button', onclick: () => openChat(c.site, c.id, m.id) }, [dot(m.color), h('span', { text: excerpt(m.exact, 90) })])
        ),
      ])
    );
  }
}

// ---------- settings & diagnostics ----------
async function saveSetting(patch) {
  state.settings = { ...state.settings, ...patch };
  const cur = (await sGet('settings')).settings || {};
  await sSet({ settings: { ...cur, ...state.settings } }); // keeps colour names set in the Library
}

function renderDiag() {
  const out = $('#diag-out');
  out.textContent = state.status
    ? JSON.stringify(state.status.diag, null, 2)
    : state.host
      ? 'The page did not answer. Reload the tab and open this again.'
      : 'Open a Claude or ChatGPT tab first.';
}

// ---------- start ----------
async function init() {
  try {
    $('#brand-name').textContent = ext.runtime.getManifest().name;
  } catch (_) {}
  const stored = await sGet('settings');
  state.settings = { ...state.settings, ...(stored.settings || {}) };
  state.names = L.colorNames(stored.settings);
  state.colorKeys = L.colorList(stored.settings);
  syncCustomColors(stored.settings);
  $('#t-hl').checked = state.settings.showHighlights;
  $('#t-cm').checked = state.settings.showComments;
  $('#t-tb').checked = state.settings.selectionToolbar;
  $('#t-qk').checked = state.settings.quickKeys;

  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  state.tab = tab || null;
  const url = (tab && tab.url) || '';
  const m = S.matchUrl(url);
  state.site = m ? m.site : null;
  state.chatId = m ? m.id : null;
  try {
    const u = new URL(url);
    state.host = u.protocol === 'https:' ? S.detect(u.hostname) : null;
  } catch (_) {
    state.host = null;
  }

  $('#tab-chat').addEventListener('click', () => showView('chat'));
  $('#tab-all').addEventListener('click', () => showView('all'));
  $('#btn-gear').addEventListener('click', () => showView(currentView() === 'settings' ? 'chat' : 'settings'));
  const library = () => openUrl(ext.runtime.getURL('library/library.html'));
  $('#btn-library').addEventListener('click', library);
  $('#lnk-library').addEventListener('click', (e) => (e.preventDefault(), library()));
  $('#t-hl').addEventListener('change', (e) => saveSetting({ showHighlights: e.target.checked }));
  $('#t-cm').addEventListener('change', (e) => saveSetting({ showComments: e.target.checked }));
  $('#t-tb').addEventListener('change', (e) => saveSetting({ selectionToolbar: e.target.checked }));
  $('#t-qk').addEventListener('change', (e) => saveSetting({ quickKeys: e.target.checked }));
  $('#q').addEventListener('input', (e) => ((state.q = e.target.value), renderChat()));
  $('#allq').addEventListener('input', (e) => ((state.allQ = e.target.value), renderAll()));
  $('#btn-export').addEventListener('click', exportHtml);
  $('#go-claude').addEventListener('click', () => continueIn('claude'));
  $('#go-chatgpt').addEventListener('click', () => continueIn('chatgpt'));
  $('#share-save').addEventListener('click', () => saveShare(false));
  $('#share-clear').addEventListener('click', () => saveShare(true));
  $('#btn-md').addEventListener('click', copyMarkdown);
  $('#btn-panel').addEventListener('click', togglePanel);
  $('#btn-diag').addEventListener('click', () => copy($('#diag-out').textContent, 'Diagnostics copied'));

  ext.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) {
      state.names = L.colorNames(changes.settings.newValue);
      state.colorKeys = L.colorList(changes.settings.newValue);
      syncCustomColors(changes.settings.newValue);
    }
    if (state.site && changes[chatKey()]) await refreshChat();
    const v = currentView();
    if (v === 'all') renderAll();
    else if (v === 'chat') renderChat();
  });

  await refreshChat();
  showView(state.host || state.site ? 'chat' : 'all');
}

init();
