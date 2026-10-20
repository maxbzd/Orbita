import { diffDays, localDayKey, localMinutesOfDay, relativeDay } from '../../domain/dates';
import { t, tn } from '../../i18n';
import { truncate } from '../../domain/text';
import type { Capture, CheckIn, Item, ItemKind } from '../../domain/types';
import { EMPTY_DAY_COUNTS, dayVerdict } from '../../lib/verdict';
import type { DayCounts } from '../../lib/verdict';
import { moodWord } from '../../ui';
import type { DayOrbitEntry, DayOrbitSatellite, TypeKind } from '../../ui';
import type { TodaySnapshot } from './snapshot';

/** At most this many rows in "Горит сегодня". */
export const MAX_BURNING_ROWS = 3;

export type BurningKind = 'commitment' | 'prediction' | 'decision';

export interface BurningRow {
  id: string;
  kind: BurningKind;
  title: string;
  /** Who and what: "Ты обещал · Анна", "Прогноз · 70 %". */
  subtitle: string;
  /** When: "просрочено на 2 дня", "сегодня". */
  meta: string;
  overdue: boolean;
}

export interface TodayModel {
  verdict: string;
  counts: DayCounts;
  /** Mood of the day on the −3…+3 scale; null while there is no check-in. */
  mood: number | null;
  /** The same on −1…+1, for the aura. */
  auraMood: number | null;
  moodLabel: string | null;
  entries: DayOrbitEntry[];
  satellites: DayOrbitSatellite[];
  burning: BurningRow[];
  /** Everything that burns, `burning` shows the first few. */
  burningCount: number;
  peopleCount: number;
  /** Check-ins the AI suggested and the user has not yet answered. */
  suggested: CheckIn[];
  /** The latest check-in of the day that counts (manual or confirmed). */
  latestCheckIn: CheckIn | null;
  /** No record exists at all: the screen shows the first-run emptiness. */
  isFresh: boolean;
}

/** More specific kinds win when a record produced several objects. */
const KIND_PRIORITY: readonly ItemKind[] = ['decision', 'commitment', 'prediction', 'idea', 'task', 'question', 'lesson', 'fact'];

function dominantKind(items: readonly Item[]): TypeKind | null {
  const kinds = new Set(items.map((item) => item.kind));
  return KIND_PRIORITY.find((kind) => kinds.has(kind)) ?? null;
}

function captureLabel(capture: Capture): string {
  const title = capture.title?.trim();
  if (title) return truncate(title, 60);
  const text = capture.text.trim();
  return text ? truncate(text, 60) : t('Record');
}

/** The state counts for the planet and the aura only when the user stood behind it. */
export function countsForMood(checkIn: CheckIn): boolean {
  return checkIn.origin !== 'ai_suggested';
}

/** "просрочено на 2 дня" / "сегодня" / "завтра" / "через 4 дня": lateness is said in words, not only in red. */
export function dueLabel(dueAt: string, today: string): { text: string; overdue: boolean } {
  const dueDay = localDayKey(dueAt);
  if (dueDay < today) {
    const late = diffDays(dueDay, today);
    return { text: tn(late, 'overdue by {n} day', 'overdue by {n} days'), overdue: true };
  }
  return { text: relativeDay(dueDay, today), overdue: false };
}

function commitmentSubtitle(item: TodaySnapshot['commitments'][number], names: TodaySnapshot['peopleNames']): string {
  const who = item.counterpartyId ? names[item.counterpartyId] : item.counterpartyName;
  const head = item.direction === 'i_owe' ? t('You promised') : t('Owed to you');
  return who ? `${head} · ${who}` : head;
}

