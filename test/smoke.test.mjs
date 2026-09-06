// Zero-dependency smoke tests. Run against the built ESM bundle in Node, where there is no
// `window` — which doubles as the SSR-safety test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import keyboardInset, {
  EVENT_NAME,
  computeInset,
  destroy,
  getState,
  init,
  isEditableElement,
  isSupported,
  subscribe,
} from '../dist/index.js';

test('SSR: importing without a window throws nothing and reports unsupported', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(isSupported(), false);
});

test('SSR: getState() returns the inert server snapshot', () => {
  assert.deepEqual(getState(), {
    open: false,
    height: 0,
    viewportHeight: 0,
    source: 'none',
  });
});

test('SSR: init() is a no-op that still returns a working disposer', () => {
  const dispose = init();
  assert.equal(typeof dispose, 'function');
  assert.doesNotThrow(() => dispose());
  assert.doesNotThrow(() => destroy());
  assert.equal(getState().open, false);
});

test('SSR: subscribe() returns an unsubscribe function and never fires off-DOM', () => {
  let calls = 0;
  const unsubscribe = subscribe(() => {
    calls += 1;
  });
  assert.equal(typeof unsubscribe, 'function');
  init()();
  destroy();
  unsubscribe();
  assert.equal(calls, 0);
});

test('API surface: every documented export exists with the right type', () => {
  assert.equal(typeof init, 'function');
  assert.equal(typeof destroy, 'function');
  assert.equal(typeof getState, 'function');
  assert.equal(typeof subscribe, 'function');
  assert.equal(typeof isSupported, 'function');
  assert.equal(typeof isEditableElement, 'function');
  assert.equal(typeof computeInset, 'function');
  assert.equal(EVENT_NAME, 'keyboardinset');
});

test('API surface: the default export mirrors the named exports', () => {
  assert.equal(keyboardInset.init, init);
  assert.equal(keyboardInset.destroy, destroy);
  assert.equal(keyboardInset.getState, getState);
  assert.equal(keyboardInset.subscribe, subscribe);
  assert.equal(keyboardInset.isSupported, isSupported);
  assert.equal(keyboardInset.isEditableElement, isEditableElement);
  assert.equal(keyboardInset.computeInset, computeInset);
  assert.equal(keyboardInset.EVENT_NAME, EVENT_NAME);
});

// --- isEditableElement -------------------------------------------------------------------

test('isEditableElement: <input> with no type attribute is editable', () => {
  assert.equal(isEditableElement({ tagName: 'INPUT' }), true);
  assert.equal(
    isEditableElement({ tagName: 'INPUT', getAttribute: () => null, type: 'text' }),
    true,
  );
});

