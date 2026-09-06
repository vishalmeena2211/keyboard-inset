/**
 * keyboard-inset — the on-screen keyboard's height, exposed as a CSS custom property.
 *
 * Call {@link init} once and style against `var(--kb-height)`. No framework, no
 * runtime dependencies, safe to import on the server.
 */

/**
 * Which measurement strategy produced the current state.
 *
 * - `virtualkeyboard` — Chromium's VirtualKeyboard API. Exact, reported by the browser.
 * - `visualviewport` — derived from `window.visualViewport`. Correct on iOS Safari and
 *   most Android browsers, but inferred rather than reported.
 * - `none` — neither API is available; the height is always `0`.
 */
export type KeyboardInsetSource = 'virtualkeyboard' | 'visualviewport' | 'none';

/** A snapshot of the on-screen keyboard. */
export interface KeyboardInsetState {
  /** `true` while the on-screen keyboard is believed to be covering the page. */
  readonly open: boolean;
  /** Keyboard height in CSS pixels, rounded to a whole pixel. `0` when closed. */
  readonly height: number;
  /** Current visual viewport height in CSS pixels, unrounded. */
  readonly viewportHeight: number;
  /** Which strategy produced {@link KeyboardInsetState.height}. */
  readonly source: KeyboardInsetSource;
}

/** Options for {@link init}. Every field is optional. */
export interface KeyboardInsetOptions {
  /**
   * CSS custom property set to the keyboard height, e.g. `"336px"`.
   * @default '--kb-height'
   */
  cssVar?: string;
  /**
   * CSS custom property set to 1% of the visual viewport height, e.g. `"7.31px"`.
   * Use it as a `100vh` replacement: `height: calc(var(--safe-vh) * 100)`.
   * @default '--safe-vh'
   */
  vhVar?: string;
  /**
   * Element the custom properties are set on.
   * @default document.documentElement
   */
  target?: HTMLElement | null;
  /**
   * Class toggled on `document.body` while the keyboard is open. Pass `null` to disable.
   * @default 'kb-open'
   */
  bodyClass?: string | null;
  /**
   * How many pixels the viewport must shrink before the change counts as "keyboard open".
   * Only applies to the `visualviewport` strategy — the VirtualKeyboard API reports an
   * exact height, so any height above zero counts as open.
   * @default 120
   */
  openThreshold?: number;
  /**
   * Use Chromium's VirtualKeyboard API when present. Set to `false` to force the
   * `visualViewport` strategy everywhere.
   * @default true
   */
  useVirtualKeyboardApi?: boolean;
  /**
   * Scroll the window back to the top when the keyboard closes. iOS sometimes leaves the
   * page scrolled after a dismissal. Off by default because it can fight with scroll
   * handling in the host app.
   * @default false
   */
  restoreScrollOnClose?: boolean;
  /** Called with a fresh snapshot every time the state changes. */
  onChange?: (state: KeyboardInsetState) => void;
}

/** Input for {@link computeInset}. */
export interface ComputeInsetInput {
  /** `window.innerHeight` — the layout viewport height. */
  innerHeight: number;
  /** `visualViewport.height`. */
  viewportHeight: number;
  /** `visualViewport.offsetTop`. */
  offsetTop: number;
  /** `window.innerHeight` as measured while no editable element was focused. */
  baseline: number;
  /** Minimum shrink, in pixels, that counts as an open keyboard. */
  threshold: number;
  /** Whether a text-like editable element currently has focus. */
  editableFocused: boolean;
}

/** Result of {@link computeInset}. */
export interface ComputeInsetResult {
  /** Whether the numbers describe an open keyboard. */
  open: boolean;
  /** Keyboard height in whole CSS pixels; `0` when closed. */
  height: number;
}

declare global {
  interface WindowEventMap {
    /** Dispatched on `window` whenever the keyboard state changes. */
    keyboardinset: CustomEvent<KeyboardInsetState>;
  }
}

/** Name of the `CustomEvent` dispatched on `window` when the state changes. */
export const EVENT_NAME = 'keyboardinset';

const IDLE_REBASELINE_MS = 500;
const ORIENTATION_SETTLE_MS = 400;

