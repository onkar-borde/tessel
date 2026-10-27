/* Text anchoring helpers.
 *
 * A highlight is stored as a text quote (exact + a little context before/after) rather than DOM
 * positions, so it can be found again after the page re-renders or reloads.
 * Pure DOM logic with no extension APIs, so it is unit-tested with jsdom.
 */
(function (root) {
  'use strict';

  // Editable regions (the prompt box, a message being edited) are transient: never anchor to them.
  const SKIP = 'script,style,noscript,textarea,[contenteditable]:not([contenteditable="false"]),[data-hfc-ui]';
  const CONTEXT = 40;

  // Flatten all visible-ish text nodes under rootEl into one string, remembering where each node starts.
  function buildIndex(rootEl) {
    const doc = rootEl.ownerDocument || rootEl;
    const nodes = [];
    let text = '';
    const walker = doc.createTreeWalker(rootEl, 4 /* SHOW_TEXT */, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || p.closest(SKIP)) return 2; // FILTER_REJECT
        return 1; // FILTER_ACCEPT
      },
    });
    let n;
    while ((n = walker.nextNode())) {
      nodes.push({ node: n, start: text.length });
      text += n.nodeValue;
    }
    return { nodes, text };
  }

  // Turn a DOM Range (the user's selection) into { exact, prefix, suffix }.
  function anchorFromRange(index, range) {
    let s = -1;
    let e = -1;
    for (const { node, start } of index.nodes) {
      if (!range.intersectsNode(node)) continue;
      const len = node.nodeValue.length;
      const a = node === range.startContainer ? range.startOffset : 0;
      const b = node === range.endContainer ? range.endOffset : len;
      if (b <= a) continue;
      if (s < 0) s = start + a;
      e = start + b;
    }
    if (s < 0) return null;
    const t = index.text;
    while (s < e && /\s/.test(t[s])) s++;
    while (e > s && /\s/.test(t[e - 1])) e--;
    if (e <= s) return null;
    return {
      exact: t.slice(s, e),
      prefix: t.slice(Math.max(0, s - CONTEXT), s),
      suffix: t.slice(e, e + CONTEXT),
    };
  }

  function commonSuffix(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
    return i;
  }
  function commonPrefix(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  }

  // Find a stored highlight in the current text. If the quote occurs several times,
  // pick the occurrence whose surrounding context matches best.
  function locate(index, hl) {
    const t = index.text;
    const ex = hl.exact;
    if (!ex) return null;
    const prefix = hl.prefix || '';
    const suffix = hl.suffix || '';
    let best = -1;
    let bestScore = -1;
    let seen = 0;
    let i = -1;
    while ((i = t.indexOf(ex, i + 1)) !== -1 && seen < 500) {
      seen++;
      const pre = t.slice(Math.max(0, i - prefix.length), i);
      const suf = t.slice(i + ex.length, i + ex.length + suffix.length);
      const score = commonSuffix(pre, prefix) + commonPrefix(suf, suffix);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best < 0 ? null : { start: best, end: best + ex.length };
  }

  // Build a live Range covering [start, end) of the indexed text.
  function rangeFromOffsets(index, start, end) {
    let sNode = null;
    let sOff = 0;
    let eNode = null;
    let eOff = 0;
    for (const { node, start: ns } of index.nodes) {
      const ne = ns + node.nodeValue.length;
      if (!sNode && start < ne) {
        sNode = node;
        sOff = start - ns;
      }
      if (sNode && end <= ne) {
        eNode = node;
        eOff = end - ns;
        break;
      }
    }
    if (!sNode || !eNode) return null;
    const r = sNode.ownerDocument.createRange();
    r.setStart(sNode, sOff);
    r.setEnd(eNode, eOff);
    return r;
  }

  // Wrap [start, end) in elements made by make(). Mutates the DOM: only use on a detached clone.
  function wrapOffsets(index, start, end, make) {
    const created = [];
    for (const { node, start: ns } of index.nodes) {
      const ne = ns + node.nodeValue.length;
      if (ne <= start) continue;
      if (ns >= end) break;
      const a = Math.max(start, ns) - ns;
      const b = Math.min(end, ne) - ns;
      if (b <= a) continue;
      let target = node;
      if (a > 0) target = target.splitText(a);
      if (b - a < target.nodeValue.length) target.splitText(b - a);
      const el = make();
      target.parentNode.insertBefore(el, target);
      el.appendChild(target);
      created.push(el);
    }
    return created;
  }

  const api = { buildIndex, anchorFromRange, locate, rangeFromOffsets, wrapOffsets, CONTEXT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HFCAnchor = api;
})(typeof self !== 'undefined' ? self : this);
