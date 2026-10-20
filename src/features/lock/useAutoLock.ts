import { useEffect } from 'react';
import { ACTIVITY_EVENTS, createIdleWatcher } from '../../state';
import { lockNow } from './lockService';

/**
 * Locks the app after `minutes` without a touch (0 = never). A hidden tab does not tick reliably, so the time spent
 * in the background is checked when the tab comes back: away for longer than the limit means locked.
 */
export function useAutoLock(minutes: number, active: boolean): void {
  useEffect(() => {
    if (!active || minutes <= 0) return undefined;
    const limit = minutes * 60_000;
    const watcher = createIdleWatcher({ timeoutMs: limit, onChange: (idle) => idle && lockNow() });
    const poke = (): void => watcher.poke();
    let hiddenAt: number | null = null;
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else {
        if (hiddenAt !== null && Date.now() - hiddenAt >= limit) lockNow();
        hiddenAt = null;
      }
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, poke, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, poke);
      document.removeEventListener('visibilitychange', onVisibility);
      watcher.stop();
    };
  }, [minutes, active]);
}
