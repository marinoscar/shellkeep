# Terminal Scrolling Architecture

This document explains how terminal scrolling works in ShellKeep and documents the key constraints that must be preserved. Future developers who encounter scroll issues should read this before making changes to terminal layout or CSS.

## Stack Overview

ShellKeep uses xterm.js (v5.5.0) for terminal emulation in the browser. Each terminal connects via WebSocket to a tmux session running on a remote server over SSH. The scroll behavior is a product of three interacting layers: tmux on the server, WebSocket transport, and xterm.js in the browser.

## How Terminal Scrolling Works

### The tmux Alternate Buffer Problem

When tmux attaches to a client, the terminal switches to the **alternate screen buffer**. The alternate buffer has **zero scrollback**. This is a fundamental property of the alternate screen and cannot be changed at the xterm.js level.

xterm.js checks `buffer.hasScrollback` before deciding how to handle scroll wheel events. When this property is `false` (alternate buffer active), xterm.js converts wheel events into up/down arrow key sequences and sends them to the terminal instead of scrolling the viewport. The result: the xterm.js native scrollbar is present in the DOM (due to `overflow-y: scroll` on `.xterm-viewport`) but is non-functional.

The correct fix is tmux's built-in mouse support. Setting `set-option mouse on` in tmux causes tmux itself to capture mouse wheel events and scroll through its own history buffer. ShellKeep configures this when launching tmux, along with a `history-limit` of 50,000 lines.

This is applied in `apps/api/src/terminal/ssh.service.ts` as part of the tmux launch command.

### xterm.js Scroll Mechanism

xterm.js manages scrolling entirely in JavaScript, not through native CSS scroll. Understanding this is critical for anyone modifying the layout.

The relevant xterm.js internals (from `Viewport.ts` in the xterm.js source):

- `.xterm-viewport` is an absolutely positioned element inside `.xterm` with `overflow-y: scroll`
- `.xterm-scroll-area` is an invisible spacer element inside `.xterm-viewport` whose height is set dynamically to represent the total scrollable content
- Wheel events on `.xterm-viewport` are handled by the `handleWheel` method in the `Viewport` class, which calculates scroll position and updates the canvas render — native browser scroll does not occur
- The `_handleScroll` method checks `this._viewportElement.offsetParent` before processing scroll. If this value is `null` (meaning the element is hidden or detached), the scroll event is silently dropped

Because xterm.js intercepts scroll at the JavaScript level, any CSS that prevents the element from receiving events or causes it to be considered hidden will break scrolling.

### CSS Layout Requirements

The scroll chain in ShellKeep spans multiple React components. The following constraints must be preserved.

#### The platform shell (`Layout.tsx`, since #76)

`components/common/Layout.tsx` binds the platform's `ShellLayout` (`@marinoscar/platform-web/shell/ui`), which owns the viewport height: its root is a column with `min-height: 100dvh` (`100vh` fallback), the AppBar on top, then the rail (at `sm` and up) and `<main>`, and the bottom bar below `sm`. Ordinary pages scroll with the document. `<main>` keeps `pb: { xs: 10, sm: 3 }` in both variants, so a page always clears the phone bottom bar (gate 3 of the five breakpoint gates; never change it from the app).

#### The component tree (since #77)

The terminal workspace at `/sessions/:id` is one chain from the shell's `<main>` to the xterm host. Every element on it keeps `minHeight: 0` where it is a flex container or a flex item, and none has `overflow: hidden`:

```
ShellLayout <main>                     full-bleed: flex column (useShellMainVariant('full-bleed'))
└─ TerminalWorkspacePage root          flex: 1, minHeight: 0, position: relative
   └─ frame                            position: absolute, top/left/right 0, bottom = key dock offset;
      │                                flex column, minHeight: 0
      ├─ WorkspaceTabs, toolbar        flexShrink: 0
      ├─ body                          display: flex (row), flex: 1, minHeight: 0, minWidth: 0
      │  ├─ SplitLayout area           flex: 1, minHeight: 0, minWidth: 0, position: relative
      │  │  └─ pane (one per open tab) position: absolute; flex column, minHeight: 0
      │  │     ├─ pane header          only while split; outside the FitAddon host
      │  │     └─ pane host            flex: 1, minHeight: 0, position: relative
      │  │        └─ TerminalView      width/height 100%, position: relative
      │  │           └─ xterm host     width/height 100%, touch-action: none (FitAddon measures this)
      │  └─ TerminalAiPanel            md and up, when AI is available; a sibling of the panes
      ├─ TerminalStatusBar             flexShrink: 0: the bottom gutter, outside the FitAddon host
      └─ key dock                      flexShrink: 0, LAST in the frame: TerminalKeyShortcutsBar
```

`__tests__/pages/TerminalWorkspace.workspace.test.tsx` walks this chain from every xterm host up to `<main>` and fails on a missing `minHeight: 0` or an `overflow: hidden`.

#### TerminalWorkspacePage.tsx (`/sessions/:id`)

