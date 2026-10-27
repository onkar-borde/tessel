/* Site profiles: everything that differs between the chat sites the extension supports.
 *
 * The rest of the code is site-agnostic. It asks the profile for the chat ID in a URL, where the
 * conversation lives, how to label who said what in an export, and which storage key to use.
 * The right profile is picked from the page's hostname, so on any other site nothing runs.
 *
 * To support another site, add a profile below, then list its host in manifest.json
 * (host_permissions and content_scripts.matches) and in background.js. A unit test fails if the
 * three lists disagree.
 *
 * Pure data and functions with no DOM or extension APIs, so it is unit-tested.
 */
(function (root) {
  'use strict';

  const ID = '[0-9a-zA-Z-]{8,}';
  const ID_ONLY = new RegExp('^' + ID + '$');
  const pathId = (re) => (path) => {
    const m = String(path).match(re);
    return m ? m[1] : null;
  };

  const PROFILES = [
    {
      id: 'claude',
      name: 'Claude',
      hosts: ['claude.ai'],
      // Unchanged since v0.1, so highlights saved by earlier versions keep working.
      keyPrefix: 'chat:',
      // Where the conversation lives (also the area the export is cut from).
      rootSelectors: ['main'],
      // Stripped from document.title to get the chat's own title.
      titleSuffix: /\s*[-–|]\s*Claude\s*$/i,
      chatIdFromPath: pathId(new RegExp('/chat/(' + ID + ')')),
      chatUrl: (id) => 'https://claude.ai/chat/' + id,
      // New-chat page that accepts a prefilled prompt in ?q=.
      newChat: 'https://claude.ai/new?q=',
      // Best-effort guesses at the site's markup, used only to label who said what in an export.
      roles: [
        { role: 'user', label: 'You', selectors: ['[data-testid="user-message"]'] },
        { role: 'claude', label: 'Claude', selectors: ['.font-claude-response', '[data-is-streaming]'] },
      ],
      // Extra elements to drop from an export (visually hidden labels and the like).
      exportRemove: [],
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      hosts: ['chatgpt.com'],
      keyPrefix: 'gpt:',
      rootSelectors: ['main'],
      titleSuffix: /\s*[-–|]\s*ChatGPT\s*$/i,
      // /c/<id>, /g/<gpt>/c/<id> and project chats /g/g-p-<id>/c/<id> all end in /c/<id>;
      // chats of signed-out visitors live under /uc/<id>.
      chatIdFromPath: pathId(new RegExp('/(?:c|uc)/(' + ID + ')')),
      // The address bar is not a reliable source: after a message is sent into a new chat the app
      // updates it seconds later (or not at all until a reload). The page itself names the chat.
      chatIdFromPage: (rootEl) => {
        const el = rootEl.querySelector('[data-conversation-id]');
        const v = el && el.getAttribute('data-conversation-id');
        return v && ID_ONLY.test(v) ? v : null;
      },
      chatUrl: (id) => 'https://chatgpt.com/c/' + id,
      newChat: 'https://chatgpt.com/?q=',
      // ChatGPT has shipped two message formats; both are recognised.
      roles: [
        { role: 'user', label: 'You', selectors: ['[data-message-author-role="user"]', '[data-message-role="user"]'] },
        { role: 'chatgpt', label: 'ChatGPT', selectors: ['[data-message-author-role="assistant"]', '[data-message-role="assistant"]'] },
      ],
      // Each turn carries a screen-reader-only "You said:" / "ChatGPT said:" heading that would
      // show up as stray text once the stylesheet is gone.
      exportRemove: ['.sr-only'],
    },
  ];

  const ID_RE = new RegExp('^' + ID + '$');

  // Exact hostname match only: no suffix tricks ("claude.ai.example.com", "notchatgpt.com").
  function detect(hostname) {
    const h = String(hostname || '').toLowerCase();
    return PROFILES.find((p) => p.hosts.includes(h)) || null;
  }

  // A tab URL -> { site, id } when it is a chat page of a supported site, else null.
  function matchUrl(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return null;
      const site = detect(u.hostname);
      const id = site && site.chatIdFromPath(u.pathname);
      return id ? { site, id } : null;
    } catch (_) {
      return null;
    }
  }

  // A storage key ('chat:<id>', 'gpt:<id>') -> { site, id }, else null.
  function matchKey(key) {
    if (typeof key !== 'string') return null;
    for (const site of PROFILES) {
      if (key.startsWith(site.keyPrefix)) {
        const id = key.slice(site.keyPrefix.length);
        if (ID_RE.test(id)) return { site, id };
      }
    }
    return null;
  }

  // A link the user pasted for a chat they shared on the site itself (its Share button): https, on
  // a supported host, a real path, no credentials, no oddities. Returns { site, url } or null.
  function matchShareUrl(raw) {
    try {
      const u = new URL(String(raw || '').trim());
      const site = detect(u.hostname);
      if (!site || u.protocol !== 'https:' || u.username || u.password || u.port) return null;
      if (u.pathname.length < 3 || String(raw).length > 300) return null;
      u.hash = '';
      return { site, url: u.toString() };
    } catch (_) {
      return null;
    }
  }

  const byId = (id) => PROFILES.find((p) => p.id === id) || null;

  const api = { PROFILES, detect, matchUrl, matchKey, matchShareUrl, byId, ID_RE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HFCSites = api;
})(typeof self !== 'undefined' ? self : this);
