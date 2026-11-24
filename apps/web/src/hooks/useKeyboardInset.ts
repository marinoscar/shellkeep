import { useEffect, useState } from 'react';

/** Below this many covered pixels there is no on-screen keyboard (a toolbar or rounding). */
export const KEYBOARD_INSET_MIN = 75;

/**
 * Pixels at the bottom of the layout viewport covered by the on-screen keyboard
 * right now, read from the VisualViewport API: 0 when there is no keyboard or
 * the API is unavailable. The synchronous form of `useKeyboardInset`, for
 * event handlers that must decide in the same task (#170).
 */
export function readKeyboardInset(): number {
  if (typeof window === 'undefined') return 0;
  const vv = window.visualViewport;
  if (!vv) return 0;
  const bottom = window.innerHeight - (vv.height + vv.offsetTop);
  return bottom > KEYBOARD_INSET_MIN ? Math.round(bottom) : 0;
}

/**
 * Pixels at the bottom of the layout viewport currently covered by the
 * on-screen keyboard, derived from the VisualViewport API. 0 when there is
 * no keyboard or the API is unavailable (desktop, older browsers).
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => setInset(readKeyboardInset());

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
