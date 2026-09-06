// Behavioural tests against a hand-rolled fake DOM — no jsdom, no dependencies.
// `node --test` runs each file in its own process, so installing globals here cannot
// affect the SSR assertions in smoke.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function makeStyle() {
  const map = new Map();
  return {
    map,
    setProperty: (k, v) => map.set(k, v),
    getPropertyValue: (k) => map.get(k) ?? '',
    removeProperty: (k) => map.delete(k),
  };
}

function makeClassList() {
  const set = new Set();
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
  };
}

function makeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    fire(type, event = {}) {
      for (const fn of Array.from(listeners.get(type) ?? [])) fn(event);
    },
    listenerCount() {
      let total = 0;
      for (const set of listeners.values()) total += set.size;
      return total;
    },
  };
}

const rafQueue = [];
function flushFrames() {
  for (const cb of rafQueue.splice(0)) if (cb) cb();
}

const visualViewport = Object.assign(makeEventTarget(), { height: 844, offsetTop: 0 });
const html = { style: makeStyle() };
const body = { classList: makeClassList() };

const win = Object.assign(makeEventTarget(), {
  innerHeight: 844,
  scrollX: 0,
  scrolledTo: null,
  visualViewport,
  requestAnimationFrame(cb) {
    rafQueue.push(cb);
    return rafQueue.length;
  },
  cancelAnimationFrame(id) {
    rafQueue[id - 1] = null;
  },
  scrollTo(x, y) {
    win.scrolledTo = [x, y];
  },
  dispatchEvent(event) {
    win.fire(event.type, event);
    return true;
  },
});

const doc = Object.assign(makeEventTarget(), {
  documentElement: html,
  body,
  activeElement: null,
});

const screenObj = { orientation: makeEventTarget() };

function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
    writable: true,
  });
}

globalThis.window = win;
globalThis.document = doc;
globalThis.screen = screenObj;
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
};
setNavigator({ userAgent: 'fake' });

const { init, destroy, getState, subscribe, isSupported } = await import('../dist/index.js');

const textInput = { tagName: 'INPUT', type: 'text', getAttribute: () => null };

function boundListeners() {
  return (
    win.listenerCount() +
    doc.listenerCount() +
    visualViewport.listenerCount() +
    screenObj.orientation.listenerCount()
  );
}

function focus(el) {
  doc.activeElement = el;
  doc.fire('focusin', { target: el });
}

function blur() {
  doc.activeElement = null;
  doc.fire('focusout', {});
}

function reset() {
  destroy();
  win.innerHeight = 844;
  visualViewport.height = 844;
  visualViewport.offsetTop = 0;
  doc.activeElement = null;
  win.scrolledTo = null;
  rafQueue.length = 0;
}

test('isSupported() is true once visualViewport exists', () => {
  assert.equal(isSupported(), true);
});

test('init() publishes both custom properties immediately', () => {
  reset();
  const dispose = init();
  assert.equal(html.style.getPropertyValue('--kb-height'), '0px');
  assert.equal(html.style.getPropertyValue('--safe-vh'), '8.44px');
  assert.equal(getState().source, 'visualviewport');
  dispose();
});

test('iOS shape: the visual viewport shrinks under a stable layout viewport', () => {
  reset();
  const seen = [];
  const unsubscribe = subscribe((state) => seen.push({ ...state }));
  const dispose = init({ onChange: (state) => seen.push({ from: 'onChange', ...state }) });

  focus(textInput);
  visualViewport.height = 508;
  visualViewport.fire('resize');
  flushFrames();

  assert.equal(getState().open, true);
  assert.equal(getState().height, 336);
  assert.equal(html.style.getPropertyValue('--kb-height'), '336px');
  assert.equal(html.style.getPropertyValue('--safe-vh'), '5.08px');
  assert.equal(body.classList.contains('kb-open'), true);
  assert.equal(
    seen.filter((s) => s.open && s.height === 336).length,
    2,
    'subscriber and onChange both notified',
  );

  unsubscribe();
  dispose();
});