const DEFAULT_CSS_VAR = '--kb-height';
const DEFAULT_VH_VAR = '--safe-vh';
const DEFAULT_BODY_CLASS = 'kb-open';
const DEFAULT_OPEN_THRESHOLD = 120;

const TEXTUAL_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'number',
]);

const INITIAL_STATE: KeyboardInsetState = Object.freeze({
  open: false,
  height: 0,
  viewportHeight: 0,
  source: 'none' as KeyboardInsetSource,
});

/**
 * The subset of Chromium's `navigator.virtualKeyboard` this package uses.
 * TypeScript ships no lib types for it, so we declare the shape we rely on.
 */
interface VirtualKeyboardLike {
  overlaysContent: boolean;
  readonly boundingRect: { height: number } | null;
  addEventListener(type: 'geometrychange', listener: () => void): void;
  removeEventListener(type: 'geometrychange', listener: () => void): void;
}

interface ActiveController {
  teardown: () => void;
}

let active: ActiveController | null = null;
let currentState: KeyboardInsetState = INITIAL_STATE;
const listeners = new Set<(state: KeyboardInsetState) => void>();

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function getVirtualKeyboard(): VirtualKeyboardLike | null {
  if (typeof navigator === 'undefined') return null;
  const candidate = (navigator as Navigator & { virtualKeyboard?: unknown }).virtualKeyboard;
  if (!candidate || typeof candidate !== 'object') return null;
  const vk = candidate as Partial<VirtualKeyboardLike>;
  if (typeof vk.addEventListener !== 'function') return null;
  return candidate as VirtualKeyboardLike;
}

/**
 * Whether an element is one that raises the on-screen keyboard when focused:
 * a text-like `<input>` (including an `<input>` with no `type` attribute at all),
 * a `<textarea>`, or anything `contenteditable`.
 *
 * Accepts anything — non-elements, `null` and plain objects return `false` — so it is
 * safe to call with `document.activeElement` or an untyped event target.
 */
export function isEditableElement(el: unknown): boolean {
  if (!el || typeof el !== 'object') return false;

  const node = el as {
    tagName?: unknown;
    type?: unknown;
    isContentEditable?: unknown;
    readOnly?: unknown;
    disabled?: unknown;
    getAttribute?: (name: string) => string | null;
  };

  if (node.isContentEditable === true) return true;

  const getAttribute =
    typeof node.getAttribute === 'function'
      ? (name: string): string | null => {
          try {
            return node.getAttribute!(name);
          } catch {
            return null;
          }
        }
      : (): string | null => null;

  const editableAttr = getAttribute('contenteditable');
  if (editableAttr !== null && editableAttr !== 'false') return true;

  const tag = typeof node.tagName === 'string' ? node.tagName.toLowerCase() : '';
  if (node.disabled === true || node.readOnly === true) return false;
  if (tag === 'textarea') return true;
  if (tag !== 'input') return false;

  const attrType = getAttribute('type');
  const type = attrType ?? (typeof node.type === 'string' ? node.type : null);
  // `<input>` with no type attribute behaves as `type="text"`.
  if (type === null || type === '') return true;
  return TEXTUAL_INPUT_TYPES.has(type.toLowerCase());
}

/**
 * The core measurement, extracted as a pure function so it can be reasoned about and
 * tested without a DOM.
 *
 * Two mechanisms produce a keyboard inset, and browsers disagree about which one they use:
 *
 * 1. **The layout viewport stays put** (iOS Safari, Chromium with an overlaying keyboard).
 *    The visual viewport shrinks underneath it, so
 *    `innerHeight - (viewportHeight + offsetTop)` is the keyboard height.
 * 2. **The layout viewport itself shrinks** (many Android browsers, and anything using
 *    `interactive-widget=resizes-content`). The formula above yields ~0 because both
 *    numbers shrank together, so the keyboard height is instead the drop in `innerHeight`
 *    from a baseline recorded while nothing was focused.
 *
 * Whichever mechanism is in play, the larger of the two readings is the keyboard height.
 *
 * A focused editable element is required. Without one, a shrinking viewport is browser
 * chrome — Safari's collapsing address bar, most commonly — and not a keyboard.
 */
