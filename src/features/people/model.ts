import { diffDays, formatDayShort, localDayKey, relativeDay } from '../../domain/dates';
import { NAME_SCORE, normalizeName, rankByName } from '../../domain/names';
import { peopleCount } from '../../domain/counts';
import { t, tn } from '../../i18n';
import type { Capture, CheckIn, DayKey, ID, ItemOfKind, Person, PersonRole } from '../../domain/types';
import type { PeopleLinesPerson, SpherePerson } from '../../ui';

/** A person is «active» if they were mentioned within this many days. */
export const ACTIVE_DAYS = 30;
/** How many days with a conversation the relation line shows. */
export const RELATION_POINTS = 12;

export function toSpherePerson(person: Person): SpherePerson {
  return { id: person.id, name: person.name, role: person.role, mentions: person.mentionCount };
}

const matchesQuery = (person: Person, query: string): boolean => {
  const needle = normalizeName(query);
  if (needle === '') return true;
  const haystack = [person.name, ...person.aliases].map(normalizeName);
  if (haystack.some((text) => text.includes(needle))) return true;
  // A typo or another case form of the name.
  return rankByName(query, [person], { minScore: NAME_SCORE.fuzzy }).length > 0;
};

/** Search by name or alias (substring, case form, typo) and filter by role. */
export function filterPeople(people: readonly Person[], query: string, role: PersonRole | 'all'): Person[] {
  return people.filter((person) => (role === 'all' || person.role === role) && matchesQuery(person, query));
}

/** Roles that occur, with how many people have each (for the filter chips). */
export function roleCounts(people: readonly Person[]): Array<{ role: PersonRole; count: number }> {
  const counts = new Map<PersonRole, number>();
  for (const person of people) counts.set(person.role, (counts.get(person.role) ?? 0) + 1);
  return [...counts.entries()].map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count);
}

export interface PeopleStats {
  total: number;
  /** Mentioned in the last 30 days. */
  active: number;
  /** Mentioned before, but not in the last 30 days. */
  dormant: number;
}

export function peopleStats(people: readonly Person[], today: DayKey = localDayKey()): PeopleStats {
  let active = 0;
  let dormant = 0;
  for (const person of people) {
    if (!person.lastMentionAt) continue;
    if (diffDays(localDayKey(person.lastMentionAt), today) <= ACTIVE_DAYS) active += 1;
    else dormant += 1;
  }
  return { total: people.length, active, dormant };
}

/** «47 людей» as the hero number. */
export const peopleCountLabel = (count: number): string => peopleCount(count);

/** Pairs of people mentioned in the same record: the arcs of the sphere. */
export function coMentionLinks(captures: readonly Pick<Capture, 'personIds'>[]): Array<{ a: ID; b: ID }> {
  const seen = new Set<string>();
  const links: Array<{ a: ID; b: ID }> = [];
  for (const capture of captures) {
    const ids = [...new Set(capture.personIds)].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ a: ids[i]!, b: ids[j]! });
      }
    }
  }
  return links;
}

/** People with the times they were mentioned, for the lines on a shared time axis. */
export function toLinesPeople(people: readonly Person[], captures: readonly Pick<Capture, 'personIds' | 'createdAt'>[]): PeopleLinesPerson[] {
  const times = new Map<ID, number[]>();
  for (const capture of captures) {
    const time = Date.parse(capture.createdAt);
    if (!Number.isFinite(time)) continue;
    for (const id of new Set(capture.personIds)) {
      const list = times.get(id);
      if (list) list.push(time);
      else times.set(id, [time]);
    }
  }
  return people.map((person) => ({ ...toSpherePerson(person), mentionTimes: (times.get(person.id) ?? []).sort((a, b) => a - b) }));
}

/** «вчера» / «3 дня назад» / «не упоминался». */
export function lastMentionLabel(person: Pick<Person, 'lastMentionAt'>, today: DayKey = localDayKey()): string {
  if (!person.lastMentionAt) return t('not mentioned');
  return relativeDay(localDayKey(person.lastMentionAt), today);
}

// ───────── The person card ─────────

export interface PersonCommitments {
  iOwe: ItemOfKind<'commitment'>[];
  owedToMe: ItemOfKind<'commitment'>[];
}

const byDue = (a: ItemOfKind<'commitment'>, b: ItemOfKind<'commitment'>): number => (a.dueAt ?? '￿').localeCompare(b.dueAt ?? '￿') || a.createdAt.localeCompare(b.createdAt);

/**
 * Open commitments between me and the person, both directions: the person is the counterparty, or is
 * mentioned in the commitment's record.
 */
export function commitmentsOf(personId: ID, commitments: readonly ItemOfKind<'commitment'>[]): PersonCommitments {
  const mine = commitments.filter((item) => item.status === 'active' && (item.counterpartyId === personId || item.personIds.includes(personId)));
  return {
    iOwe: mine.filter((item) => item.direction === 'i_owe').sort(byDue),
    owedToMe: mine.filter((item) => item.direction === 'owed_to_me').sort(byDue),
  };
}

/** «просрочено на 2 дня» / «до 12 окт.» / «без срока»: lateness is said in words, not only in colour. */
export function dueText(dueAt: string | undefined, today: DayKey = localDayKey()): { text: string; overdue: boolean } {
  if (!dueAt) return { text: t('no due date'), overdue: false };
  const day = localDayKey(dueAt);
  const late = diffDays(day, today);
  if (late > 0) return { text: tn(late, 'overdue by {n} day', 'overdue by {n} days'), overdue: true };
  if (late === 0) return { text: t('due today'), overdue: false };
  return { text: t('by {formatDayShort}', { formatDayShort: formatDayShort(day) }), overdue: false };
}

/**
 * The mood of the days when the person came up: for each of the last conversations (one per day), the mean
 * state of that day, −1…+1. `null` where no state was noted. The person's `relationMood` itself is one number,
 * so this line is the honest «динамика»: how I felt on days we talked.
 */
export function relationSeries(personId: ID, captures: readonly Pick<Capture, 'personIds' | 'day'>[], checkIns: readonly Pick<CheckIn, 'day' | 'valence' | 'origin'>[], limit = RELATION_POINTS): Array<number | null> {
  const days = [...new Set(captures.filter((c) => c.personIds.includes(personId)).map((c) => c.day))].sort().slice(-limit);
  return days.map((day) => {
    const states = checkIns.filter((c) => c.day === day && c.origin !== 'ai_suggested');
    return states.length === 0 ? null : states.reduce((sum, c) => sum + c.valence, 0) / states.length;
  });
}

/** Words for `relationMood` (−1…+1). */
export function relationWord(mood: number | undefined): string {
  if (mood === undefined) return t('not rated');
  if (mood > 0.3) return t('warm');
  if (mood < -0.3) return t('tense', undefined, 'model');
  return t('even');
}

/** Aliases typed as «Маша, Машенька»: split by commas and line breaks, trimmed. */
export function parseAliases(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Other people ordered by how likely they are the same person (best matches first), then by mentions. */
export function mergeCandidates(person: Person, others: readonly Person[]): Array<{ person: Person; likely: boolean }> {
  const ranked = new Map(
    [person.name, ...person.aliases].flatMap((name) => rankByName(name, others, { minScore: NAME_SCORE.partial })).map((match) => [match.entity.id, match.score] as const),
  );
  return others
    .filter((other) => other.id !== person.id)
    .map((other) => ({ person: other, likely: ranked.has(other.id) }))
    .sort((a, b) => Number(b.likely) - Number(a.likely) || b.person.mentionCount - a.person.mentionCount || a.person.name.localeCompare(b.person.name, 'ru'));
}
