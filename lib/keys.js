/* Keyboard shortcut decisions.
 *
 * Given a key event and a little context, say what the extension should do (or nothing).
 * Pure function, no DOM or extension APIs, so every rule is unit-tested.
 *
 * With text selected in the conversation (no modifiers held):
 *   1 2 3 4   highlight in yellow / green / blue / pink (5 6 7 8: your custom colours, if defined)
 *   H         highlight in the colour you used last
 *   C         highlight and open the comment box
 * Anywhere outside a text field:
 *   Alt+Down / Alt+Up   jump to the next / previous highlight
 *   Enter               open the highlight you just jumped to
 *   Alt+Shift+L         show / hide the highlights panel
 */
(function (root) {
  'use strict';

  const COLOR_KEYS = { 1: 'yellow', 2: 'green', 3: 'blue', 4: 'pink', 5: 'c1', 6: 'c2', 7: 'c3', 8: 'c4' };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /**
   * @param {{key:string, code?:string, ctrlKey?:boolean, metaKey?:boolean, altKey?:boolean, shiftKey?:boolean, isComposing?:boolean}} e
   * @param {{quickKeys:boolean, editable:boolean, hasSelection:boolean, navActive:boolean}} ctx
   * @returns {null | {type:'highlight', color:string} | {type:'comment'} | {type:'next'} | {type:'prev'} | {type:'open'} | {type:'panel'}}
   */
  function decideKey(e, ctx) {
    if (!ctx.quickKeys || e.isComposing || ctx.editable) return null;
    const key = e.key;
    if (typeof key !== 'string') return null;

    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // `code` is layout- and Option-key-proof (on Mac, Option+L types a different character).
      return e.code === 'KeyL' || key.toLowerCase() === 'l' ? { type: 'panel' } : null;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (key === 'ArrowDown') return { type: 'next' };
      if (key === 'ArrowUp') return { type: 'prev' };
      return null;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;

    if (ctx.hasSelection) {
      if (has(COLOR_KEYS, key)) return { type: 'highlight', color: COLOR_KEYS[key] };
      const k = key.length === 1 ? key.toLowerCase() : key;
      if (k === 'h') return { type: 'highlight', color: 'last' };
      if (k === 'c') return { type: 'comment' };
      return null;
    }
    if (ctx.navActive && key === 'Enter') return { type: 'open' };
    return null;
  }

  const api = { decideKey, COLOR_KEYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HFCKeys = api;
})(typeof self !== 'undefined' ? self : this);
