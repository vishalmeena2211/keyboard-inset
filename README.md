# keyboard-inset

_The mobile on-screen keyboard's height, as a CSS variable._

[![npm version](https://img.shields.io/npm/v/keyboard-inset.svg)](https://www.npmjs.com/package/keyboard-inset)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/keyboard-inset)](https://bundlephobia.com/package/keyboard-inset)
[![license MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/vishalmeena2211/keyboard-inset/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/types-TypeScript-3178c6.svg)](https://github.com/vishalmeena2211/keyboard-inset/blob/main/src/index.ts)
[![GitHub](https://img.shields.io/badge/GitHub-vishalmeena2211%2Fkeyboard--inset-181717?logo=github)](https://github.com/vishalmeena2211/keyboard-inset)

```css
/* Before — the keyboard opens and eats your composer. */
.composer { position: fixed; bottom: 0; }

/* After — one JS call, and the composer rides on top of the keyboard. */
.composer { position: fixed; bottom: var(--kb-height); }
```

```js
import { init } from 'keyboard-inset';
init(); // that's it — --kb-height is now live on <html>
```

No dependencies, no framework, 1 file, works with plain CSS.

## Why this exists

Mobile browsers do not tell CSS how tall the keyboard is, and the workarounds people copy
from Stack Overflow are wrong in at least one browser. This package handles the specific
quirks:

- **iOS Safari does not resize the layout viewport.** `window.innerHeight` is unchanged when
  the keyboard opens, so `100vh`, `100dvh` and `position: fixed; bottom: 0` all keep pointing
  at an area the keyboard is now sitting on. The real number is
  `innerHeight - (visualViewport.height + visualViewport.offsetTop)`, and it needs the
  `offsetTop` term because the visual viewport also scrolls.
- **Many Android browsers do the opposite** and shrink the *layout* viewport, so the formula
  above legitimately returns `0` while a keyboard is clearly up. The package tracks a
  baseline `innerHeight` recorded while nothing was focused and uses the drop from that
  baseline instead.
- **Chromium has an exact API** — `navigator.virtualKeyboard` — that reports the keyboard
  rect directly, but only after you opt in with `overlaysContent = true`. The package sets
  it, prefers this source when present, and restores your previous value on `destroy()`.
- **Safari's address bar collapses as you scroll**, shrinking the viewport by ~60–100px with
  no keyboard involved. Naive implementations flash the footer up and down while scrolling.
  This one requires a focused text-like element before it will call anything a keyboard.
- **`resize` and `scroll` fire in bursts** during the keyboard animation. Updates are
  coalesced into a single `requestAnimationFrame`, and a DOM write is skipped entirely when
  the rounded height has not changed.
- **Orientation changes invalidate the baseline.** Re-measured on `screen.orientation`
  change, and again once the browser has settled.
- **A first measurement can be taken too early.** `init()` called from `<head>`, or in a tab
  the browser has not sized yet, would otherwise latch a zero that no later event corrects.
  The package re-measures on the next frame, on `load`, on `pageshow` (so a back/forward
  cache restore is correct) and whenever the tab becomes visible again.
- **Older browsers** have neither API. `--kb-height` is still set — to `0px` — so
  `bottom: var(--kb-height)` never breaks a layout, and `isSupported()` tells you honestly.

## Install

```sh
npm install keyboard-inset
```

Or straight from a CDN, no build step, as the `KeyboardInset` global:

```html
<script src="https://unpkg.com/keyboard-inset"></script>
<script>
  KeyboardInset.init();
</script>
```

## Quick start

```html
<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />

<style>
  /* The keyboard-aware footer. */
  .composer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: var(--kb-height, 0px);
    transition: bottom 120ms ease-out;
  }
  /* No transition while the keyboard is animating, or the footer lags behind it. */
  body.kb-open .composer { transition: none; }

  /* The 100vh replacement: --safe-vh is 1% of the visual viewport. */
  .screen { height: calc(var(--safe-vh, 1vh) * 100); }
</style>

<script type="module">
  import { init } from 'keyboard-inset';

  const dispose = init({
    onChange: ({ open, height, source }) => {
      console.log(open ? `keyboard ${height}px via ${source}` : 'keyboard closed');
    },
  });

  // Later, if you need the page back exactly as it was:
  // dispose();
</script>
```

`init()` writes two custom properties on `<html>` and keeps them current:

| Property | Example | Meaning |
| --- | --- | --- |
| `--kb-height` | `336px` | Keyboard height, `0px` when closed |
| `--safe-vh` | `7.31px` | 1% of the visual viewport height |

…and toggles `.kb-open` on `<body>` while the keyboard is up.

## React

```tsx
import { useKeyboardInset } from 'keyboard-inset/react';

function Composer() {
  const { open, height } = useKeyboardInset();

  return (
    <footer style={{ position: 'fixed', bottom: height }}>
      <input placeholder={open ? 'Type…' : 'Tap to type'} />
    </footer>
  );
}
```

The hook starts tracking on the first mount and stops on the last unmount — it is
reference-counted, so any number of components can call it without double-binding
listeners. It subscribes through `useSyncExternalStore` with a server snapshot, so it is
safe under SSR and React 18 strict mode.

```tsx
import { useKeyboardOpen } from 'keyboard-inset/react';

const open = useKeyboardOpen(); // boolean
```

Options are read once, on the mount that starts tracking. Pass them to the top-most
component (or just call `init()` yourself at app start and let components read the state).

## API

### `init(options?): () => void`

Starts tracking and returns a disposer. Calling it again while active tears the previous run
down first, so it never double-binds. On the server it is a no-op that still returns a
working disposer.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `cssVar` | `string` | `'--kb-height'` | Custom property set to the keyboard height, e.g. `"336px"` |
| `vhVar` | `string` | `'--safe-vh'` | Custom property set to 1% of the visual viewport height, e.g. `"7.31px"` |
| `target` | `HTMLElement \| null` | `document.documentElement` | Element the custom properties are set on |
| `bodyClass` | `string \| null` | `'kb-open'` | Class toggled on `document.body` while open; `null` disables it |
| `openThreshold` | `number` | `120` | Pixels of viewport shrink before it counts as open (`visualviewport` source only) |
| `useVirtualKeyboardApi` | `boolean` | `true` | Set `false` to force the `visualViewport` strategy everywhere |
| `restoreScrollOnClose` | `boolean` | `false` | Scroll the window back to the top when the keyboard closes |
| `onChange` | `(state) => void` | — | Called with a fresh snapshot on every change |

### Methods

| Method | Returns | Description |
| --- | --- | --- |
| `init(options?)` | `() => void` | Start tracking; returns a disposer |
| `destroy()` | `void` | Stop tracking and undo everything. Safe to call when idle |
| `getState()` | `KeyboardInsetState` | The current snapshot |
| `subscribe(listener)` | `() => void` | Subscribe to changes; returns an unsubscribe function |
| `isSupported()` | `boolean` | Whether this browser can measure the keyboard at all |
| `isEditableElement(el)` | `boolean` | Whether focusing `el` raises the keyboard. Accepts anything |
| `computeInset(input)` | `{ open, height }` | The pure measurement, exported for testing and custom pipelines |

All of the above are also available as named properties on the default export (and on the
`KeyboardInset` global in the CDN build).

### Events

Every change also dispatches a `CustomEvent` on `window`, so you do not need a module
system to listen:

```js
window.addEventListener('keyboardinset', (event) => {
  console.log(event.detail); // KeyboardInsetState
});
```

The event name is exported as `EVENT_NAME`.

### Types

```ts
type KeyboardInsetSource = 'virtualkeyboard' | 'visualviewport' | 'none';

interface KeyboardInsetState {
  open: boolean;            // keyboard believed to be covering the page
  height: number;           // CSS px, rounded, 0 when closed
  viewportHeight: number;   // visual viewport height, unrounded
  source: KeyboardInsetSource;
}

interface ComputeInsetInput {
  innerHeight: number;
  viewportHeight: number;
  offsetTop: number;
  baseline: number;         // innerHeight measured while nothing was focused
  threshold: number;
  editableFocused: boolean;
}
```

`KeyboardInsetOptions`, `KeyboardInsetState`, `KeyboardInsetSource`, `ComputeInsetInput` and
`ComputeInsetResult` are all exported.

## Browser support

| Browser | Source | Accuracy |
| --- | --- | --- |
| Chrome / Edge on Android 94+ | `virtualkeyboard` | Exact — the browser reports the keyboard rect |
| iOS Safari 13+ / all iOS browsers | `visualviewport` | Exact in practice; derived from `innerHeight - (visualViewport.height + offsetTop)` |
| Firefox for Android | `visualviewport` | Good. Uses the layout-viewport baseline, since Firefox resizes the layout viewport |
| Samsung Internet, Android WebView | `visualviewport` (or `virtualkeyboard` on recent Chromium builds) | Good; depends on the browser's resize behaviour |
| Desktop browsers | either | Reports closed, always — there is no on-screen keyboard to measure |
| IE 11, iOS Safari < 13, Chrome < 61 | `none` | Not supported. `--kb-height` is pinned to `0px`, `isSupported()` returns `false`, and `bottom: var(--kb-height)` behaves exactly like `bottom: 0` |

The `visualviewport` path is inference, not a reported measurement. It is correct for the
open/closed question and accurate to a pixel for the height, but a browser that neither
overlays nor resizes the viewport for its keyboard cannot be detected by anyone, including
this package.

## Recipes

### A chat screen that never loses its composer

```css
.screen   { height: calc(var(--safe-vh, 1vh) * 100); display: flex; flex-direction: column; }
.messages { flex: 1; overflow-y: auto; padding-bottom: calc(var(--kb-height, 0px) + 68px); }
.composer { position: fixed; left: 0; right: 0; bottom: var(--kb-height, 0px); }
```

```js
import { init } from 'keyboard-inset';

init({
  onChange: ({ open }) => {
    // Keep the newest message visible once the keyboard has taken its space.
    if (open) messages.scrollTop = messages.scrollHeight;
  },
});
```

### Hide a bottom tab bar while typing

```css
.tabbar { transform: translateY(0); transition: transform 150ms ease-out; }
body.kb-open .tabbar { transform: translateY(100%); }
```

No JavaScript at all beyond the one `init()` call — `.kb-open` on `<body>` does the work.

### Combine with the home-indicator safe area

`--kb-height` and `env(safe-area-inset-bottom)` solve different problems, and you usually
want both. The safe-area inset should only apply when the keyboard is *closed*, because the
keyboard already covers the home indicator:

```css
.composer {
  bottom: var(--kb-height, 0px);
  padding-bottom: calc(10px + env(safe-area-inset-bottom));
}
body.kb-open .composer { padding-bottom: 10px; }
```

## Gotchas

- **`interactive-widget` in the viewport meta tag changes the platform's behaviour.**
  `interactive-widget=resizes-content` (Chromium) makes the browser shrink the layout
  viewport, which is exactly the case the baseline logic covers — it works, but the browser
  has already reflowed your page, so your fixed footer will move on its own and
  `--kb-height` will be the amount it moved. If you want the package to own that movement,
  use `interactive-widget=overlays-content` (or leave the default `resizes-visual`) and pin
  the footer with `bottom: var(--kb-height)`. Do not do both at once, or the footer moves
  twice.
- **The VirtualKeyboard path needs `overlaysContent = true`.** The package sets it during
  `init()` and restores your previous value in `destroy()`. If your app also sets it, expect
  the package's value to win while it is running. If a webview exposes the object but
  refuses the setter, the package silently falls back to the `visualViewport` strategy —
  `state.source` always tells you which path is live.
- **iOS does not always fire an event when the keyboard is dismissed by the "hide keyboard"
  key** on the keyboard itself (and older versions miss the swipe-down dismissal too). The
  fallback is focus: the package listens for `focusout` on the document, and dismissal blurs
  the field, so the state settles on the next frame. In the rare version where the field
  keeps focus, the visual viewport still resizes and the normal path catches it. If you see
  a stuck value, `blur()` the input yourself on your dismiss handler.
- **A keyboard needs a focused editable element to be believed.** `<select>` pickers, date
  spinners and native share sheets also shrink the viewport, and the package deliberately
  reports those as closed. If you focus something inside a cross-origin `<iframe>`, the
  parent document cannot see it and will report closed as well.
- **iOS zooms the page when you focus an input with `font-size` below 16px.** That zoom
  changes the visual viewport and confuses every keyboard measurement including this one.
  Use `font-size: 16px` on your inputs.
- **Desktop browsers report `open: false` forever.** That is correct — there is no on-screen
  keyboard — but do not use `open` as a "is this a phone" test.
- **`height` is rounded to whole pixels** to avoid subpixel thrash; `viewportHeight` is the
  raw float. Subscribers are notified when the rounded viewport height changes by a pixel or
  more, not on every fractional scroll frame.

## Contributing

```sh
git clone https://github.com/vishalmeena2211/keyboard-inset.git
cd keyboard-inset
npm install
npm run dev      # tsup in watch mode
npm test         # builds, then runs node:test against dist/
```

The demo at `demo/index.html` loads `dist/index.global.js` — run `npm run build`, serve the
folder (`npx serve .`) and open it on a real phone. Simulators do not raise a real keyboard.

## Links

- **Repository** — [github.com/vishalmeena2211/keyboard-inset](https://github.com/vishalmeena2211/keyboard-inset)
- **npm** — [npmjs.com/package/keyboard-inset](https://www.npmjs.com/package/keyboard-inset)
- **Issues & feature requests** — [Report an issue](https://github.com/vishalmeena2211/keyboard-inset/issues)
- **Changelog** — [releases](https://github.com/vishalmeena2211/keyboard-inset/releases)

## License

MIT © Vishal Meena