test('isEditableElement: <input type="checkbox"> is not editable', () => {
  assert.equal(isEditableElement({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(
    isEditableElement({ tagName: 'INPUT', getAttribute: (n) => (n === 'type' ? 'checkbox' : null) }),
    false,
  );
});

test('isEditableElement: every text-like input type is editable', () => {
  for (const type of ['text', 'search', 'url', 'tel', 'email', 'password', 'number']) {
    assert.equal(isEditableElement({ tagName: 'INPUT', type }), true, type);
  }
  for (const type of ['radio', 'range', 'file', 'color', 'submit', 'button']) {
    assert.equal(isEditableElement({ tagName: 'INPUT', type }), false, type);
  }
});

test('isEditableElement: <textarea> is editable', () => {
  assert.equal(isEditableElement({ tagName: 'TEXTAREA' }), true);
});

test('isEditableElement: a contenteditable div is editable', () => {
  assert.equal(isEditableElement({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(
    isEditableElement({
      tagName: 'DIV',
      getAttribute: (n) => (n === 'contenteditable' ? '' : null),
    }),
    true,
  );
  assert.equal(
    isEditableElement({
      tagName: 'DIV',
      isContentEditable: false,
      getAttribute: (n) => (n === 'contenteditable' ? 'false' : null),
    }),
    false,
  );
});

test('isEditableElement: a plain div is not editable', () => {
  assert.equal(isEditableElement({ tagName: 'DIV' }), false);
  assert.equal(isEditableElement({ tagName: 'DIV', isContentEditable: false }), false);
});

test('isEditableElement: disabled and readonly inputs raise no keyboard', () => {
  assert.equal(isEditableElement({ tagName: 'INPUT', type: 'text', disabled: true }), false);
  assert.equal(isEditableElement({ tagName: 'INPUT', type: 'text', readOnly: true }), false);
});

test('isEditableElement: non-elements are handled without throwing', () => {
  assert.equal(isEditableElement(null), false);
  assert.equal(isEditableElement(undefined), false);
  assert.equal(isEditableElement('input'), false);
  assert.equal(isEditableElement(42), false);
  assert.equal(isEditableElement({}), false);
});

// --- computeInset ------------------------------------------------------------------------

test('computeInset: iOS Safari — the layout viewport stays, the visual one shrinks', () => {
  assert.deepEqual(
    computeInset({
      innerHeight: 844,
      viewportHeight: 508,
      offsetTop: 0,
      baseline: 844,
      threshold: 120,
      editableFocused: true,
    }),
    { open: true, height: 336 },
  );
});

test('computeInset: iOS offsetTop (a scrolled visual viewport) is subtracted too', () => {
  assert.deepEqual(
    computeInset({
      innerHeight: 844,
      viewportHeight: 508,
      offsetTop: 40,
      baseline: 844,
      threshold: 120,
      editableFocused: true,
    }),
    { open: true, height: 296 },
  );
});

test('computeInset: Android — the layout viewport itself resizes', () => {
  assert.deepEqual(
    computeInset({
      innerHeight: 460,
      viewportHeight: 460,
      offsetTop: 0,
      baseline: 800,
      threshold: 120,
      editableFocused: true,
    }),
    { open: true, height: 340 },
  );
});

test('computeInset: closed keyboard reports zero', () => {
  assert.deepEqual(
    computeInset({
      innerHeight: 844,
      viewportHeight: 844,
      offsetTop: 0,
      baseline: 844,
      threshold: 120,
      editableFocused: true,
    }),
    { open: false, height: 0 },
  );
});

test('computeInset: an address-bar shrink with nothing focused is not a keyboard', () => {
  assert.deepEqual(
    computeInset({
      innerHeight: 844,
      viewportHeight: 544,
      offsetTop: 0,
      baseline: 844,
      threshold: 120,
      editableFocused: false,
    }),
    { open: false, height: 0 },
  );
});

test('computeInset: a shrink at or below the threshold stays closed', () => {
  assert.deepEqual(
    computeInset({
      innerHeight: 844,
      viewportHeight: 724,
      offsetTop: 0,
      baseline: 844,
      threshold: 120,
      editableFocused: true,
    }),
    { open: false, height: 0 },
  );
  assert.deepEqual(
    computeInset({
      innerHeight: 844,
      viewportHeight: 723,
      offsetTop: 0,
      baseline: 844,
      threshold: 120,
      editableFocused: true,
    }),
    { open: true, height: 121 },
  );
});

test('computeInset: negative and garbage input clamps to a closed keyboard', () => {
  assert.deepEqual(
    computeInset({
      innerHeight: 500,
      viewportHeight: 800,
      offsetTop: 0,
      baseline: 500,
      threshold: 120,
      editableFocused: true,
    }),
    { open: false, height: 0 },
  );
  assert.deepEqual(
    computeInset({
      innerHeight: Number.NaN,
      viewportHeight: Number.NaN,
      offsetTop: Number.NaN,
      baseline: Number.NaN,
      threshold: Number.NaN,
      editableFocused: true,
    }),
    { open: false, height: 0 },
  );
  assert.deepEqual(
    computeInset({
      innerHeight: -100,
      viewportHeight: -100,
      offsetTop: -100,
      baseline: -100,
      threshold: -100,
      editableFocused: true,
    }),
    { open: false, height: 0 },
  );
});

test('computeInset: subpixel viewport heights round to whole pixels', () => {
  assert.deepEqual(
    computeInset({
      innerHeight: 844,
      viewportHeight: 507.6666,
      offsetTop: 0,
      baseline: 844,
      threshold: 120,
      editableFocused: true,
    }),
    { open: true, height: 336 },
  );
});

test('computeInset: the larger of the two mechanisms wins', () => {
  // Layout viewport shrank a little (collapsed address bar) *and* the keyboard overlays.
  assert.deepEqual(
    computeInset({
      innerHeight: 780,
      viewportHeight: 444,
      offsetTop: 0,
      baseline: 844,
      threshold: 120,
      editableFocused: true,
    }),
    { open: true, height: 336 },
  );
});
