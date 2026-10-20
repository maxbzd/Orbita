import { useEffect, useState } from 'react';

/**
 * Keeps a layer mounted while it animates out. `shown` flips one frame after mounting, so the CSS
 * transition has a closed state to start from. Timers only: it works without animation events.
 */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; shown: boolean } {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: FrameRequestCallback) => window.setTimeout(cb, 16);
      const cancel = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : window.clearTimeout;
      // Two frames: the closed state must be painted before the open state is applied.
      let second = 0;
      const first = raf(() => {
        second = raf(() => setShown(true));
      });
      return () => {
        cancel(first);
        cancel(second);
      };
    }
    setShown(false);
    const timer = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [open, exitMs]);

  return { mounted: mounted || open, shown: shown && open };
}
