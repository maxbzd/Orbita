import { capturesRepo, itemsRepo, patternsRepo, peopleRepo, presetsRepo, profileRepo, projectsRepo } from '../db';
import { addDays, localDayKey, startOfDayInstant } from '../domain/dates';
import { estimateTokens } from '../domain/tokens';
import { truncate } from '../domain/text';
import type {
  Capture,
  ContextPackPreset,
  ID,
  ISODate,
  Item,
  Pattern,
  Person,
  PrivacyLevel,
  Profile,
  Project,
} from '../domain/types';
import { createScrubber } from './privacy';
import type { Scrubber } from './privacy';
import { t } from '../i18n';

/**
 * "Контекст для ИИ": the author's profile and what the app knows — open promises, decisions, predictions,
 * people, patterns, recent records — as one markdown (or JSON) document to paste into any chat.
 * The document respects a privacy level (names masked) and a token budget (lowest-priority entries cut first).
 */

// ───────── Sections and options ─────────

export const CONTEXT_SECTIONS = ['profile', 'projects', 'commitments', 'tasks', 'decisions', 'predictions', 'ideas', 'facts', 'people', 'patterns', 'recent'] as const;
export type ContextSectionId = (typeof CONTEXT_SECTIONS)[number];

export const CONTEXT_SECTION_TITLES: Record<ContextSectionId, string> = {
  get profile() { return t('Profile') },
  get projects() { return t('Projects') },
  get commitments() { return t('Open commitments') },
  get tasks() { return t('Open tasks') },
  get decisions() { return t('Decisions', undefined, 'context') },
  get predictions() { return t('Predictions') },
  get ideas() { return t('Ideas', undefined, 'context') },
  get facts() { return t('Facts') },
  get people() { return t('People') },
  get patterns() { return t('Patterns') },
  get recent() { return t('Recent records', undefined, 'context') },
};

export const isContextSection = (value: string): value is ContextSectionId => (CONTEXT_SECTIONS as readonly string[]).includes(value);

export interface ContextPackOptions {
  /** Section ids; unknown ones are ignored, none given means all. */
  sections?: readonly string[];
  /** Days looked back for recent records, new decisions and ideas. */
  windowDays?: number;
  /** Only what concerns these people / projects (either match counts). */
  personIds?: readonly ID[];
  projectIds?: readonly ID[];
  privacy?: PrivacyLevel;
  maxTokens?: number;
  /** Which text the token budget is applied to. */
  format?: 'markdown' | 'json';
  now?: Date;
}

export const DEFAULT_WINDOW_DAYS = 14;
export const DEFAULT_MAX_TOKENS = 8_000;
export const MIN_MAX_TOKENS = 300;
export const MAX_MAX_TOKENS = 200_000;
const MAX_WINDOW_DAYS = 3_660;

export interface NormalizedOptions {
  sections: ContextSectionId[];
  windowDays: number;
  personIds: ID[];
  projectIds: ID[];
  privacy: PrivacyLevel;
  maxTokens: number;
  format: 'markdown' | 'json';
}

export function normalizeOptions(options: ContextPackOptions): NormalizedOptions {
  const requested = (options.sections ?? []).filter(isContextSection);
  const sections = CONTEXT_SECTIONS.filter((id) => (requested.length === 0 ? true : requested.includes(id)));
  const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(value)));
  return {
    sections,
    windowDays: clamp(options.windowDays ?? DEFAULT_WINDOW_DAYS, 1, MAX_WINDOW_DAYS),
    personIds: [...new Set(options.personIds ?? [])],
    projectIds: [...new Set(options.projectIds ?? [])],
    privacy: options.privacy ?? 'full',
    maxTokens: clamp(options.maxTokens ?? DEFAULT_MAX_TOKENS, MIN_MAX_TOKENS, MAX_MAX_TOKENS),
    format: options.format ?? 'markdown',
  };
}

// ───────── Entries ─────────

interface Entry {
  /** One line of markdown, without the bullet. */
  text: string;
  /** The same thing as data, for the JSON form. */
  data: Record<string, unknown>;
  /** Sub-heading inside the section. */
  group?: string;
}

