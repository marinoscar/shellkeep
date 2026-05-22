import { useEffect, useState } from 'react';

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

    const update = () => {
      const bottom = window.innerHeight - (vv.height + vv.offsetTop);
      setInset(bottom > 75 ? Math.round(bottom) : 0);
    };

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