export function computeInset(input: ComputeInsetInput): ComputeInsetResult {
  if (input?.editableFocused !== true) return { open: false, height: 0 };

  const innerHeight = Math.max(0, finite(input.innerHeight));
  const viewportHeight = Math.max(0, finite(input.viewportHeight));
  const offsetTop = Math.max(0, finite(input.offsetTop));
  const baseline = Math.max(0, finite(input.baseline, innerHeight));
  const threshold = Math.max(0, finite(input.threshold, DEFAULT_OPEN_THRESHOLD));

  // 1. Keyboard overlays the page: the visual viewport is shorter than the layout viewport.
  const overlayShrink = Math.max(0, innerHeight - (viewportHeight + offsetTop));
  // 2. Keyboard resizes the page: the layout viewport itself lost height.
  const layoutShrink = Math.max(0, baseline - innerHeight);

  const height = Math.max(overlayShrink, layoutShrink);
  if (height <= threshold) return { open: false, height: 0 };
  return { open: true, height: Math.round(height) };
}

/**
 * Whether this environment can measure the keyboard at all. `false` on the server, and in
 * browsers with neither the VirtualKeyboard API nor `window.visualViewport` — where
 * {@link init} still runs and pins the CSS variable to `0px` so layouts do not break.
 */
export function isSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (getVirtualKeyboard()) return true;
  return Boolean(window.visualViewport);
}

/** The latest keyboard snapshot. Off-DOM this is the inert server state. */
export function getState(): KeyboardInsetState {
  return currentState;
}

/**
 * Subscribe to state changes. Returns an unsubscribe function.
 *
 * Safe to call before {@link init} — subscribers simply receive nothing until it runs.
 */
