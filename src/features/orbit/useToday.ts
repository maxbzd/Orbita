import { useEffect, useState } from 'react';
import { localDayKey, localMinutesOfDay } from '../../domain/dates';
import type { DayKey } from '../../domain/types';

/** The local day and the minute of day, refreshed every 30 s so the screen turns over at midnight. */
export function useToday(): { today: DayKey; minutes: number } {
  const read = () => {
    const now = new Date();
    return { today: localDayKey(now), minutes: localMinutesOfDay(now) };
  };
  const [state, setState] = useState(read);
  useEffect(() => {
    const id = window.setInterval(() => setState(read()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return state;
}