- `useShellMainVariant('full-bleed')`: `<main>` drops its side and top padding and the banners, and becomes a flex column. Gate 3's bottom padding stays: the page sits above the phone bottom bar.
- Root: `flex: 1, minHeight: 0, position: relative`. Takes exactly the space `<main>` leaves under the AppBar. Nothing inside it is in flow, so the terminal can never size the page from its own rows and the document never scrolls. No negative margins, and no height computed from the AppBar.
- Frame: absolutely positioned, a flex column. Its `bottom` is the key dock offset: `useKeyboardInset()` minus the space the page already ends above the layout viewport's bottom (`keyDockOffset`), so the key shortcuts bar, the frame's last child, sits directly on top of the on-screen keyboard and nothing above it moves when the keyboard opens.

#### SplitLayout.tsx (the panes)

- Every open tab keeps its pane mounted (its xterm and its WebSocket). A pane on screen is positioned in its slot (the whole area, or one side of the divider); a pane off screen keeps the whole area's size, `visibility: hidden` and a far negative `left`. Never `display: none`: its `offsetParent` stays non-null (see Common Pitfalls), and when it comes back the debounced `ResizeObserver` of `useTerminal` fits it to its slot and sends `resize`.
- Pane host: `flex: 1, minHeight: 0, position: relative`. Must not include `overflow: hidden`.
- On a phone (below `sm`) only the active pane is on screen; a split in the URL waits for a wider screen.

#### TerminalView.tsx (xterm container)

- Container: `width: 100%, height: 100%`, `touch-action: none`
  Must not include `overflow: hidden`. Adding it blocks xterm.js from handling scroll events internally.
- `.xterm`: `height: 100%, padding: 4px, boxSizing: border-box`
  The `border-box` sizing prevents the padding from pushing the element beyond the parent's height boundary.

### Touch Scrolling on Tablets

Touch devices such as tablets do not generate `WheelEvent` from swipe gestures. A finger swipe on a touch screen produces `touchstart`, `touchmove`, and `touchend` events instead. xterm.js's scroll path relies on `WheelEvent` (via the `handleWheel` method), so touch input is silently ignored without additional handling.

The `useTouchScroll` hook at `apps/web/src/hooks/useTouchScroll.ts` bridges this gap. It attaches touch event listeners to the terminal container and converts single-finger vertical swipe gestures into synthetic `WheelEvent` instances, which are then dispatched directly to the `.xterm-viewport` element. From that point forward, the event travels through xterm.js's existing `handleWheel` method exactly as a mouse wheel event would on a desktop browser. xterm.js computes the scroll position, sends the appropriate escape sequences to tmux over the WebSocket, and tmux streams back history content for rendering.

Key implementation details:

- **Sensitivity multiplier of 2.0** maps raw finger swipe distances (in CSS pixels) to scroll amounts that feel natural at typical reading speeds. Adjusting this value changes how far the terminal scrolls per unit of finger movement.
- **2px minimum movement threshold** filters out incidental tap noise. Touch events fire even when a finger barely moves; without this threshold, accidental micro-movements register as scroll gestures.
- **`touch-action: none`** CSS is applied to the terminal container element. This instructs the browser to skip its built-in touch handling (pull-to-refresh, native momentum scrolling, panning) for that element and deliver raw touch events to JavaScript handlers instead. This property must be on the container element that receives the hook's event listeners, not on `.xterm-viewport` itself.

The synthetic `WheelEvent` dispatched by the hook follows the same path as a real wheel event, so tmux mouse mode (`set-option mouse on`) remains the mechanism that performs the actual scrollback. Touch scrolling does not introduce a separate scroll path; it only provides the missing event translation layer between the touch API and the wheel API that xterm.js already handles.

## Tablet Hardening

The following changes landed together to improve reliability on tablet (primarily iPad/WebKit) where layout and input assumptions differ from desktop browsers.

### Floating scroll buttons

A floating up/down button pair renders in the bottom-right corner of the terminal when the per-user setting `terminal.showScrollButtons` is `true` (the default). Tapping a button sends one synthetic `WheelEvent`; holding the button begins continuous scroll after a 300 ms initial delay, repeating at ~70 ms intervals. The toolbar exposes an unfold-more/unfold-less icon to toggle the buttons; the choice persists in user settings across sessions.

Implemented in `apps/web/src/components/terminal/TerminalScrollButtons.tsx`. The component calls the same `dispatchXtermScroll` helper at `apps/web/src/utils/dispatchXtermScroll.ts` that `useTouchScroll` uses, so both paths share the same synthetic-WheelEvent dispatch and go through xterm.js's existing `handleWheel` method.

### xterm metrics pinned

`apps/web/src/hooks/useTerminal.ts` now sets `letterSpacing: 0` and `lineHeight: 1` explicitly on initialization. WebKit's default font metrics differ subtly from what xterm.js's row-height math assumes; leaving these at browser defaults caused per-cell positioning to drift on tablet, with the caret visibly offset from the rendered glyph. Pinning both values makes the measurements deterministic across engines.