type Blocks = Partial<Record<ContextSectionId, Entry[]>>;

const MAX_ENTRIES: Partial<Record<ContextSectionId, number>> = { recent: 100, facts: 40, ideas: 40, people: 40 };
const FIELD_CHARS = 200;

const oneLine = (text: string | undefined, max = FIELD_CHARS): string => truncate((text ?? '').replace(/\s+/g, ' ').trim(), max);
const dayOf = (at: ISODate): string => localDayKey(at);
/** The text with a full stop at the end, so that a sentence can follow it. */
const sentence = (text: string): string => (/[.!?…]$/.test(text) ? text : `${text}.`);

const IDEA_STAGE_LABEL = { get spark() { return t('spark') }, get exploring() { return t('exploring') }, get doing() { return t('in progress') }, get parked() { return t('parked') }, get dropped() { return t('discarded', undefined, 'stage') } } as const;
const PROJECT_KIND_LABEL = { get business() { return t('business') }, get product() { return t('product') }, get study() { return t('study') }, get personal() { return t('personal') }, get other() { return t('other') } } as const;
const PROJECT_STATUS_LABEL = { get active() { return t('active') }, get paused() { return t('on hold') }, get done() { return t('finished') } } as const;
const ROLE_LABEL = {
  get partner() { return t('partner') },
  get teammate() { return t('colleague') },
  get client() { return t('client') },
  get friend() { return t('friend') },
  get family() { return t('family') },
  get mentor() { return t('mentor') },
  get other() { return t('other') },
} as const;
const PATTERN_STATUS_LABEL = { get candidate() { return t('candidate') }, get confirmed() { return t('confirmed', undefined, 'pattern') }, get rejected() { return t('dismissed', undefined, 'pattern') }, get resolved() { return t('no longer relevant') } } as const;

interface Source {
  profile: Profile;
  people: Person[];
  projects: Project[];
  items: Item[];
  patterns: Pattern[];
  captures: Capture[];
}

interface Span {
  now: ISODate;
  today: string;
  fromDay: string;
  fromAt: ISODate;
}

const byDueThenNewest = (a: Item, b: Item): number => (a.dueAt ?? '￿').localeCompare(b.dueAt ?? '￿') || b.createdAt.localeCompare(a.createdAt);
const newestFirst = (a: Item, b: Item): number => b.createdAt.localeCompare(a.createdAt);

