import { hoursCount, minutesCount, secondsCount } from '../../domain/counts';

/** Whole non-negative seconds; NaN, Infinity and negative values become 0. */
export function wholeSeconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
}

export interface ClockOptions {
  /**
   * Zero-pad the minutes ("02:14", the recording header) or not ("2:14", the player). Hours are never
   * padded. Default true.
   */
  pad?: boolean;
}

/** 134 -> "02:14", 3725 -> "1:02:05". */
export function formatClock(seconds: number, { pad = true }: ClockOptions = {}): string {
  const total = wholeSeconds(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${pad ? String(m).padStart(2, '0') : m}:${ss}`;
}

/** ISO 8601 duration for <time dateTime>: 134 -> "PT2M14S". */
export function isoDuration(seconds: number): string {
  const total = wholeSeconds(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s || (!h && !m) ? `${s}S` : ''}`;
}

/** The duration as a screen reader should say it: 134 -> "2 minutes 14 seconds". */
export function spokenDuration(seconds: number): string {
  const total = wholeSeconds(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(hoursCount(h));
  if (m) parts.push(minutesCount(m));
  if (s || parts.length === 0) parts.push(secondsCount(s));
  return parts.join(' ');
}
