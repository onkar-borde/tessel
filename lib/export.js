/* Builds a standalone, shareable HTML copy of a chat with highlights and comments baked in.
 *
 * The recipient can switch highlights and comments on/off with two checkboxes. Everything is
 * rebuilt from a sanitised clone of the page, so no scripts, event handlers or app UI leak out.
 * Pure DOM logic with no extension APIs, so it is unit-tested with jsdom.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const A = isNode ? require('./anchor.js') : root.HFCAnchor;
  const S = isNode ? require('./sites.js') : root.HFCSites;

  // Who-said-what labels and extra elements to drop come from the site profile (lib/sites.js) and
  // are passed in as options. Without options the Claude profile applies, as before.
  // If a site changes its markup the export still works; it just loses the labels.
  const DEFAULT_SITE = S.byId('claude');

  const REMOVE =
    'script,style,link,meta,iframe,object,embed,form,button,input,textarea,select,option,video,audio,' +
    'canvas,svg,noscript,template,dialog,nav,[hidden],[aria-hidden="true"],[contenteditable],' +
    '[role="textbox"],[data-hfc-ui]';

  // Everything not listed here is stripped from the exported markup (classes, styles, ids, handlers…).
  const KEEP_ATTRS = new Set([
    'href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'start', 'lang',
    'data-hfc-role', 'data-hl', 'data-comment', 'data-i',
  ]);

  const COLORS = ['yellow', 'green', 'blue', 'pink', 'c1', 'c2', 'c3', 'c4'];

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  const cssStr = (s) => String(s).replace(/[^\w .-]/g, '');
  function trunc(s, n) {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function tagRoles(clone, roles) {
    const tagged = [];
    for (const { role, selectors } of roles) {
      for (const el of clone.querySelectorAll(selectors.join(','))) {
        el.setAttribute('data-hfc-role', role);
        tagged.push([el, role]);
      }
    }
    // Nested matches would print the label twice; keep only the outermost.
    for (const [el, role] of tagged) {
      const p = el.parentElement;
      if (p && p.closest('[data-hfc-role="' + role + '"]')) el.removeAttribute('data-hfc-role');
    }
  }

  function sanitize(clone, extraRemove) {
    const sel = extraRemove && extraRemove.length ? REMOVE + ',' + extraRemove.join(',') : REMOVE;
    for (const n of Array.from(clone.querySelectorAll(sel))) n.remove();
    for (const el of Array.from(clone.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (!KEEP_ATTRS.has(name)) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (name === 'href' || name === 'src') {
          const v = attr.value.trim();
          const ok =
            name === 'href'
              ? /^(https?:|mailto:|#)/i.test(v)
              : /^(https?:|data:image\/(png|jpe?g|gif|webp);)/i.test(v);
          if (!ok) el.removeAttribute(attr.name);
        }
      }
      if (el.tagName === 'A') {
        el.setAttribute('rel', 'noopener noreferrer');
        el.setAttribute('target', '_blank');
      }
    }
  }

  // Plain text of a sanitised clone: block elements become line breaks, list items get a dash,
  // comment badges are skipped.
  const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'PRE', 'BLOCKQUOTE', 'TABLE', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'BR']);
  function plainText(el) {
    let out = '';
    const walk = (n) => {
      if (n.nodeType === 3) {
        out += n.parentElement && n.parentElement.closest('pre') ? n.nodeValue : n.nodeValue.replace(/\s+/g, ' ');
        return;
      }
      if (n.nodeType !== 1) return;
      if (n.tagName === 'SUP' && n.hasAttribute('data-comment')) return;
      const block = BLOCK.has(n.tagName);
      if (block) out += '\n';
      if (n.tagName === 'LI') out += '- ';
      if (n.tagName === 'TD' || n.tagName === 'TH') out += ' | ';
      for (const c of n.childNodes) walk(c);
      if (block) out += '\n';
    };
    walk(el);
    return out.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // The chat as a prompt another assistant can pick up: transcript, then the reader's own marks.
  function buildTranscript(clone, title, list) {
    // The prompt never mentions highlights (the pasted text has none, and the assistant would
    // answer "I see no highlights"). Written notes, if any, are offered as plain context.
    const parts = [
      'Below is an earlier conversation' + (title ? ' ("' + title + '")' : '') + '.' +
        (list.length ? ' My own notes on parts of it are at the end.' : '') +
        ' Please read it and continue helping me from where it left off.',
      '',
      '=== CONVERSATION ===',
    ];
    const msgs = Array.from(clone.querySelectorAll('[data-hfc-role]'));
    if (msgs.length) {
      for (const m of msgs) {
        const label = m.getAttribute('data-hfc-role') === 'user' ? 'Me' : 'Assistant';
        parts.push(label + ':', plainText(m), '');
      }
    } else {
      parts.push(plainText(clone), '');
    }
    if (list.length) {
      parts.push('=== MY NOTES ===');
      for (const it of list) parts.push('- "' + trunc(it.exact.replace(/\s+/g, ' '), 200) + '": ' + it.comment);
      parts.push('');
    }
    return parts.join('\n').slice(0, 200000);
  }

  const CSS_BASE = `
:root{color-scheme:light dark;--bg:#faf9f5;--fg:#1f1e1d;--mut:#6b6862;--bd:#e3dfd6;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#262624;--fg:#ece9e2;--mut:#a09c94;--bd:#44423d;--card:#30302e}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 Georgia,'Times New Roman',serif}
.bar{position:sticky;top:0;z-index:5;display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:10px 20px;background:var(--card);border-bottom:1px solid var(--bd);font:13px system-ui,sans-serif}
.bar h1{font-size:14px;margin:0;flex:1 1 200px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.legend{display:flex;gap:12px;flex-wrap:wrap}
.lg{display:inline-flex;gap:5px;align-items:center}
.lg i{width:12px;height:12px;border-radius:3px;display:inline-block}
.lg i[data-hl="yellow"]{background:rgba(255,213,0,.75)}
.lg i[data-hl="green"]{background:rgba(61,220,132,.7)}
.lg i[data-hl="blue"]{background:rgba(77,163,255,.7)}
.lg i[data-hl="pink"]{background:rgba(255,111,181,.7)}
body.no-hl .legend{display:none}
.bar label{display:flex;gap:6px;align-items:center;cursor:pointer}
main{max-width:760px;margin:0 auto;padding:24px 20px 60px}
main pre{overflow:auto;padding:12px;border:1px solid var(--bd);border-radius:8px;background:var(--card);font:13px/1.5 ui-monospace,Menlo,Consolas,monospace}
main code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em}
main table{border-collapse:collapse;display:block;overflow:auto}
main th,main td{border:1px solid var(--bd);padding:6px 10px}
main blockquote{margin:1em 0;padding-left:14px;border-left:3px solid var(--bd);color:var(--mut)}
main img{max-width:100%}
[data-hfc-role]{margin:20px 0;padding:14px 18px;border-radius:12px;border:1px solid var(--bd)}
[data-hfc-role]::before{display:block;font:600 11px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin-bottom:6px}
[data-hfc-role="user"]{background:var(--card)}
ROLE_LABEL_RULES
mark{color:inherit;border-radius:3px;padding:0 1px}
mark[data-hl="yellow"]{background:rgba(255,213,0,.45)}
mark[data-hl="green"]{background:rgba(61,220,132,.40)}
mark[data-hl="blue"]{background:rgba(77,163,255,.40)}
mark[data-hl="pink"]{background:rgba(255,111,181,.40)}
mark[data-hl="none"]{background:transparent}
body.no-hl mark{background:transparent!important}
sup[data-comment]{position:relative;display:inline-block;min-width:16px;height:16px;padding:0 4px;margin-left:2px;border-radius:8px;background:#c96442;color:#fff;font:600 10px/16px system-ui,sans-serif;text-align:center;cursor:help;vertical-align:super}
sup[data-comment]:hover::after{content:attr(data-comment);position:absolute;left:0;top:100%;z-index:10;width:max-content;max-width:280px;padding:8px 10px;border-radius:8px;background:#1f1e1d;color:#fff;font:400 12.5px/1.45 system-ui,sans-serif;white-space:pre-wrap;text-align:left}
body.no-cm sup[data-comment],body.no-cm aside.comments{display:none}
aside.comments{max-width:760px;margin:0 auto;padding:0 20px 60px;font:14px/1.5 system-ui,sans-serif}
aside.comments h2{font-size:15px}
aside.comments li{margin:0 0 14px}
aside.comments blockquote{margin:0 0 4px;font-size:13px}
aside.comments p{margin:0;white-space:pre-wrap}
main a,aside.comments a{color:inherit;text-decoration:underline dotted;text-underline-offset:3px}
.cont-l{color:var(--mut);font-size:12px;margin-left:auto}
a.go,button.go{text-decoration:none;border:1px solid #c96442;background:#c96442;color:#fff!important;border-radius:999px;padding:5px 14px;font:600 13px system-ui,sans-serif;cursor:pointer;display:inline-block}
a.go:hover,button.go:hover{filter:brightness(1.12)}
.openchat{max-width:760px;margin:0 auto 40px;padding:18px 20px;border:1px solid var(--bd);border-radius:14px;background:var(--card);font:14px/1.5 system-ui,sans-serif;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.openchat p{margin:0;flex:1;min-width:220px;color:var(--mut)}
.openchat a.go{font-size:14px;padding:9px 20px}
#go-msg{color:var(--mut)}
footer{text-align:center;color:var(--mut);font:12px system-ui,sans-serif;padding:0 0 32px}
`;

  const TOGGLE_JS =
    "(function(){var b=document.body;[['t-hl','no-hl'],['t-cm','no-cm']].forEach(function(p){" +
    "var el=document.getElementById(p[0]);if(!el)return;" +
    "el.addEventListener('change',function(){b.classList.toggle(p[1],!el.checked);});});})();";

  // "Continue in ..." buttons: copy the transcript, then open the assistant's new-chat page with as
  // much of it as fits in the address (the clipboard copy covers the rest). Runs only on click.
  const CONTINUE_JS =
    "(function(){var el=document.getElementById('hfc-transcript');if(!el)return;var txt=JSON.parse(el.textContent);var msg=document.getElementById('go-msg');" +
    "function copy(){try{var a=document.createElement('textarea');a.value=txt;a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();document.execCommand('copy');a.remove();}catch(e){}" +
    "try{navigator.clipboard.writeText(txt);}catch(e){}}" +
    "document.querySelectorAll('button[data-go]').forEach(function(b){b.addEventListener('click',function(){copy();" +
    "var small=txt.length<=6000;var q=small?txt:'An earlier conversation is on my clipboard. I will paste it below this line.\\n\\n';" +
    "window.open(b.getAttribute('data-go')+encodeURIComponent(q),'_blank','noopener');" +
    "msg.textContent=small?'Opened. The text is also copied, in case it did not fill in.':'Copied. Paste it (Ctrl/Cmd+V) into the new chat.';});});})();";

  /**
   * @param {object} opts
   * @param {Element} opts.rootEl         element holding the conversation (cloned, never modified)
   * @param {string}  opts.title
   * @param {Array}   opts.highlights     [{ exact, prefix, suffix, color, comment }]
   * @param {boolean} [opts.includeHighlights=true]
   * @param {boolean} [opts.includeComments=true]
   * @param {Array}   [opts.roles]        [{ role, label, selectors }]  default: Claude's
   * @param {string[]} [opts.remove]      extra selectors to drop from the export
   * @param {object}  [opts.colorNames]   { yellow, green, blue, pink } custom colour names for the legend
   * @param {Date}    [opts.exportedAt]
   * @returns {{ html: string, applied: number, missing: number }}
   */
  function buildExportHtml(opts) {
    const { rootEl, highlights = [], includeHighlights = true, includeComments = true } = opts;
    const title = opts.title || 'Chat';
    const roles = opts.roles || DEFAULT_SITE.roles;
    const css = CSS_BASE.replace(
      'ROLE_LABEL_RULES',
      roles.map((r) => '[data-hfc-role="' + r.role + '"]::before{content:"' + cssStr(r.label) + '"}').join('\n')
    );
    const cc = {};
    for (const k of ['c1', 'c2', 'c3', 'c4']) {
      const v = opts.customColors && opts.customColors[k];
      if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) cc[k] = v;
    }
    const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255); };
    const customCss = Object.keys(cc)
      .map((k) => 'mark[data-hl="' + k + '"]{background:rgba(' + rgbOf(cc[k]) + ',.42)}.lg i[data-hl="' + k + '"]{background:rgba(' + rgbOf(cc[k]) + ',.8)}')
      .join('');
    const date = (opts.exportedAt || new Date()).toISOString().slice(0, 10);

    const clone = rootEl.cloneNode(true);
    const doc = clone.ownerDocument;
    tagRoles(clone, roles);

    // Highlights are applied before sanitising so the clone's text matches the live page exactly.
    const pending = [];
    const used = new Set();
    let applied = 0;
    let missing = 0;
    for (const hl of highlights) {
      const wantComment = Boolean(includeComments && hl.comment);
      if (!includeHighlights && !wantComment) continue;
      const index = A.buildIndex(clone);
      const loc = A.locate(index, hl);
      if (!loc) {
        missing++;
        continue;
      }
      const color = COLORS.includes(hl.color) && (hl.color.length > 2 || cc[hl.color]) ? hl.color : 'yellow';
      const marks = A.wrapOffsets(index, loc.start, loc.end, () => {
        const m = doc.createElement('mark');
        m.setAttribute('data-hl', includeHighlights ? color : 'none');
        return m;
      });
      if (!marks.length) {
        missing++;
        continue;
      }
      applied++;
      if (includeHighlights) used.add(color);
      if (wantComment) {
        const sup = doc.createElement('sup');
        sup.setAttribute('data-i', String(pending.length));
        sup.setAttribute('data-comment', hl.comment);
        pending.push({ exact: hl.exact, comment: hl.comment });
        marks[marks.length - 1].after(sup);
      }
    }

    sanitize(clone, opts.remove);

    // Number comments in reading order (not creation order).
    const list = [];
    Array.from(clone.querySelectorAll('sup[data-i]')).forEach((sup, idx) => {
      const p = pending[Number(sup.getAttribute('data-i'))];
      sup.textContent = String(idx + 1);
      sup.removeAttribute('data-i');
      list.push({ n: idx + 1, exact: p.exact, comment: p.comment });
    });

    const bodyHtml = clone.innerHTML;
    const aside = list.length
      ? '<aside class="comments"><h2>Comments</h2><ol>' +
        list
          .map(
            (it) =>
              '<li value="' + it.n + '"><blockquote>' + esc(trunc(it.exact, 240)) + '</blockquote><p>' +
              esc(it.comment) + '</p></li>'
          )
          .join('') +
        '</ol></aside>'
      : '';

    // A legend only for colours that carry a custom name; "Yellow" next to yellow says nothing.
    const names = opts.colorNames || {};
    const legend = includeHighlights
      ? COLORS.filter((c) => used.has(c) && names[c] && names[c].toLowerCase() !== c)
          .map((c) => '<span class="lg"><i data-hl="' + c + '"></i>' + esc(names[c]) + '</span>')
          .join('')
      : '';

    // A link to the chat on the site itself, if the sender pasted one (see matchShareUrl).
    const share = opts.shareUrl ? S.matchShareUrl(opts.shareUrl) : null;
    const shareLink = share
      ? '<div class="openchat"><p><b>Open this chat on ' + esc(share.site.name) + '.</b> It opens the original conversation on ' + esc(share.site.name) + ', exactly as if its share link had been sent to you, so you can continue from there.</p><a class="go" href="' + esc(share.url) + '" target="_blank" rel="noopener noreferrer">Open on ' + esc(share.site.name) + '</a></div>'
      : '';
    const withContinue = opts.continueIn !== false;
    const transcript = withContinue ? buildTranscript(clone, title, list) : '';
    const goButtons = withContinue
      ? '<span class="cont-l">Paste into a new chat:</span><button class="go" type="button" data-go="https://claude.ai/new?q=">Continue in Claude</button>' +
        '<button class="go" type="button" data-go="https://chatgpt.com/?q=">Continue in ChatGPT</button><span id="go-msg"></span>'
      : '';
    const toggles =
      (includeHighlights ? '<label><input type="checkbox" id="t-hl" checked> Highlights</label>' : '') +
      (list.length ? '<label><input type="checkbox" id="t-cm" checked> Comments</label>' : '');

    const html =
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="robots" content="noindex">' +
      '<title>' + esc(title) + '</title><style>' + css + customCss + '</style></head><body>' +
      '<div class="bar"><h1>' + esc(title) + '</h1>' + (legend ? '<div class="legend">' + legend + '</div>' : '') + toggles + goButtons + '</div>' +
      '<main>' + bodyHtml + '</main>' + aside + shareLink +
      '<footer>Exported ' + esc(date) + ' with Tessel</footer>' +
      (toggles ? '<script>' + TOGGLE_JS + '</script>' : '') +
      (withContinue
        ? '<script type="application/json" id="hfc-transcript">' + JSON.stringify(transcript).replace(/</g, '\\u003c') + '</script><script>' + CONTINUE_JS + '</script>'
        : '') +
      '</body></html>';

    return { html, applied, missing, transcript };
  }

  const api = { buildExportHtml, sanitize, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HFCExport = api;
})(typeof self !== 'undefined' ? self : this);
