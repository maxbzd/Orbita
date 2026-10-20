import { localDayKey } from '../../domain/dates';
import type { Capture, CheckIn, DayKey } from '../../domain/types';
import { pick } from '../../i18n';
import { captureCheckIns as authoredCheckIns, checkinNotes, checkinTags, STORY_BEATS } from './content/checkins';
import { ids } from './context';
import type { SeedContext } from './context';
import { createRng, hashString } from './random';
import { plusMinutes } from './time';

/** Share of ordinary days with a check-in. */
const CHECKIN_DAY_PROBABILITY = 0.74;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const round2 = (value: number): number => Math.round(value * 100) / 100;
const pad = (value: number): string => String(value).padStart(2, '0');

/** How close a day is to the nearest of the listed days: 1 on the day itself, fading over `scale` days. */
function nearness(days: readonly number[], d: number, scale: number): number {
  return Math.min(1, days.reduce((sum, other) => sum + Math.exp(-Math.abs(other - d) / scale), 0));
}

const isShortNight = (d: number): boolean => STORY_BEATS.shortNights.some(([from, to]) => d <= from && d >= to);

/** Check-ins written next to captures: manual notes and states the AI read out of them. */
function captureCheckIns(ctx: SeedContext, captures: readonly Capture[]): CheckIn[] {
  const byId = new Map(captures.map((capture) => [capture.id, capture]));
  const now = ctx.clock.now.getTime();
  const result: CheckIn[] = [];
  for (const spec of authoredCheckIns()) {
    const capture = byId.get(ids.capture(spec.cap));
    if (!capture) continue;
    const at = new Date(Math.min(new Date(plusMinutes(capture.createdAt, spec.after ?? 1)).getTime(), now - 60_000)).toISOString();
    const checkIn: CheckIn = {
      id: ids.checkin(`cap:${spec.cap}`),
      createdAt: at,
      updatedAt: at,
      isDemo: true,
      at,
      day: localDayKey(at),
      valence: spec.valence,
      energy: spec.energy,
      tags: [...spec.tags],
      captureId: capture.id,
      origin: spec.origin,
    };
    if (spec.focus !== undefined) checkIn.focus = spec.focus;
    if (spec.stress !== undefined) checkIn.stress = spec.stress;
    if (spec.sleepHours !== undefined) checkIn.sleepHours = spec.sleepHours;
    if (spec.note) checkIn.note = spec.note;
    result.push(checkIn);
  }
  return result;
}

/**
 * One generated check-in for day `d` ago. The state follows the story: pressure before deadlines lowers
 * mood and raises stress, short nights cost energy and focus, good news lifts everything. Each day has
 * its own random stream, so a day looks the same whatever the length of the window.
 */
function generatedCheckIn(ctx: SeedContext, d: number, day: DayKey): CheckIn | undefined {
  const rng = createRng(hashString(`checkin-day:${d}`));
  if (!rng.chance(CHECKIN_DAY_PROBABILITY)) return undefined;

  const pressure = nearness(STORY_BEATS.deadlines, d, 1.5);
  const win = nearness(STORY_BEATS.wins, d, 1.2);
  const short = isShortNight(d);
  const sleep = Math.round((short ? 4.2 + rng.float(0, 1.3) : 6.6 + rng.float(0, 1.6)) * 2) / 2;

  const stress = clamp(0.28 + 0.38 * pressure + (sleep < 5.5 ? 0.12 : 0) + 0.08 * rng.gaussian() - 0.08 * win, 0.05, 0.95);
  const energy = clamp(0.55 + 0.07 * (sleep - 6.5) - 0.18 * stress + 0.12 * win + 0.07 * rng.gaussian(), 0.1, 0.95);
  const valence = clamp(0.12 + 0.45 * win - 0.55 * (stress - 0.3) + 0.05 * (sleep - 6.5) + 0.1 * rng.gaussian(), -0.9, 0.95);
  const focus = clamp(0.58 + 0.06 * (sleep - 6.5) - 0.25 * (stress - 0.3) + 0.08 * rng.gaussian(), 0.1, 0.95);

  const slot = rng.next();
  const [from, to] = slot < 0.5 ? [8 * 60, 10 * 60 + 30] : slot < 0.7 ? [13 * 60 + 30, 16 * 60 + 30] : [20 * 60 + 30, 23 * 60];
  const minutes = rng.int(from, to);
  // Evening entries do not say how the night went; morning and lunchtime ones do.
  const reportsSleep = slot < 0.7;
  const at = ctx.clock.local(day, `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`).toISOString();

  const mood = short ? 'poorSleep' : pressure > 0.5 ? 'pressure' : win > 0.5 ? 'good' : 'neutral';
  const sleepTag = pick('sleep', 'сон');
  const tags: string[] = mood === 'neutral' ? [rng.pick(checkinTags().neutral)] : [...checkinTags()[mood]];
  if (sleep < 6 && !tags.includes(sleepTag)) tags.push(sleepTag);
  const note = rng.chance(0.4) ? rng.pick(checkinNotes()[mood]) : undefined;

  const checkIn: CheckIn = {
    id: ids.checkin(`day:${d}`),
    createdAt: at,
    updatedAt: at,
    isDemo: true,
    at,
    day,
    valence: round2(valence),
    energy: round2(energy),
    focus: round2(focus),
    stress: round2(stress),
    tags,
    origin: 'manual',
  };
  if (reportsSleep) checkIn.sleepHours = sleep;
  if (note) checkIn.note = note;
  return checkIn;
}

/** Check-ins for the window, oldest first. Today and the days that already have a capture-bound one are left alone. */
export function buildCheckIns(ctx: SeedContext, captures: readonly Capture[]): CheckIn[] {
  const bound = captureCheckIns(ctx, captures);
  const taken = new Set(bound.map((checkIn) => checkIn.day));
  const generated: CheckIn[] = [];
  for (let d = ctx.days - 1; d >= 1; d -= 1) {
    const day = ctx.clock.day(d);
    if (taken.has(day)) continue;
    const checkIn = generatedCheckIn(ctx, d, day);
    if (checkIn) generated.push(checkIn);
  }
  return [...bound, ...generated].sort((a, b) => a.at.localeCompare(b.at));
}