### Debounced ResizeObserver fit

The ResizeObserver callback in `useTerminal.ts` now debounces `fitAddon.fit()` calls by ~100 ms. On tablet, showing or hiding the virtual keyboard produces a rapid burst of resize events as the viewport height animates. Calling `fit()` mid-burst recalculated row count against an intermediate height, producing pixel-level row desync. Debouncing absorbs the burst and calls `fit()` once after layout settles.

### Bottom gutter moved outside the FitAddon host

The former `TerminalPage.tsx` and `TerminalFullPage.tsx` (replaced by the workspace in #77) previously applied `pb: '30px'` to the terminal wrapper Box. Because FitAddon measures `clientHeight` of its host element, that padding was included in the height used to compute row count, leaving 30 px of space that xterm.js allocated rows into but the visible glyph area never reached. The result was sub-pixel row drift visible as a cursor-glyph mismatch.

The gutter is now a sibling `<Box sx={{ height: '30px', flexShrink: 0 }} />` rendered below the terminal container, so the FitAddon-measured host height equals the actual glyph area.

In the workspace (#77) the terminal status bar takes the gutter's place: it is a sibling below the panes, outside every FitAddon host, so the same rule holds.

## Common Pitfalls

**Never add `overflow: hidden` to the xterm container or its immediate parent.**
xterm.js relies on JavaScript event handling for scroll. `overflow: hidden` does not prevent events from reaching the element, but previous attempts to set `overflow: hidden !important` on `.xterm-viewport` broke scrolling entirely because it interfered with xterm's internal scroll area sizing.

**Always include `minHeight: 0` on flex containers in the scroll chain.**
Without this, flex items will not shrink below their intrinsic content size. This causes parent containers to grow unboundedly, defeating any `overflow: auto` or `overflow: hidden` rules further up the tree.

**tmux mouse mode is required for scrolling to work.**
Without `set-option mouse on`, scroll wheel input in the browser is converted to arrow key sequences. Users will see the cursor move through the terminal output rather than the viewport scrolling. This setting is applied at session creation. Existing sessions that were created before the setting was added require a reconnect.

**Do not override `.xterm-viewport` CSS.**
xterm.js manages this element's scroll behavior entirely through JavaScript. Overriding its `overflow`, `height`, or scroll-related properties can break the scroll area sizing calculations inside xterm.js.

**`touch-action: none` is required on the terminal container for touch devices.**
Without it, the browser intercepts touch gestures for native scrolling/panning before JavaScript handlers can process them. This CSS property must be on the container element, not on `.xterm-viewport`.

**`offsetParent` must not be null during scroll.**
If the terminal element or an ancestor is `display: none`, or the element is detached from the DOM, `offsetParent` returns `null` and xterm.js silently skips scroll events. This can cause scroll to appear broken when a terminal tab is rendered but not visible. `visibility: hidden` does NOT null `offsetParent`, which is why the workspace hides an inactive tab with `visibility: hidden` and an off-screen position, never `display: none`.

## Scrollback Chain

Scroll history exists at multiple layers:

| Layer | Location | Capacity |
|---|---|---|
| Server history | tmux `history-limit` | 50,000 lines |
| Transport | WebSocket binary stream | In-flight only |
| Client buffer | xterm.js `scrollback` option | 5,000 lines |
| User viewport | xterm.js rendered canvas | Visible rows |

The tmux history buffer is authoritative. When mouse mode is active, scrolling in the browser sends tmux scroll commands over the WebSocket, and tmux streams the historical content back to xterm.js for rendering. The xterm.js local scrollback buffer (`scrollback: 5000` in `useTerminal.ts`) provides a client-side cache for recently received lines.

## Key Files

| File | Role |
|---|---|
| `apps/api/src/terminal/ssh.service.ts` | Launches tmux with `mouse on` and `history-limit 50000` |
| `apps/web/src/components/terminal/TerminalView.tsx` | xterm.js container and styling |
| `apps/web/src/components/common/Layout.tsx` | Binds the platform shell (`<main>`, the start of the chain) |
| `apps/web/src/pages/TerminalWorkspacePage.tsx` | The workspace frame, the key dock offset |
| `apps/web/src/components/terminal/workspace/SplitLayout.tsx` | The panes: slots, hidden tabs, the divider |
| `apps/web/src/hooks/useTerminal.ts` | xterm.js initialization including `scrollback: 5000` |
| `apps/web/src/hooks/useTouchScroll.ts` | Touch-to-wheel conversion for tablet scrolling |

## Related xterm.js Source References

For deeper investigation, the relevant xterm.js source files are:

- `src/browser/Viewport.ts` — `handleWheel`, `_handleScroll`, scroll area sizing
- `src/browser/services/RenderService.ts` — canvas rendering on scroll
- `src/common/buffer/Buffer.ts` — `hasScrollback` property definition