test('a window CustomEvent carries the same state', () => {
  reset();
  const detail = [];
  const onEvent = (event) => detail.push(event.detail);
  win.addEventListener('keyboardinset', onEvent);
  const dispose = init();

  focus(textInput);
  visualViewport.height = 508;
  visualViewport.fire('resize');
  flushFrames();

  assert.equal(detail.at(-1).height, 336);
  win.removeEventListener('keyboardinset', onEvent);
  dispose();
});

test('bursts coalesce into one frame and unchanged values are not re-published', () => {
  reset();
  const seen = [];
  const dispose = init({ onChange: (state) => seen.push(state) });
  focus(textInput);
  visualViewport.height = 508;
  visualViewport.fire('resize');
  flushFrames();

  const before = seen.length;
  visualViewport.fire('resize');
  visualViewport.fire('scroll');
  win.fire('resize');
  assert.equal(rafQueue.filter(Boolean).length, 1, 'three events, one frame');
  flushFrames();
  assert.equal(seen.length, before, 'no notification when nothing moved');

  dispose();
});

test('Android shape: the layout viewport itself resizes', () => {
  reset();
  const dispose = init();
  focus(textInput);

  win.innerHeight = 504;
  visualViewport.height = 504;
  win.fire('resize');
  flushFrames();

  assert.equal(getState().open, true);
  assert.equal(getState().height, 340);
  dispose();
});

test('an address-bar collapse during scroll is not reported as a keyboard', () => {
  reset();
  const dispose = init();

  visualViewport.height = 744;
  visualViewport.fire('scroll');
  flushFrames();

  assert.equal(getState().open, false);
  assert.equal(html.style.getPropertyValue('--kb-height'), '0px');
  assert.equal(html.style.getPropertyValue('--safe-vh'), '7.44px', '--safe-vh still tracks it');
  dispose();
});

test('closing removes the body class and zeroes the height', () => {
  reset();
  const dispose = init();
  focus(textInput);
  visualViewport.height = 508;
  visualViewport.fire('resize');
  flushFrames();
  assert.equal(getState().open, true);

  blur();
  visualViewport.height = 844;
  visualViewport.fire('resize');
  flushFrames();

  assert.equal(getState().open, false);
  assert.equal(getState().height, 0);
  assert.equal(html.style.getPropertyValue('--kb-height'), '0px');
  assert.equal(body.classList.contains('kb-open'), false);
  dispose();
});

test('a second init() tears the first down instead of double-binding', () => {
  reset();
  assert.equal(boundListeners(), 0);
  const first = init();
  const bound = boundListeners();
  assert.ok(bound > 0);

  const second = init();
  assert.equal(boundListeners(), bound, 'listener count unchanged');

  first(); // stale disposer must not kill the live controller
  assert.equal(boundListeners(), bound, 'stale disposer is inert');

  second();
  assert.equal(boundListeners(), 0);
});

test('the disposer removes every listener, class and custom property', () => {
  reset();
  html.style.setProperty('--kb-height', 'inherited');
  const dispose = init();
  focus(textInput);
  visualViewport.height = 508;
  visualViewport.fire('resize');
  flushFrames();

  dispose();

  assert.equal(boundListeners(), 0);
  assert.equal(html.style.getPropertyValue('--kb-height'), 'inherited', 'prior value restored');
  assert.equal(html.style.map.has('--safe-vh'), false, 'added property removed outright');
  assert.equal(body.classList.contains('kb-open'), false);
  assert.deepEqual(getState(), { open: false, height: 0, viewportHeight: 0, source: 'none' });
  html.style.removeProperty('--kb-height');
  assert.doesNotThrow(() => destroy());
});