function buildBlocks(source: Source, options: NormalizedOptions, span: Span): Blocks {
  const { items, people } = source;
  const personName = new Map(people.map((person) => [person.id, person.name]));
  const selectedPeople = new Set(options.personIds);
  const selectedProjects = new Set(options.projectIds);
  const filtered = selectedPeople.size > 0 || selectedProjects.size > 0;

  const concerns = (record: { personIds: readonly ID[]; projectIds: readonly ID[] }, extraPerson?: ID): boolean =>
    !filtered ||
    record.personIds.some((id) => selectedPeople.has(id)) ||
    record.projectIds.some((id) => selectedProjects.has(id)) ||
    (extraPerson !== undefined && selectedPeople.has(extraPerson));
  const live = items.filter((item) => item.status !== 'proposed' && item.status !== 'dismissed');
  const open = (kind: Item['kind']) => live.filter((item) => item.kind === kind && item.status === 'active');

  const blocks: Blocks = {};
  const wants = (id: ContextSectionId) => options.sections.includes(id);

  if (wants('projects')) {
    blocks.projects = source.projects
      .filter((project) => project.status !== 'done' && (selectedProjects.size === 0 || selectedProjects.has(project.id)))
      .map((project) => ({
        text: `${project.name} (${PROJECT_KIND_LABEL[project.kind]}, ${PROJECT_STATUS_LABEL[project.status]})${project.description ? `: ${oneLine(project.description)}` : ''}`,
        data: { name: project.name, kind: project.kind, status: project.status, ...(project.description && { description: oneLine(project.description) }), keywords: project.keywords },
      }));
  }

  if (wants('commitments')) {
    blocks.commitments = open('commitment')
      .filter((item) => item.kind === 'commitment' && concerns(item, item.counterpartyId))
      .sort(byDueThenNewest)
      .flatMap((item) => {
        if (item.kind !== 'commitment') return [];
        const who = item.counterpartyName ?? (item.counterpartyId ? personName.get(item.counterpartyId) : undefined);
        const late = item.dueAt !== undefined && localDayKey(item.dueAt) < span.today;
        const due = item.dueAt ? t(' · due {dayOf}{v}', { dayOf: dayOf(item.dueAt), v: late ? t(', overdue') : '' }) : '';
        return [
          {
            group: item.direction === 'i_owe' ? t('I owe') : t('Owed to me'),
            text: `${item.title}${who ? ` — ${who}` : ''}${due}`,
            data: { title: item.title, direction: item.direction, ...(who && { person: who }), ...(item.dueAt && { due: dayOf(item.dueAt), overdue: late }) },
          },
        ];
      });
  }

  if (wants('tasks')) {
    blocks.tasks = open('task')
      .filter((item) => concerns(item))
      .sort((a, b) => byDueThenNewest(a, b))
      .map((item) => {
        const high = item.kind === 'task' && item.priority === 'high';
        return {
          text: `${item.title}${item.dueAt ? t(' · due {dayOf}', { dayOf: dayOf(item.dueAt) }) : ''}${high ? t(' · important') : ''}`,
          data: { title: item.title, ...(item.dueAt && { due: dayOf(item.dueAt) }), ...(high && { priority: 'high' }) },
        };
      });
  }

  if (wants('decisions')) {
    const needsReview = (item: Item) => item.kind === 'decision' && item.outcome === undefined && item.dueAt !== undefined && item.dueAt <= span.now;
    blocks.decisions = live
      .filter((item) => item.kind === 'decision' && item.status !== 'dropped' && concerns(item) && (item.createdAt >= span.fromAt || needsReview(item)))
      .sort((a, b) => Number(needsReview(b)) - Number(needsReview(a)) || newestFirst(a, b))
      .flatMap((item) => {
        if (item.kind !== 'decision') return [];
        const parts = [
          t('Chosen: {oneLine}', { oneLine: oneLine(item.chosen, 160) }),
          item.alternatives.length > 0 ? t('Alternatives: {oneLine}', { oneLine: oneLine(item.alternatives.join('; ')) }) : '',
          item.reasons.length > 0 ? t('Reasons: {oneLine}', { oneLine: oneLine(item.reasons.join('; ')) }) : '',
          item.expected ? t('Expected: {oneLine}', { oneLine: oneLine(item.expected, 160) }) : '',
          item.outcome ? t('Result: {rating}/5{v}', { rating: item.outcome.rating, v: item.outcome.note ? ` (${oneLine(item.outcome.note, 120)})` : '' }) : needsReview(item) ? t('Time to rate how it went') : '',
        ].filter(Boolean);
        return [
          {
            text: `${dayOf(item.createdAt)} — ${item.title}. ${parts.join('. ')}`,
            data: {
              day: dayOf(item.createdAt),
              title: item.title,
              chosen: item.chosen,
              alternatives: item.alternatives,
              reasons: item.reasons,
              ...(item.expected && { expected: item.expected }),
              ...(item.outcome && { outcome: { rating: item.outcome.rating, note: item.outcome.note } }),
            },
          },
        ];
      });
  }

  if (wants('predictions')) {
    blocks.predictions = live
      .filter((item) => item.kind === 'prediction' && concerns(item) && (item.outcome === undefined || (item.resolvedAt ?? '') >= span.fromAt))
      .sort((a, b) => Number(a.kind === 'prediction' && a.outcome !== undefined) - Number(b.kind === 'prediction' && b.outcome !== undefined) || byDueThenNewest(a, b))
      .flatMap((item) => {
        if (item.kind !== 'prediction') return [];
        const outcome = item.outcome === 'true' ? t('came true') : item.outcome === 'false' ? t('did not come true') : item.outcome === 'unknown' ? t('outcome unknown') : undefined;
        return [
          {
            text: `${item.title} — ${Math.round(item.probability * 100)}%${item.dueAt ? t(' · due {dayOf}', { dayOf: dayOf(item.dueAt) }) : ''}${outcome ? ` · ${outcome}` : ''}`,
            data: { title: item.title, probability: item.probability, ...(item.dueAt && { due: dayOf(item.dueAt) }), ...(item.outcome && { outcome: item.outcome }) },
          },
        ];
      });
  }

  if (wants('ideas')) {
    blocks.ideas = live
      .filter((item) => item.kind === 'idea' && item.stage !== 'dropped' && concerns(item) && (item.createdAt >= span.fromAt || item.stage === 'doing' || item.stage === 'exploring'))
      .sort(newestFirst)
      .flatMap((item) =>
        item.kind === 'idea'
          ? [
              {
                text: `${item.title} (${IDEA_STAGE_LABEL[item.stage]})${item.body ? `: ${oneLine(item.body, 160)}` : ''}`,
                data: { title: item.title, stage: item.stage, ...(item.body && { body: oneLine(item.body, 160) }) },
              },
            ]
          : [],
      );
  }

  if (wants('facts')) {
    blocks.facts = open('fact')
      .filter((item) => item.kind === 'fact' && item.supersededBy === undefined && concerns(item))
      .sort(newestFirst)
      .flatMap((item) =>
        item.kind === 'fact'
          ? [{ text: `${item.title}${item.value ? `: ${oneLine(item.value, 80)}` : ''}`, data: { title: item.title, ...(item.value && { value: item.value }) } }]
          : [],
      );
  }

  if (wants('people')) {
    const commitments = open('commitment');
    blocks.people = source.people
      .filter((person) => !person.archived && (selectedPeople.size > 0 ? selectedPeople.has(person.id) : (person.lastMentionAt ?? '') >= span.fromAt))
      .sort((a, b) => b.mentionCount - a.mentionCount || (b.lastMentionAt ?? '').localeCompare(a.lastMentionAt ?? ''))
      .map((person) => {
        const mine = commitments.filter((item) => item.kind === 'commitment' && item.counterpartyId === person.id);
        const iOwe = mine.filter((item) => item.kind === 'commitment' && item.direction === 'i_owe').length;
        const owed = mine.length - iOwe;
        const mood = person.relationMood === undefined ? '' : person.relationMood > 0.3 ? t('relationship warm') : person.relationMood < -0.3 ? t('relationship tense') : t('relationship even');
        const details = [
          person.mentionCount > 0 ? t('mentions: {mentionCount}', { mentionCount: person.mentionCount }) : '',
          person.lastMentionAt ? t('last time {dayOf}', { dayOf: dayOf(person.lastMentionAt) }) : '',
          mood,
          iOwe > 0 ? t('I owe: {iOwe}', { iOwe }) : '',
          owed > 0 ? t('owed to me: {owed}', { owed }) : '',
        ].filter(Boolean);
        return {
          text: `${person.name} (${ROLE_LABEL[person.role]})${details.length > 0 ? ` — ${details.join(', ')}` : ''}${person.notes ? `. ${oneLine(person.notes, 160)}` : ''}`,
          data: {
            name: person.name,
            role: person.role,
            mentions: person.mentionCount,
            ...(person.lastMentionAt && { lastMention: dayOf(person.lastMentionAt) }),
            ...(person.relationMood !== undefined && { relationMood: person.relationMood }),
            openIOwe: iOwe,
            openOwedToMe: owed,
            ...(person.notes && { notes: oneLine(person.notes, 160) }),
          },
        };
      });
  }

  if (wants('patterns')) {
    const related = new Set(source.captures.filter((capture) => concerns(capture)).map((capture) => capture.id));
    blocks.patterns = source.patterns
      .filter((pattern) => (pattern.status === 'confirmed' || pattern.status === 'candidate') && (!filtered || pattern.evidence.some((entry) => related.has(entry.captureId))))
      .sort((a, b) => Number(b.status === 'confirmed') - Number(a.status === 'confirmed') || b.confidence - a.confidence)
      .map((pattern) => ({
        text: t('{title} ({v}, {occurrences} times): {v2}{v3}', { title: pattern.title, v: PATTERN_STATUS_LABEL[pattern.status], occurrences: pattern.occurrences, v2: pattern.suggestion ? sentence(oneLine(pattern.description)) : oneLine(pattern.description), v3: pattern.suggestion ? t(' What to do: {oneLine}', { oneLine: oneLine(pattern.suggestion, 160) }) : '' }),
        data: { title: pattern.title, status: pattern.status, occurrences: pattern.occurrences, description: oneLine(pattern.description), ...(pattern.suggestion && { suggestion: oneLine(pattern.suggestion, 160) }) },
      }));
  }

  if (wants('recent')) {
    blocks.recent = source.captures
      .filter((capture) => capture.day >= span.fromDay && concerns(capture))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((capture) => {
        const gist = oneLine(capture.summary || capture.text, 240);
        return {
          text: `${capture.day} · ${capture.title ? `${oneLine(capture.title, 80)} — ` : ''}${gist}`,
          data: { day: capture.day, ...(capture.title && { title: oneLine(capture.title, 80) }), summary: gist },
        };
      });
  }

  for (const id of Object.keys(blocks) as ContextSectionId[]) {
    const limit = MAX_ENTRIES[id];
    if (limit !== undefined && (blocks[id]?.length ?? 0) > limit) blocks[id] = blocks[id]?.slice(0, limit);
  }
  return blocks;
}