/** Turns the loaded data into everything the screen draws. Pure: the day is part of the snapshot. */
export function buildTodayModel(snapshot: TodaySnapshot): TodayModel {
  const { day } = snapshot;

  // Mood of the day: the mean of the check-ins the user stands behind.
  const counted = snapshot.checkIns.filter(countsForMood);
  const valence = counted.length === 0 ? null : counted.reduce((sum, checkIn) => sum + checkIn.valence, 0) / counted.length;
  const mood = valence === null ? null : valence * 3;
  const suggested = snapshot.checkIns.filter((checkIn) => !countsForMood(checkIn));

  // Satellites and the burning list.
  const satellites: DayOrbitSatellite[] = snapshot.commitments.map((item) => {
    const due = item.dueAt ? dueLabel(item.dueAt, day) : null;
    return { id: item.id, title: item.title, overdue: due?.overdue ?? false, ...(due && { dueLabel: due.text }) };
  });

  const overdueMine = snapshot.commitments.filter((item) => item.direction === 'i_owe' && item.dueAt !== undefined && localDayKey(item.dueAt) < day).length;

  const overdueRows: BurningRow[] = [];
  const todayRows: BurningRow[] = [];
  for (const item of snapshot.commitments) {
    if (!item.dueAt) continue;
    const due = dueLabel(item.dueAt, day);
    const row: BurningRow = { id: item.id, kind: 'commitment', title: item.title, subtitle: commitmentSubtitle(item, snapshot.peopleNames), meta: due.text, overdue: due.overdue };
    if (due.overdue) overdueRows.push(row);
    else if (localDayKey(item.dueAt) === day) todayRows.push(row);
  }
  // Mine first: a promise I made is more urgent than one made to me.
  const mineFirst = (rows: BurningRow[]): BurningRow[] => {
    const owe = new Set(snapshot.commitments.filter((item) => item.direction === 'i_owe').map((item) => item.id));
    return [...rows.filter((row) => owe.has(row.id)), ...rows.filter((row) => !owe.has(row.id))];
  };

  const predictionRows: BurningRow[] = snapshot.predictions.map((item) => ({
    id: item.id,
    kind: 'prediction',
    title: item.title,
    subtitle: t('Prediction · {round} %', { round: Math.round(item.probability * 100) }),
    meta: item.dueAt ? t('due: {relativeDay}', { relativeDay: relativeDay(localDayKey(item.dueAt), day) }) : t('time to close'),
    overdue: false,
  }));
  const decisionRows: BurningRow[] = snapshot.decisions.map((item) => ({
    id: item.id,
    kind: 'decision',
    title: item.title,
    subtitle: t('Decision · how did it turn out?'),
    meta: t('review', undefined, 'model'),
    overdue: false,
  }));
  const allBurning = [...mineFirst(overdueRows), ...mineFirst(todayRows), ...predictionRows, ...decisionRows];

  // Records on the ring: captures coloured by what they produced, plus check-ins written without a record.
  const itemsByCapture = new Map<string, Item[]>();
  for (const item of snapshot.items) {
    if (!item.captureId) continue;
    const list = itemsByCapture.get(item.captureId) ?? [];
    list.push(item);
    itemsByCapture.set(item.captureId, list);
  }
  const entries: DayOrbitEntry[] = snapshot.captures.map((capture) => ({
    id: capture.id,
    minutes: localMinutesOfDay(capture.createdAt),
    kind: dominantKind(itemsByCapture.get(capture.id) ?? []) ?? (capture.kind === 'checkin' ? 'state' : 'fact'),
    label: captureLabel(capture),
  }));
  for (const checkIn of counted) {
    if (checkIn.captureId) continue;
    entries.push({ id: `checkin:${checkIn.id}`, minutes: localMinutesOfDay(checkIn.at), kind: 'state', label: t('State: {toLowerCase}', { toLowerCase: moodWord(checkIn.valence * 3).toLowerCase() }) });
  }

  const counts: DayCounts = {
    ...EMPTY_DAY_COUNTS,
    captures: snapshot.captures.length,
    decisions: snapshot.items.filter((item) => item.kind === 'decision').length,
    ideas: snapshot.items.filter((item) => item.kind === 'idea').length,
    overdue: overdueMine,
  };

  const people = new Set<string>();
  for (const capture of snapshot.captures) for (const id of capture.personIds) people.add(id);

  const isFresh =
    snapshot.recordsTotal === 0 && snapshot.captures.length === 0 && snapshot.checkIns.length === 0 && snapshot.commitments.length === 0 && snapshot.predictions.length === 0 && snapshot.decisions.length === 0;

  return {
    verdict: dayVerdict(counts, day),
    counts,
    mood,
    auraMood: valence,
    moodLabel: mood === null ? null : moodWord(mood),
    entries,
    satellites,
    burning: allBurning.slice(0, MAX_BURNING_ROWS),
    burningCount: allBurning.length,
    peopleCount: people.size,
    suggested,
    latestCheckIn: counted[counted.length - 1] ?? null,
    isFresh,
  };
}
