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

#### Layout.tsx (outer shell)

- Outer container: `height: 100vh, overflow: hidden`
  Constrains the entire application to the viewport height and prevents a browser-level scrollbar from appearing.
- Inner flex row: `flexGrow: 1, minHeight: 0`
  The `minHeight: 0` is critical. Without it, flex children refuse to shrink below their content size. This causes the main content area's `overflow: auto` to never activate, since the container always grows to fit its children.
- Main content area: `overflow: auto`
  Enables page-level scrolling for non-terminal pages such as the home page and session list.

#### TerminalView.tsx (xterm container)

- Container: `width: 100%, height: 100%`
  Must not include `overflow: hidden`. Adding it blocks xterm.js from handling scroll events internally.
- `.xterm`: `height: 100%, padding: 4px, boxSizing: border-box`
  The `border-box` sizing prevents the padding from pushing the element beyond the parent's height boundary.

#### TerminalPage.tsx (terminal page wrapper)

- Outer: `height: calc(100vh - 64px), m: -3, overflow: hidden`
  Fills the viewport below the AppBar and prevents page-level scroll on the terminal page.
- Terminal wrapper: `flexGrow: 1, minHeight: 0`
  Must not include `overflow: hidden`. This lets xterm.js manage its own internal scroll.

### Touch Scrolling on Tablets

Touch devices such as tablets do not generate `WheelEvent` from swipe gestures. A finger swipe on a touch screen produces `touchstart`, `touchmove`, and `touchend` events instead. xterm.js's scroll path relies on `WheelEvent` (via the `handleWheel` method), so touch input is silently ignored without additional handling.

The `useTouchScroll` hook at `apps/web/src/hooks/useTouchScroll.ts` bridges this gap. It attaches touch event listeners to the terminal container and converts single-finger vertical swipe gestures into synthetic `WheelEvent` instances, which are then dispatched directly to the `.xterm-viewport` element. From that point forward, the event travels through xterm.js's existing `handleWheel` method exactly as a mouse wheel event would on a desktop browser. xterm.js computes the scroll position, sends the appropriate escape sequences to tmux over the WebSocket, and tmux streams back history content for rendering.

Key implementation details:

- **Sensitivity multiplier of 2.0** maps raw finger swipe distances (in CSS pixels) to scroll amounts that feel natural at typical reading speeds. Adjusting this value changes how far the terminal scrolls per unit of finger movement.
- **2px minimum movement threshold** filters out incidental tap noise. Touch events fire even when a finger barely moves; without this threshold, accidental micro-movements register as scroll gestures.
- **`touch-action: none`** CSS is applied to the terminal container element. This instructs the browser to skip its built-in touch handling (pull-to-refresh, native momentum scrolling, panning) for that element and deliver raw touch events to JavaScript handlers instead. This property must be on the container element that receives the hook's event listeners, not on `.xterm-viewport` itself.

The synthetic `WheelEvent` dispatched by the hook follows the same path as a real wheel event, so tmux mouse mode (`set-option mouse on`) remains the mechanism that performs the actual scrollback. Touch scrolling does not introduce a separate scroll path; it only provides the missing event translation layer between the touch API and the wheel API that xterm.js already handles.

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
If the terminal element is hidden (via `display: none`, `visibility: hidden`, or being detached from the DOM), `offsetParent` returns `null` and xterm.js silently skips scroll events. This can cause scroll to appear broken when a terminal tab is rendered but not visible.

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
| `apps/web/src/components/common/Layout.tsx` | Page layout with scroll chain constraints |
| `apps/web/src/pages/TerminalPage.tsx` | Terminal page layout |
| `apps/web/src/pages/TerminalFullPage.tsx` | Full-screen terminal layout |
| `apps/web/src/hooks/useTerminal.ts` | xterm.js initialization including `scrollback: 5000` |
| `apps/web/src/hooks/useTouchScroll.ts` | Touch-to-wheel conversion for tablet scrolling |

## Related xterm.js Source References

For deeper investigation, the relevant xterm.js source files are:

- `src/browser/Viewport.ts` — `handleWheel`, `_handleScroll`, scroll area sizing
- `src/browser/services/RenderService.ts` — canvas rendering on scroll
- `src/common/buffer/Buffer.ts` — `hasScrollback` property definition