function scrubEntries(entries: readonly Entry[], scrubber: Scrubber): Entry[] {
  return entries.map((entry) => ({ ...entry, text: scrubber.scrub(entry.text), data: scrubber.scrubDeep(entry.data), ...(entry.group && { group: entry.group }) }));
}

// ───────── Profile ─────────

type ProfileField = 'name' | 'about' | 'goals' | 'values' | 'talkStyle';
const PROFILE_FIELDS: readonly { key: ProfileField; label: string }[] = [
  { key: 'name', get label() { return t('Name', undefined, 'profile-sheet') } },
  { key: 'about', get label() { return t('About me') } },
  { key: 'goals', get label() { return t('Goals') } },
  { key: 'values', get label() { return t('Values') } },
  { key: 'talkStyle', get label() { return t('How to talk to me') } },
];
/** The profile may take at most this share of the budget; the rest is for what the app knows. */
const PROFILE_SHARE = 0.4;

interface ProfileView {
  fields: { key: ProfileField | 'glossary'; label: string; value: string }[];
}

function profileView(profile: Profile, scrubber: Scrubber): ProfileView {
  const fields: ProfileView['fields'] = PROFILE_FIELDS.map(({ key, label }) => ({ key, label, value: scrubber.scrub(profile[key].trim()) })).filter((field) => field.value !== '');
  const glossary = profile.glossary
    .filter((entry) => entry.term.trim() !== '')
    .map((entry) => (entry.hint?.trim() ? `${entry.term.trim()} — ${entry.hint.trim()}` : entry.term.trim()))
    .join('; ');
  if (glossary !== '') fields.push({ key: 'glossary', label: t('Terms and words'), value: scrubber.scrub(glossary) });
  return { fields };
}

