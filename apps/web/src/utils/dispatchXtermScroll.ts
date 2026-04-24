export function dispatchXtermScroll(
  container: HTMLElement | null,
  deltaY: number,
  coords?: { clientX: number; clientY: number },
): void {
  if (!container) return;

  const viewport = container.querySelector('.xterm-viewport');
  if (!viewport) return;

  const { clientX, clientY } = coords ?? (() => {
    const rect = viewport.getBoundingClientRect();
    return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  })();

  viewport.dispatchEvent(
    new WheelEvent('wheel', {
      deltaY,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
    }),
  );
}
