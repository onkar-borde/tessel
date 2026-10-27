'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideKey } = require('../lib/keys.js');

const ctx = (over = {}) => ({ quickKeys: true, editable: false, hasSelection: true, navActive: false, ...over });
const key = (k, mods = {}) => ({ key: k, ...mods });

test('1-4 pick a colour while text is selected', () => {
  assert.deepEqual(decideKey(key('1'), ctx()), { type: 'highlight', color: 'yellow' });
  assert.deepEqual(decideKey(key('2'), ctx()), { type: 'highlight', color: 'green' });
  assert.deepEqual(decideKey(key('3'), ctx()), { type: 'highlight', color: 'blue' });
  assert.deepEqual(decideKey(key('4'), ctx()), { type: 'highlight', color: 'pink' });
});

test('H uses the last colour and C opens a comment, in either case', () => {
  assert.deepEqual(decideKey(key('h'), ctx()), { type: 'highlight', color: 'last' });
  assert.deepEqual(decideKey(key('H'), ctx()), { type: 'highlight', color: 'last' });
  assert.deepEqual(decideKey(key('c'), ctx()), { type: 'comment' });
  assert.deepEqual(decideKey(key('C'), ctx()), { type: 'comment' });
});

test('selection keys do nothing without a selection', () => {
  for (const k of ['1', 'h', 'c']) assert.equal(decideKey(key(k), ctx({ hasSelection: false })), null);
});

test('never fires while typing in a text field', () => {
  for (const k of ['1', 'h', 'c', 'Enter']) {
    assert.equal(decideKey(key(k), ctx({ editable: true, navActive: true })), null);
  }
  assert.equal(decideKey(key('ArrowDown', { altKey: true }), ctx({ editable: true })), null);
});

test('never fires with Ctrl, Meta, Shift or Alt held (so browser and site shortcuts keep working)', () => {
  for (const mod of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
    assert.equal(decideKey(key('h', { [mod]: true }), ctx()), null, mod);
    assert.equal(decideKey(key('1', { [mod]: true }), ctx()), null, mod);
  }
});

test('does nothing when quick keys are switched off, or during IME composition', () => {
  assert.equal(decideKey(key('h'), ctx({ quickKeys: false })), null);
  assert.equal(decideKey(key('ArrowDown', { altKey: true }), ctx({ quickKeys: false })), null);
  assert.equal(decideKey(key('h', { isComposing: true }), ctx()), null);
});

test('Alt+Down / Alt+Up step through highlights, with or without a selection; other Alt combos are ignored', () => {
  assert.deepEqual(decideKey(key('ArrowDown', { altKey: true }), ctx({ hasSelection: false })), { type: 'next' });
  assert.deepEqual(decideKey(key('ArrowUp', { altKey: true }), ctx()), { type: 'prev' });
  assert.equal(decideKey(key('ArrowLeft', { altKey: true }), ctx()), null, 'Alt+Left is the browser Back shortcut');
  assert.equal(decideKey(key('ArrowDown', { altKey: true, shiftKey: true }), ctx()), null);
  assert.equal(decideKey(key('ArrowDown'), ctx()), null, 'plain arrows must keep scrolling the page');
});

test('Enter opens the highlight just jumped to, only while that jump is active and nothing is selected', () => {
  assert.deepEqual(decideKey(key('Enter'), ctx({ hasSelection: false, navActive: true })), { type: 'open' });
  assert.equal(decideKey(key('Enter'), ctx({ hasSelection: false, navActive: false })), null);
  assert.equal(decideKey(key('Enter'), ctx({ hasSelection: true, navActive: true })), null);
});

test('inherited object keys are not treated as shortcuts', () => {
  for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(decideKey(key(k), ctx()), null, k);
  }
  assert.equal(decideKey({ key: undefined }, ctx()), null);
});

test('Alt+Shift+L toggles the panel anywhere outside a text box, by key or physical code', () => {
  const ctxNoSel = ctx({ hasSelection: false });
  assert.deepEqual(decideKey(key('L', { altKey: true, shiftKey: true }), ctxNoSel), { type: 'panel' });
  assert.deepEqual(decideKey(key('l', { altKey: true, shiftKey: true }), ctxNoSel), { type: 'panel' });
  assert.deepEqual(decideKey(key('¬', { altKey: true, shiftKey: true, code: 'KeyL' }), ctxNoSel), { type: 'panel' }, 'Mac Option layout');
  assert.equal(decideKey(key('L', { altKey: true, shiftKey: true }), ctx({ editable: true })), null);
  assert.equal(decideKey(key('L', { altKey: true, shiftKey: true }), ctx({ quickKeys: false })), null);
  assert.equal(decideKey(key('L', { altKey: true, shiftKey: true, ctrlKey: true }), ctxNoSel), null);
  assert.equal(decideKey(key('H', { altKey: true, shiftKey: true }), ctxNoSel), null, 'H/C stay browser commands');
  assert.equal(decideKey(key('l', { shiftKey: true }), ctxNoSel), null);
});

test('keys 5-8 pick the custom colours', () => {
  assert.deepEqual(decideKey(key('5'), ctx()), { type: 'highlight', color: 'c1' });
  assert.deepEqual(decideKey(key('8'), ctx()), { type: 'highlight', color: 'c4' });
});