const renderProfile = (view: ProfileView): string => view.fields.map((field) => `**${field.label}:** ${field.value}`).join('\n\n');

/** Shortens the longest fields until the profile fits `budget` tokens. */
function fitProfile(view: ProfileView, budget: number): ProfileView {
  const fields = view.fields.map((field) => ({ ...field }));
  for (let guard = 0; guard < 200 && estimateTokens(renderProfile({ fields })) > budget; guard++) {
    const longest = fields.reduce((top, field) => (field.value.length > top.value.length ? field : top), fields[0]);
    if (!longest || longest.value.length <= 40) break;
    longest.value = `${longest.value.slice(0, Math.floor(longest.value.length * 0.8)).trimEnd()}…`;
  }
  return { fields };
}

// ───────── Rendering ─────────

const RENDER_ORDER: readonly Exclude<ContextSectionId, 'profile'>[] = ['projects', 'commitments', 'tasks', 'decisions', 'predictions', 'ideas', 'facts', 'people', 'patterns', 'recent'];
/** Who gets room first when the budget is short, and how many entries per round. */
const FILL_ORDER: readonly { id: Exclude<ContextSectionId, 'profile'>; weight: number }[] = [
  { id: 'commitments', weight: 3 },
  { id: 'decisions', weight: 2 },
  { id: 'predictions', weight: 2 },
  { id: 'tasks', weight: 2 },
  { id: 'people', weight: 1 },
  { id: 'patterns', weight: 1 },
  { id: 'projects', weight: 1 },
  { id: 'recent', weight: 2 },
  { id: 'ideas', weight: 1 },
  { id: 'facts', weight: 1 },
];
const TRIM_NOTE_RESERVE = 60;
/** Sub-headings in the order they appear; ungrouped entries come first. */
const groupRank = (group: string | undefined): number => {
  const order = [t('I owe'), t('Owed to me')];
  return group === undefined ? -1 : order.indexOf(group) === -1 ? order.length : order.indexOf(group);
};
const PRIVACY_LABEL: Record<PrivacyLevel, string> = { get full() { return t('full') }, get initials() { return t('initials') }, get anonymous() { return t('anonymised (Person A, B…)') } };

