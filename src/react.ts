/**
 * React adapter for keyboard-inset.
 *
 * Import from `keyboard-inset/react`. React is an optional peer dependency; the core
 * entry point has no React code in it at all.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { getState, init, subscribe } from './index.js';
import type { KeyboardInsetOptions, KeyboardInsetState } from './index.js';

export type { KeyboardInsetOptions, KeyboardInsetState, KeyboardInsetSource } from './index.js';

/**
 * Stable snapshot for server rendering and hydration. Must be a module constant:
 * `useSyncExternalStore` compares snapshots by reference.
 */
const SERVER_STATE: KeyboardInsetState = Object.freeze({
  open: false,
  height: 0,
  viewportHeight: 0,
  source: 'none' as const,
});

let refCount = 0;
let dispose: (() => void) | null = null;

/**
 * Reference-counted `init`, so many components can use the hook without fighting over a
 * single global listener set. The first mount starts tracking, the last unmount stops it.
 */
function acquire(options: KeyboardInsetOptions | undefined): () => void {
  refCount += 1;
  if (refCount === 1) dispose = init(options ?? {});

  let released = false;
  return () => {
    if (released) return;
    released = true;
    refCount -= 1;
    if (refCount === 0 && dispose) {
      dispose();
      dispose = null;
    }
  };
}

function getServerSnapshot(): KeyboardInsetState {
  return SERVER_STATE;
}

/**
 * Track the on-screen keyboard and keep the CSS custom properties up to date for as long as
 * at least one component using this hook is mounted.
 *
 * Options are read once, on the first mount that starts tracking; later changes to the
 * object are ignored. If you need different options at runtime, call `destroy()` and
 * `init()` yourself instead.
 *
 * ```tsx
 * const { open, height } = useKeyboardInset();
 * return <footer style={{ bottom: height }}>…</footer>;
 * ```
 */
export function useKeyboardInset(options?: KeyboardInsetOptions): KeyboardInsetState {
  const optionsRef = useRef(options);

  useEffect(() => acquire(optionsRef.current), []);

  return useSyncExternalStore(subscribe, getState, getServerSnapshot);
}

/**
 * `true` while the on-screen keyboard is open. Convenience wrapper around
 * {@link useKeyboardInset} with the same mount/unmount behaviour.
 */
export function useKeyboardOpen(options?: KeyboardInsetOptions): boolean {
  return useKeyboardInset(options).open;
}

export default { useKeyboardInset, useKeyboardOpen };