test('options: custom cssVar, disabled bodyClass and restoreScrollOnClose', () => {
  reset();
  const dispose = init({ cssVar: '--x', bodyClass: null, restoreScrollOnClose: true });
  focus(textInput);
  visualViewport.height = 500;
  visualViewport.fire('resize');
  flushFrames();

  assert.equal(html.style.getPropertyValue('--x'), '344px');
  assert.equal(body.classList.contains('kb-open'), false);

  blur();
  visualViewport.height = 844;
  visualViewport.fire('resize');
  flushFrames();

  assert.deepEqual(win.scrolledTo, [0, 0]);
  dispose();
});

test('openThreshold suppresses shrinks smaller than it', () => {
  reset();
  const dispose = init({ openThreshold: 400 });
  focus(textInput);
  visualViewport.height = 508;
  visualViewport.fire('resize');
  flushFrames();

  assert.equal(getState().open, false, '336px is below a 400px threshold');
  dispose();
});

test('VirtualKeyboard API is preferred, opted into, and restored', () => {
  reset();
  const vk = Object.assign(makeEventTarget(), {
    overlaysContent: false,
    boundingRect: { height: 0 },
  });
  setNavigator({ userAgent: 'fake', virtualKeyboard: vk });

  const dispose = init();
  assert.equal(vk.overlaysContent, true, 'overlaysContent opted in');
  assert.equal(getState().source, 'virtualkeyboard');

  vk.boundingRect = { height: 293.5 };
  vk.fire('geometrychange');
  flushFrames();

  assert.equal(getState().open, true);
  assert.equal(getState().height, 294, 'exact height, rounded to a pixel');
  assert.equal(body.classList.contains('kb-open'), true);

  dispose();
  assert.equal(vk.overlaysContent, false, 'previous value restored');
  assert.equal(vk.listenerCount(), 0);
  setNavigator({ userAgent: 'fake' });
});

test('useVirtualKeyboardApi: false forces the visualViewport strategy', () => {
  reset();
  const vk = Object.assign(makeEventTarget(), {
    overlaysContent: false,
    boundingRect: { height: 300 },
  });
  setNavigator({ userAgent: 'fake', virtualKeyboard: vk });

  const dispose = init({ useVirtualKeyboardApi: false });
  assert.equal(getState().source, 'visualviewport');
  assert.equal(vk.overlaysContent, false, 'left untouched');
  assert.equal(vk.listenerCount(), 0);

  dispose();
  setNavigator({ userAgent: 'fake' });
});

test('a measurement taken before the viewport exists self-corrects on the next frame', () => {
  reset();
  // `init()` from <head>, or in a tab the browser has not sized yet.
  win.innerHeight = 0;
  visualViewport.height = 0;
  const dispose = init();
  assert.equal(html.style.getPropertyValue('--safe-vh'), '0px', 'nothing to measure yet');

  win.innerHeight = 844;
  visualViewport.height = 844;
  flushFrames(); // no resize event — only the deferred re-measure
  assert.equal(html.style.getPropertyValue('--safe-vh'), '8.44px');
  assert.equal(getState().viewportHeight, 844);
  dispose();
});

test('pageshow and visibilitychange re-measure after a bfcache restore', () => {
  reset();
  win.innerHeight = 0;
  visualViewport.height = 0;
  const dispose = init();
  flushFrames();

  win.innerHeight = 844;
  visualViewport.height = 844;
  win.fire('pageshow');
  flushFrames();
  assert.equal(getState().viewportHeight, 844);

  visualViewport.height = 700;
  doc.fire('visibilitychange');
  flushFrames();
  assert.equal(getState().viewportHeight, 700);
  dispose();
});

test('orientation change re-baselines the layout viewport', () => {
  reset();
  const dispose = init();
  focus(textInput);

  // Rotate: the layout viewport is now genuinely shorter, with no keyboard.
  win.innerHeight = 390;
  visualViewport.height = 390;
  screenObj.orientation.fire('change');
  flushFrames();

  assert.equal(getState().open, false, 'a rotation is not a keyboard');

  // And a keyboard on top of the new orientation is still measured correctly.
  visualViewport.height = 190;
  visualViewport.fire('resize');
  flushFrames();
  assert.equal(getState().height, 200);

  dispose();
});