interface Meta {
  generatedAt: ISODate;
  windowDays: number;
  privacy: PrivacyLevel;
}

export interface ContextPackData {
  version: 1;
  generatedAt: ISODate;
  windowDays: number;
  privacy: PrivacyLevel;
  trimmed: boolean;
  profile?: Record<string, string>;
  sections: Partial<Record<Exclude<ContextSectionId, 'profile'>, Record<string, unknown>[]>>;
}

type Selection = Partial<Record<Exclude<ContextSectionId, 'profile'>, Entry[]>>;

function renderMarkdown(meta: Meta, profile: ProfileView | undefined, selection: Selection, note: string): string {
  const day = localDayKey(meta.generatedAt);
  const parts = [
    t('# Context for AI'),
    t("> Built in Orbita on {day}. Window: last {windowDays} days. Names: {v}. This is the author's personal data: use it only to answer their question.", { day, windowDays: meta.windowDays, v: PRIVACY_LABEL[meta.privacy] }),
  ];
  if (profile && profile.fields.length > 0) parts.push(`## ${CONTEXT_SECTION_TITLES.profile}\n\n${renderProfile(profile)}`);
  for (const id of RENDER_ORDER) {
    const entries = selection[id];
    if (!entries || entries.length === 0) continue;
    const lines: string[] = [];
    const groups = new Map<string | undefined, Entry[]>();
    for (const entry of entries) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
    const ordered = [...groups.entries()].sort(([a], [b]) => groupRank(a) - groupRank(b));
    for (const [group, members] of ordered) {
      if (group) lines.push(`**${group}**`);
      for (const entry of members) lines.push(`- ${entry.text}`);
    }
    parts.push(`## ${CONTEXT_SECTION_TITLES[id]}\n\n${lines.join('\n')}`);
  }
  if (note) parts.push(note);
  return `${parts.join('\n\n')}\n`;
}

function renderData(meta: Meta, profile: ProfileView | undefined, selection: Selection, trimmed: boolean): ContextPackData {
  const sections: ContextPackData['sections'] = {};
  for (const id of RENDER_ORDER) {
    const entries = selection[id];
    if (entries && entries.length > 0) sections[id] = entries.map((entry) => ({ ...(entry.group && { group: entry.group }), ...entry.data }));
  }
  return {
    version: 1,
    generatedAt: meta.generatedAt,
    windowDays: meta.windowDays,
    privacy: meta.privacy,
    trimmed,
    ...(profile && profile.fields.length > 0 && { profile: Object.fromEntries(profile.fields.map((field) => [field.key, field.value])) }),
    sections,
  };
}

// ───────── The pack ─────────

export interface SectionReport {
  id: ContextSectionId;
  title: string;
  /** Entries available / entries that fit the budget. */
  total: number;
  included: number;
}

