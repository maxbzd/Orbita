import { useEffect, useState } from 'react';

/**
 * The current time, refreshed every minute and whenever the tab becomes visible again, so the greeting,
 * the "now" dot on the day ring and the day itself (past midnight) stay right without a reload.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = (): void => setNow(new Date());
    const timer = window.setInterval(tick, intervalMs);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
  return now;
}