export function subscribe(listener: (state: KeyboardInsetState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Start tracking the on-screen keyboard and writing the CSS custom properties.
 *
 * Returns a disposer. Calling {@link init} again while already active tears the previous
 * run down first, so it never double-binds. On the server it is a no-op that still returns
 * a working disposer.
 */
export function init(options: KeyboardInsetOptions = {}): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }
  if (active) destroy();

  const win = window;
  const doc = document;

  const cssVar = options.cssVar ?? DEFAULT_CSS_VAR;
  const vhVar = options.vhVar ?? DEFAULT_VH_VAR;
  const target: HTMLElement = options.target ?? doc.documentElement;
  const bodyClass = options.bodyClass === undefined ? DEFAULT_BODY_CLASS : options.bodyClass;
  const openThreshold = Math.max(0, finite(options.openThreshold, DEFAULT_OPEN_THRESHOLD));
  const useVirtualKeyboardApi = options.useVirtualKeyboardApi !== false;
  const restoreScrollOnClose = options.restoreScrollOnClose === true;
  const onChange = options.onChange;

  // Anything already inline on the target is restored verbatim by the disposer.
  const previousCssVar = target.style.getPropertyValue(cssVar);
  const previousVhVar = target.style.getPropertyValue(vhVar);

  const vv = win.visualViewport ?? null;
  const vk = useVirtualKeyboardApi ? getVirtualKeyboard() : null;

  let previousOverlaysContent: boolean | null = null;
  let vkActive = false;
  if (vk) {
    try {
      previousOverlaysContent = vk.overlaysContent === true;
      // Without this the browser resizes the layout viewport itself and reports an empty
      // boundingRect, which is exactly the measurement we are trying to avoid.
      vk.overlaysContent = true;
      vkActive = true;
    } catch {
      // Some embedded webviews expose the object but refuse the setter. Fall back to the
      // visualViewport strategy; `state.source` reports which path is actually live.
      previousOverlaysContent = null;
      vkActive = false;
    }
  }

  const source: KeyboardInsetSource = vkActive ? 'virtualkeyboard' : vv ? 'visualviewport' : 'none';

  let baseline = finite(win.innerHeight);
  let focusedEditable = isEditableElement(doc.activeElement);
  let rafId: number | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let orientationTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollOnlyBurst = true;
  let lastCssHeight = '';
  let lastCssVh = '';
  let bodyClassApplied = false;
  let disposed = false;

  function emit(state: KeyboardInsetState): void {
    for (const listener of Array.from(listeners)) listener(state);
    if (onChange) onChange(state);
    if (typeof CustomEvent === 'function') {
      win.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: state }));
    }
  }

  function commit(next: KeyboardInsetState): void {
    // One DOM write per frame at most, and only when the value actually moved.
    const nextCssHeight = `${next.height}px`;
    if (nextCssHeight !== lastCssHeight) {
      target.style.setProperty(cssVar, nextCssHeight);
      lastCssHeight = nextCssHeight;
    }
    const nextCssVh = `${round3(next.viewportHeight / 100)}px`;
    if (nextCssVh !== lastCssVh) {
      target.style.setProperty(vhVar, nextCssVh);
      lastCssVh = nextCssVh;
    }
    if (bodyClass && doc.body) {
      if (next.open && !bodyClassApplied) {
        doc.body.classList.add(bodyClass);
        bodyClassApplied = true;
      } else if (!next.open && bodyClassApplied) {
        doc.body.classList.remove(bodyClass);
        bodyClassApplied = false;
      }
    }

    const previous = currentState;
    const changed =
      previous.open !== next.open ||
      previous.height !== next.height ||
      previous.source !== next.source ||
      Math.round(previous.viewportHeight) !== Math.round(next.viewportHeight);
    if (!changed) return;

    currentState = next;

    if (previous.open && !next.open) {
      if (restoreScrollOnClose) win.scrollTo(finite(win.scrollX), 0);
      scheduleRebaseline();
    }

    emit(next);
  }

  function measure(): void {
    rafId = null;
    const scrollOnly = scrollOnlyBurst;
    scrollOnlyBurst = true;

    const innerHeight = finite(win.innerHeight);
    const viewportHeight = vv ? finite(vv.height, innerHeight) : innerHeight;
    const offsetTop = vv ? finite(vv.offsetTop) : 0;
    const editableFocused = focusedEditable || isEditableElement(doc.activeElement);

    // A layout viewport that grew can never be hiding a keyboard, so it is always a safe
    // baseline. Shrinking is the ambiguous direction and is handled by the idle re-baseline.
    if (innerHeight > baseline) baseline = innerHeight;

    let open = false;
    let height = 0;

    if (source === 'virtualkeyboard' && vk) {
      height = Math.max(0, Math.round(finite(vk.boundingRect?.height)));
      open = height > 0;
    } else if (source === 'visualviewport') {
      const result = computeInset({
        innerHeight,
        viewportHeight,
        offsetTop,
        baseline,
        threshold: openThreshold,
        editableFocused,
      });
      open = result.open;
      height = result.height;
      // Safari collapses its address bar as you scroll, which shrinks the viewport with no
      // keyboard involved. A burst of nothing but scroll events with nothing editable
      // focused can never be a keyboard opening.
      if (scrollOnly && !editableFocused) {
        open = false;
        height = 0;
      }
    }

    commit({ open, height, viewportHeight, source });
  }

  function schedule(fromScroll: boolean): void {
    if (disposed) return;
    if (!fromScroll) scrollOnlyBurst = false;
    if (rafId !== null) return;
    if (typeof win.requestAnimationFrame !== 'function') {
      measure();
      return;
    }
    rafId = win.requestAnimationFrame(() => {
      if (disposed) return;
      measure();
    });
  }

  function scheduleRebaseline(): void {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (disposed) return;
      if (currentState.open || isEditableElement(doc.activeElement)) return;
      const innerHeight = finite(win.innerHeight);
      if (innerHeight === baseline) return;
      baseline = innerHeight;
      schedule(false);
    }, IDLE_REBASELINE_MS);
  }

  const onViewportResize = (): void => schedule(false);
  const onViewportScroll = (): void => schedule(true);
  const onWindowResize = (): void => schedule(false);

  const onFocusIn = (event: Event): void => {
    if (!isEditableElement(event.target)) return;
    focusedEditable = true;
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    schedule(false);
  };

  const onFocusOut = (): void => {
    focusedEditable = false;
    schedule(false);
    scheduleRebaseline();
  };

  const onGeometryChange = (): void => schedule(false);

  const onWake = (): void => {
    if (doc.visibilityState === 'hidden') return;
    // A page restored from the back/forward cache, revealed after being hidden, or measured
    // before layout settled can hold a stale reading that no resize event will ever correct.
    if (!isEditableElement(doc.activeElement)) baseline = finite(win.innerHeight);
    schedule(false);
  };

  const onOrientationChange = (): void => {
    // Both viewport dimensions swap, so the old baseline is meaningless. Re-read it now and
    // again once the browser has finished settling.
    baseline = finite(win.innerHeight);
    schedule(false);
    if (orientationTimer !== null) clearTimeout(orientationTimer);
    orientationTimer = setTimeout(() => {
      orientationTimer = null;
      if (disposed) return;
      baseline = finite(win.innerHeight);
      schedule(false);
    }, ORIENTATION_SETTLE_MS);
  };

  const orientation =
    typeof screen !== 'undefined' && screen && typeof screen.orientation === 'object'
      ? screen.orientation
      : null;

  if (vv) {
    vv.addEventListener('resize', onViewportResize);
    vv.addEventListener('scroll', onViewportScroll);
  }
  win.addEventListener('resize', onWindowResize);
  win.addEventListener('pageshow', onWake);
  win.addEventListener('load', onWake);
  doc.addEventListener('visibilitychange', onWake);
  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('focusout', onFocusOut, true);
  if (vkActive && vk) vk.addEventListener('geometrychange', onGeometryChange);
  if (orientation && typeof orientation.addEventListener === 'function') {
    orientation.addEventListener('change', onOrientationChange);
  } else {
    win.addEventListener('orientationchange', onOrientationChange);
  }

  const teardown = (): void => {
    disposed = true;
    if (rafId !== null && typeof win.cancelAnimationFrame === 'function') {
      win.cancelAnimationFrame(rafId);
    }
    rafId = null;
    if (idleTimer !== null) clearTimeout(idleTimer);
    if (orientationTimer !== null) clearTimeout(orientationTimer);
    idleTimer = null;
    orientationTimer = null;

    if (vv) {
      vv.removeEventListener('resize', onViewportResize);
      vv.removeEventListener('scroll', onViewportScroll);
    }
    win.removeEventListener('resize', onWindowResize);
    win.removeEventListener('pageshow', onWake);
    win.removeEventListener('load', onWake);
    doc.removeEventListener('visibilitychange', onWake);
    doc.removeEventListener('focusin', onFocusIn, true);
    doc.removeEventListener('focusout', onFocusOut, true);
    if (vkActive && vk) vk.removeEventListener('geometrychange', onGeometryChange);
    if (orientation && typeof orientation.removeEventListener === 'function') {
      orientation.removeEventListener('change', onOrientationChange);
    } else {
      win.removeEventListener('orientationchange', onOrientationChange);
    }

    if (vk && previousOverlaysContent !== null) {
      try {
        vk.overlaysContent = previousOverlaysContent;
      } catch {
        // The setter accepted `true` at init but refuses now; nothing further we can do.
      }
    }

    if (bodyClass && bodyClassApplied && doc.body) {
      doc.body.classList.remove(bodyClass);
      bodyClassApplied = false;
    }

    if (previousCssVar) target.style.setProperty(cssVar, previousCssVar);
    else target.style.removeProperty(cssVar);
    if (previousVhVar) target.style.setProperty(vhVar, previousVhVar);
    else target.style.removeProperty(vhVar);

    if (currentState !== INITIAL_STATE) {
      currentState = INITIAL_STATE;
      emit(INITIAL_STATE);
    }
  };

  const record: ActiveController = { teardown };
  active = record;

  // Publish a value immediately so `var(--kb-height)` resolves on the very first paint...
  measure();
  // ...then again on the next frame, because `init()` called from `<head>`, or before the
  // browser has sized the viewport, would otherwise latch a zero that no event corrects.
  schedule(false);

  return () => {
    if (active === record) destroy();
  };
}

/**
 * Stop tracking, remove every listener, class and CSS custom property this package added,
 * and restore anything it overwrote. Safe to call when nothing is running.
 */
export function destroy(): void {
  const record = active;
  if (!record) return;
  active = null;
  record.teardown();
}

/** Everything above, as one object — the shape of the UMD/IIFE global. */
const keyboardInset = {
  init,
  destroy,
  getState,
  subscribe,
  isSupported,
  isEditableElement,
  computeInset,
  EVENT_NAME,
};

export default keyboardInset;