export interface ContextPack {
  markdown: string;
  /** Pretty-printed JSON of `data`. */
  json: string;
  data: ContextPackData;
  /** Estimates for each form (never for billing). */
  tokens: { markdown: number; json: number };
  sections: SectionReport[];
  /** Some entries were left out to respect `maxTokens`. */
  trimmed: boolean;
  warnings: string[];
  options: NormalizedOptions;
}

export async function buildContextPack(input: ContextPackOptions = {}): Promise<ContextPack> {
  const options = normalizeOptions(input);
  const now = input.now ?? new Date();
  const today = localDayKey(now);
  const fromDay = addDays(today, -(options.windowDays - 1));
  const span: Span = { now: now.toISOString(), today, fromDay, fromAt: startOfDayInstant(fromDay).toISOString() };

  // Patterns are matched to a person or project through the records that show them, whatever their age.
  const needsAllCaptures = options.sections.includes('patterns') && (options.personIds.length > 0 || options.projectIds.length > 0);
  const [profile, people, projects, items, patterns, captures] = await Promise.all([
    profileRepo.get(),
    peopleRepo.list({ includeArchived: true }),
    projectsRepo.list(),
    itemsRepo.list(),
    patternsRepo.list(),
    capturesRepo.list(needsAllCaptures ? {} : { fromDay }),
  ]);
  const scrubber = createScrubber(people, options.privacy, profile.name);
  const raw = buildBlocks({ profile, people, projects, items, patterns, captures }, options, span);
  const blocks: Selection = {};
  for (const id of RENDER_ORDER) if (raw[id]) blocks[id] = scrubEntries(raw[id] ?? [], scrubber);

  const meta: Meta = { generatedAt: now.toISOString(), windowDays: options.windowDays, privacy: options.privacy };
  const fullProfile = options.sections.includes('profile') ? profileView(profile, scrubber) : undefined;

  const measure = (selection: Selection, view: ProfileView | undefined, note: string, trimmed: boolean): number =>
    estimateTokens(options.format === 'json' ? JSON.stringify(renderData(meta, view, selection, trimmed), null, 2) : renderMarkdown(meta, view, selection, note));
  const everything = measure(blocks, fullProfile, '', false);
  const total = (selection: Selection): number => Object.values(selection).reduce((sum, entries) => sum + entries.length, 0);

  let selection: Selection = blocks;
  let view = fullProfile;
  let trimmed = false;
  const warnings = [...scrubber.warnings];

  if (everything > options.maxTokens) {
    trimmed = true;
    const reserve = options.format === 'json' ? 0 : TRIM_NOTE_RESERVE;
    view = fullProfile ? fitProfile(fullProfile, Math.floor(options.maxTokens * PROFILE_SHARE)) : undefined;
    const empty: Selection = {};
    const base = measure(empty, view, '', true) + reserve;
    let used = base;
    selection = {};
    const cursor = new Map<string, number>();
    const costOf = (id: Exclude<ContextSectionId, 'profile'>, entry: Entry, first: boolean): number =>
      (options.format === 'json' ? estimateTokens(JSON.stringify(entry.data)) + 4 : estimateTokens(`- ${entry.text}`) + 2) +
      (first ? estimateTokens(CONTEXT_SECTION_TITLES[id]) + 4 : 0) +
      (entry.group && !(selection[id] ?? []).some((other) => other.group === entry.group) ? estimateTokens(entry.group) + 2 : 0);

    // Round robin by priority: every section moves forward, the important ones faster.
    for (let progressed = true; progressed; ) {
      progressed = false;
      for (const { id, weight } of FILL_ORDER) {
        const entries = blocks[id] ?? [];
        for (let step = 0; step < weight; step++) {
          const index = cursor.get(id) ?? 0;
          const entry = entries[index];
          if (!entry) break;
          const cost = costOf(id, entry, index === 0);
          if (used + cost > options.maxTokens) break;
          selection[id] = [...(selection[id] ?? []), entry];
          cursor.set(id, index + 1);
          used += cost;
          progressed = true;
        }
      }
    }
    // The estimate of parts can differ from the estimate of the whole: take from the least important until it fits.
    const dropOrder = [...FILL_ORDER].reverse();
    for (let guard = 0; guard < 10_000 && measure(selection, view, '', true) + reserve > options.maxTokens; guard++) {
      const victim = dropOrder.find(({ id }) => (selection[id]?.length ?? 0) > 0);
      if (!victim) break;
      selection[victim.id] = (selection[victim.id] ?? []).slice(0, -1);
    }
    if (measure({}, view, '', true) + reserve > options.maxTokens) warnings.push(t('The limit is too small: only the profile fit in the document.'));
  }

  const kept = total(selection);
  const note = trimmed ? t('_Truncated to the limit of {maxTokens} tokens: showing {kept} of {total} records. The most important is kept._', { maxTokens: options.maxTokens, kept, total: total(blocks) }) : '';
  const data = renderData(meta, view, selection, trimmed);
  const markdown = renderMarkdown(meta, view, selection, note);
  const json = JSON.stringify(data, null, 2);

  const reports: SectionReport[] = options.sections.map((id) =>
    id === 'profile'
      ? { id, title: CONTEXT_SECTION_TITLES[id], total: fullProfile?.fields.length ?? 0, included: view?.fields.length ?? 0 }
      : { id, title: CONTEXT_SECTION_TITLES[id], total: blocks[id]?.length ?? 0, included: selection[id]?.length ?? 0 },
  );
  if (trimmed) warnings.unshift(t('The document was shortened to {maxTokens} tokens: showing {kept} of {total} records.', { maxTokens: options.maxTokens, kept, total: total(blocks) }));
  return { markdown, json, data, tokens: { markdown: estimateTokens(markdown), json: estimateTokens(json) }, sections: reports, trimmed, warnings, options };
}

// ───────── Presets ─────────

export type PresetTemplate = Omit<ContextPackPreset, 'id'>;

export const BUILTIN_PRESETS: readonly PresetTemplate[] = [
  {
    get name() { return t('Morning review') },
    sections: ['profile', 'commitments', 'tasks', 'predictions', 'decisions', 'recent'],
    windowDays: 3,
    personIds: [],
    projectIds: [],
    privacy: 'full',
    maxTokens: 4_000,
  },
  {
    get name() { return t('Weekly review') },
    sections: ['profile', 'commitments', 'tasks', 'decisions', 'predictions', 'patterns', 'people', 'recent'],
    windowDays: 7,
    personIds: [],
    projectIds: [],
    privacy: 'full',
    maxTokens: 8_000,
  },
  {
    get name() { return t('Strategy session') },
    sections: [...CONTEXT_SECTIONS],
    windowDays: 90,
    personIds: [],
    projectIds: [],
    privacy: 'initials',
    maxTokens: 16_000,
  },
];

/** "Перед созвоном с X": everything about one person, names masked off by default is the user's choice. */
export function presetForPerson(person: Pick<Person, 'id' | 'name'>): PresetTemplate {
  return {
    name: t('Before our talk: {name}', { name: person.name }),
    sections: ['profile', 'people', 'commitments', 'decisions', 'predictions', 'recent'],
    windowDays: 60,
    personIds: [person.id],
    projectIds: [],
    privacy: 'full',
    maxTokens: 6_000,
  };
}

export const optionsFromPreset = (preset: PresetTemplate): ContextPackOptions => ({
  sections: preset.sections,
  windowDays: preset.windowDays,
  personIds: preset.personIds,
  projectIds: preset.projectIds,
  privacy: preset.privacy,
  maxTokens: preset.maxTokens,
});

/** Stores the built-in presets that are not there yet (by name). Returns the ones it created. */
export async function seedBuiltinPresets(): Promise<ContextPackPreset[]> {
  const have = new Set((await presetsRepo.list()).map((preset) => preset.name));
  const created: ContextPackPreset[] = [];
  for (const template of BUILTIN_PRESETS) {
    if (!have.has(template.name)) created.push(await presetsRepo.create(template));
  }
  return created;
}
