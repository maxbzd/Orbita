import { capturesRepo, itemsRepo, patternsRepo, peopleRepo, profileRepo } from '../db';
import { NAME_SCORE, rankByName } from '../domain/names';
import { addDays, endOfWeek, localDayKey, periodRange, shiftPeriod, startOfWeek } from '../domain/dates';
import type { DayRange } from '../domain/dates';
import { truncate } from '../domain/text';
import type { Capture, DayKey, ID, Item, ItemKind, Pattern, Person } from '../domain/types';
import { ensureSearchIndex, search as searchApp } from '../search';
import type { SearchHit, SearchOptions } from '../search';
import { tokenize } from '../search/tokenize';
import { buildAskSystem } from './prompts/ask';
import type { LlmProvider, Msg, Usage } from './providers/types';
import { t, msg } from '../i18n';

/**
 * "Спросить": a question about the author's own life. Retrieval is local — the full-text index plus
 * structured filters guessed from the question ("что я обещал за эту неделю" → open commitments of this
 * week) — and only the few best materials go to the model, each under a short code. The answer cites the
 * codes; they are parsed back into links to the records, and codes the model made up are removed.
 */

/** The search function of the application index; tests pass their own over a private index. */
export type Retriever = (query: string, options: SearchOptions) => SearchHit[];

export const QUICK_QUESTIONS: readonly string[] = [
  msg('What did I promise this week?'),
  msg('What is owed to me?'),
  msg('What am I avoiding?'),
  msg('What did I decide this month and why?'),
  msg('Which ideas did I park?'),
];

// ───────── Reading the question ─────────

export interface QuestionPlan {
  /** Kinds of objects the question is about; empty when it names none. */
  itemKinds: ItemKind[];
  /** Days the question limits itself to. */
  window?: DayRange;
  wantsPatterns: boolean;
  /** Words worth searching for. */
  terms: string[];
  /** Capitalized words: candidates for the names of people. */
  names: string[];
}

// The question can come in either language, so every rule knows both.
// i18n-ignore-start: language data, not UI text
const KIND_RULES: [RegExp, ItemKind][] = [
  [/обещ|должен|должна|должны|долг|задолж|promis|owe|debt/, 'commitment'],
  [/реши(?:л|ла|ли|тел)|решени|выбра|выбор|decid|decision|chose|choice/, 'decision'],
  [/прогноз|предсказ|вероятн|сбыл|ошиб(?:ся|лась)|predict|forecast|probab|came true/, 'prediction'],
  [/иде[яйиюе]|придума|idea/, 'idea'],
  [/задач|сделать|напомни|task|to-?do|remind/, 'task'],
  [/вопрос|question/, 'question'],
  [/урок|вывод|понял|lesson|learn|conclusion/, 'lesson'],
  [/факт|сколько у меня|fact|how many do i have/, 'fact'],
];

const PATTERN_WORDS = /избега|повторя|паттерн|привыч|всегда|снова|опять|откладыва|мешает|одно и то же|avoid|repeat|pattern|habit|always|again|keep putting off|procrastinat|same thing/;

type WindowRule = [RegExp, (today: DayKey) => DayRange];
const WINDOW_RULES: WindowRule[] = [
  [/сегодня|today/, (today) => ({ startDay: today, endDay: today })],
  [/вчера|yesterday/, (today) => ({ startDay: addDays(today, -1), endDay: addDays(today, -1) })],
  [/прошл\S* недел|last week/, (today) => shiftPeriod('week', today, -1)],
  [/(?:эт\S*|текущ\S*) недел|на неделе|this week/, (today) => ({ startDay: startOfWeek(today), endDay: endOfWeek(today) })],
  [/за недел|последн\S* недел|за 7 дн|past week|last 7 days/, (today) => ({ startDay: addDays(today, -6), endDay: today })],
  [/прошл\S* месяц|last month/, (today) => shiftPeriod('month', today, -1)],
  [/(?:эт\S*|текущ\S*) месяц|в месяце|this month/, (today) => periodRange('month', today)],
  [/за месяц|последн\S* месяц|за 30 дн|past month|last 30 days/, (today) => ({ startDay: addDays(today, -29), endDay: today })],
  [/(?:эт\S*|текущ\S*) год|в году|this year/, (today) => periodRange('year', today)],
  [/за год|последн\S* год|past year|last year/, (today) => ({ startDay: addDays(today, -364), endDay: today })],
];
// i18n-ignore-end

/** Function words that would make every record "relevant". */
// i18n-ignore-start: language data, not UI text
const STOP_WORDS = new Set(
  (
    'what how where when who why which whose whom did does do is are was were be been am have has had will would could should can ' +
    'me my mine myself you your we our us he she they them his her its their this that these those there here the a an and or of to ' +
    'in on at for with about from by into over under all any some very just also only not no yes ever still already week weeks month months ' +
    'year years today yesterday last past recent latest said told wrote think thought want wanted plan planned know knew remember made make ' +
    'record records note notes entry entries ' +
    'что как где когда кто почему зачем какой какая какие какое каких сколько мне меня мной мой моя мое мои моих ' +
    'тебе тебя ты мы нам нас он она они его ее их это этот эта эти этого этой этих тот те там тут все всё всех ' +
    'был была было были быть есть будет буду будут стал стала еще уже или для при про над под без из от до за на ' +
    'об обо во со ко не ни ли бы же то вот так также только очень надо можно нужно сказал сказала говорил говорила ' +
    'писал писала записи записей запись запиши недел недели неделю неделе месяц месяца месяце год года году сегодня вчера ' +
    'эту этой этом этих последние последний последнюю прошлой прошлую прошлый ' +
    'думаю думал думала считаю считал считала хочу хотел хотела планирую планировал знаю помню делал делала сделал сделала'
  ).split(' '),
);
// i18n-ignore-end

const normalizeTerm = (word: string): string => word.toLowerCase().replace(/ё/g, 'е');

export function planQuestion(question: string, today: DayKey): QuestionPlan {
  const lower = normalizeTerm(question);
  const itemKinds = KIND_RULES.filter(([pattern]) => pattern.test(lower)).map(([, kind]) => kind);
  const window = WINDOW_RULES.find(([pattern]) => pattern.test(lower))?.[1](today);

  // Words that only expressed the intent do not need to appear in the records.
  const intentWords = [...KIND_RULES.map(([pattern]) => pattern), PATTERN_WORDS, ...WINDOW_RULES.map(([pattern]) => pattern)];
  const words = tokenize(question)
    .map((token) => token.term)
    .filter((term) => term.length >= 3 && !STOP_WORDS.has(term) && !/^\d+$/.test(term));
  const terms = words.filter((term) => !intentWords.some((pattern) => pattern.test(term)));
  const names = tokenize(question)
    .filter((token) => /^\p{Lu}/u.test(question.slice(token.start, token.end)) && token.term.length >= 3 && !STOP_WORDS.has(token.term))
    .map((token) => question.slice(token.start, token.end));
  return { itemKinds, ...(window && { window }), wantsPatterns: PATTERN_WORDS.test(lower), terms, names };
}

// ───────── Materials ─────────

export type SourceKind = 'capture' | 'item' | 'person' | 'pattern';

/** What a code in the materials stands for. */
export interface AskSource {
  code: string;
  kind: SourceKind;
  id: ID;
  /** Short label for a link. */
  label: string;
  day?: DayKey;
}

export interface Materials {
  text: string;
  sources: AskSource[];
}

const CODE_PREFIX: Record<SourceKind, string> = { capture: 'c', item: 'i', person: 'p', pattern: 't' };
const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  get decision() { return t('decision') },
  get commitment() { return t('commitment') },
  get idea() { return t('idea') },
  get prediction() { return t('prediction') },
  get task() { return t('task') },
  get question() { return t('question') },
  get lesson() { return t('lesson') },
  get fact() { return t('fact') },
};
const ITEM_STATUS_LABEL = { get proposed() { return t('proposed') }, get active() { return t('open', undefined, 'status') }, get done() { return t('done') }, get dropped() { return t('discarded') }, get dismissed() { return t('dismissed') } } as const;

export const ASK_LIMITS = { captures: 6, items: 12, people: 3, patterns: 4, snippetChars: 360, materialChars: 14_000, history: 6 } as const;

/** Every material is one line: text from records cannot fake the start of another entry. */
const oneLine = (text: string | undefined, max: number): string => truncate((text ?? '').replace(/\s+/g, ' ').trim(), max);

const dueText = (item: Item): string => (item.dueAt ? t('due {localDayKey}', { localDayKey: localDayKey(item.dueAt) }) : '');

function describeItem(item: Item, peopleById: ReadonlyMap<ID, Person>): string {
  const facts: string[] = [ITEM_STATUS_LABEL[item.status], dueText(item)];
  switch (item.kind) {
    case 'commitment': {
      const who = item.counterpartyName ?? (item.counterpartyId ? peopleById.get(item.counterpartyId)?.name : undefined);
      facts.unshift(item.direction === 'i_owe' ? t('I owe{v}', { v: who ? `: ${who}` : '' }) : t('owed to me{v}', { v: who ? `: ${who}` : '' }));
      break;
    }
    case 'prediction':
      facts.push(t('probability {round}%', { round: Math.round(item.probability * 100) }));
      if (item.outcome) facts.push(t('outcome: {v}', { v: item.outcome === 'true' ? t('came true') : item.outcome === 'false' ? t('did not come true') : t('unknown') }));
      break;
    case 'decision':
      facts.push(t('chosen: {oneLine}', { oneLine: oneLine(item.chosen, 120) }));
      if (item.reasons.length > 0) facts.push(t('reasons: {oneLine}', { oneLine: oneLine(item.reasons.join('; '), 200) }));
      if (item.outcome) facts.push(t('result {rating}/5{v}', { rating: item.outcome.rating, v: item.outcome.note ? ` (${oneLine(item.outcome.note, 100)})` : '' }));
      break;
    case 'idea':
      facts.push(t('stage: {stage}', { stage: item.stage }));
      break;
    case 'question':
      if (item.answer) facts.push(t('answer: {oneLine}', { oneLine: oneLine(item.answer, 150) }));
      break;
    case 'fact':
      if (item.value) facts.push(t('value: {oneLine}', { oneLine: oneLine(item.value, 80) }));
      break;
    default:
      break;
  }
  const quote = item.quote ? ` — «${oneLine(item.quote, 160)}»` : '';
  return `${ITEM_KIND_LABEL[item.kind]} (${facts.filter(Boolean).join(', ')}): ${oneLine(item.title, 160)}${quote}`;
}

function describeCapture(capture: Capture, hit?: SearchHit): string {
  const excerpt = hit?.snippet?.text ?? capture.summary ?? capture.text;
  const title = capture.title ? `${oneLine(capture.title, 80)} — ` : '';
  return `${capture.day} · ${title}${oneLine(excerpt, ASK_LIMITS.snippetChars)}`;
}

function describePerson(person: Person, openCommitments: readonly Item[]): string {
  const owe = openCommitments.filter((item) => item.kind === 'commitment' && item.direction === 'i_owe').length;
  const owed = openCommitments.filter((item) => item.kind === 'commitment' && item.direction === 'owed_to_me').length;
  const mood = person.relationMood === undefined ? '' : person.relationMood > 0.3 ? t(', relationship warm') : person.relationMood < -0.3 ? t(', relationship tense') : t(', relationship even');
  const notes = person.notes ? `. ${oneLine(person.notes, 160)}` : '';
  return t('{oneLine} ({role}; mentions {mentionCount}{mood}; open promises: I owe {owe}, owed to me {owed}){notes}', { oneLine: oneLine(person.name, 80), role: person.role, mentionCount: person.mentionCount, mood, owe, owed, notes });
}

function describePattern(pattern: Pattern): string {
  const status = pattern.status === 'confirmed' ? t('confirmed', undefined, 'ask') : t('candidate');
  return t('{oneLine} ({status}, confidence {round}%, {occurrences} times): {oneLine2}', { oneLine: oneLine(pattern.title, 100), status, round: Math.round(pattern.confidence * 100), occurrences: pattern.occurrences, oneLine2: oneLine(pattern.description, 240) });
}

/** Statuses worth showing for a kind: open work for things to do, everything alive for the rest. */
const OPEN_ONLY: ReadonlySet<ItemKind> = new Set(['commitment', 'task', 'question']);

const inWindow = (day: DayKey, window: DayRange | undefined): boolean => !window || (day >= window.startDay && day <= window.endDay);

export interface RetrieveDeps {
  search?: Retriever;
  now?: Date;
}

/** Finds and numbers the materials for a question. Nothing here talks to a model. */
export async function retrieveMaterials(question: string, deps: RetrieveDeps = {}): Promise<Materials> {
  const today = localDayKey(deps.now ?? new Date());
  const plan = planQuestion(question, today);
  let find = deps.search;
  if (!find) {
    await ensureSearchIndex();
    find = searchApp;
  }

  const people = await peopleRepo.list({ includeArchived: true });
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const mentioned = new Map<ID, Person>();
  for (const name of plan.names) {
    for (const match of rankByName(name, people, { minScore: NAME_SCORE.stem })) mentioned.set(match.entity.id, match.entity);
  }
  // Names are not search terms of their own: the person's records are fetched through the person.
  const nameTerms = new Set(plan.names.flatMap((name) => tokenize(name).map((token) => token.term)));
  const terms = plan.terms.filter((term) => !(mentioned.size > 0 && nameTerms.has(term)));

  // ───── Items: the structured part
  const wanted = new Map<ID, Item>();
  const addItem = (item: Item) => {
    if (item.status === 'proposed' || item.status === 'dismissed' || wanted.has(item.id)) return;
    wanted.set(item.id, item);
  };
  if (plan.itemKinds.length > 0) {
    const all = await itemsRepo.list({ kind: plan.itemKinds });
    for (const item of all) {
      if (OPEN_ONLY.has(item.kind) && item.status !== 'active') continue;
      const day = localDayKey(item.dueAt && OPEN_ONLY.has(item.kind) ? item.dueAt : item.createdAt);
      // Open obligations are shown whatever their age unless the question names a period.
      if (plan.window ? inWindow(day, plan.window) || inWindow(localDayKey(item.createdAt), plan.window) : true) addItem(item);
    }
  }
  const personItems = new Map<ID, Item[]>();
  for (const person of mentioned.values()) {
    const items = await itemsRepo.list({ personId: person.id, status: 'active' });
    personItems.set(person.id, items);
    if (plan.itemKinds.length === 0) items.slice(0, 4).forEach(addItem);
  }

  // ───── The index: the textual part
  const filters = plan.window ? { fromDay: plan.window.startDay, toDay: plan.window.endDay } : undefined;
  const hits = terms.length > 0 ? find(terms.join(' '), { kinds: ['capture', 'item'], limit: 30, combine: 'or', ...(filters && { filters }) }) : [];
  const captureHits = new Map<ID, SearchHit>();
  for (const hit of hits) {
    if (hit.kind === 'capture') captureHits.set(hit.id, hit);
  }
  const hitItemIds = hits.filter((hit) => hit.kind === 'item').map((hit) => hit.id);
  for (const item of await itemsRepo.getMany(hitItemIds)) addItem(item);

  const captureIds = new Set(captureHits.keys());
  for (const person of mentioned.values()) {
    for (const capture of await capturesRepo.list({ personId: person.id, limit: 3, ...(filters ?? {}) })) captureIds.add(capture.id);
  }
  if (terms.length === 0 && plan.window && captureIds.size === 0 && plan.itemKinds.length === 0) {
    // "Что было вчера?": no words to search for, so the records of the period themselves.
    for (const capture of await capturesRepo.list({ fromDay: plan.window.startDay, toDay: plan.window.endDay, limit: ASK_LIMITS.captures })) captureIds.add(capture.id);
  }
  const captures = await capturesRepo.getMany([...captureIds]);
  // Best search match first, then the newest.
  captures.sort((a, b) => (captureHits.get(b.id)?.score ?? 0) - (captureHits.get(a.id)?.score ?? 0) || b.createdAt.localeCompare(a.createdAt));

  const patterns = plan.wantsPatterns
    ? (await patternsRepo.list()).filter((pattern) => pattern.status !== 'rejected' && pattern.status !== 'resolved').sort((a, b) => b.confidence - a.confidence)
    : [];

  // ───── Numbering and the size limit
  const sources: AskSource[] = [];
  const lines: string[] = [];
  let size = 0;
  const add = (kind: SourceKind, id: ID, label: string, description: string, day?: DayKey): void => {
    const code = `${CODE_PREFIX[kind]}${sources.filter((source) => source.kind === kind).length + 1}`;
    const line = `[${code}] ${description}`;
    if (size + line.length > ASK_LIMITS.materialChars) return;
    size += line.length + 1;
    lines.push(line);
    sources.push({ code, kind, id, label, ...(day && { day }) });
  };

  for (const person of [...mentioned.values()].slice(0, ASK_LIMITS.people)) {
    add('person', person.id, person.name, describePerson(person, personItems.get(person.id) ?? []));
  }
  for (const item of sortItems([...wanted.values()]).slice(0, ASK_LIMITS.items)) {
    add('item', item.id, oneLine(item.title, 60), describeItem(item, peopleById), localDayKey(item.createdAt));
  }
  for (const capture of captures.slice(0, ASK_LIMITS.captures)) {
    add('capture', capture.id, oneLine(capture.title ?? capture.summary ?? capture.text, 60), describeCapture(capture, captureHits.get(capture.id)), capture.day);
  }
  for (const pattern of patterns.slice(0, ASK_LIMITS.patterns)) {
    add('pattern', pattern.id, oneLine(pattern.title, 60), describePattern(pattern));
  }
  return { text: lines.join('\n'), sources };
}

/** Obligations with a deadline first (soonest first), then the newest. */
function sortItems(items: Item[]): Item[] {
  return items.sort((a, b) => (a.dueAt ?? '\uffff').localeCompare(b.dueAt ?? '\uffff') || b.createdAt.localeCompare(a.createdAt));
}

// ───────── Citations ─────────

export interface Citation extends AskSource {
  /** How many times the answer refers to it. */
  mentions: number;
}

export interface CitedText {
  /** The answer without the codes the model made up. */
  text: string;
  citations: Citation[];
  unknownCodes: string[];
}

const CITATION_GROUP = /\[\s*([a-z]\d{1,3}(?:\s*[,;]\s*[a-z]\d{1,3})*)\s*\]/gi;
const CODE = /[a-z]\d{1,3}/gi;

/** Reads `[c3]`, `[c3][i7]` and `[c3, i7]` out of an answer; codes that are not among `sources` are dropped from the text. */
export function parseCitations(text: string, sources: readonly AskSource[]): CitedText {
  const byCode = new Map(sources.map((source) => [source.code.toLowerCase(), source]));
  const cited = new Map<string, Citation>();
  const unknown = new Set<string>();

  const cleaned = text.replace(CITATION_GROUP, (_group, inside: string) => {
    const known: string[] = [];
    for (const raw of inside.match(CODE) ?? []) {
      const code = raw.toLowerCase();
      const source = byCode.get(code);
      if (source) {
        known.push(code);
        cited.set(code, { ...source, mentions: (cited.get(code)?.mentions ?? 0) + 1 });
      } else {
        unknown.add(code);
      }
    }
    return known.length === 0 ? '' : known.map((code) => `[${code}]`).join('');
  });

  return {
    text: cleaned.replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim(),
    citations: [...cited.values()],
    unknownCodes: [...unknown],
  };
}

export type AnswerSegment = { type: 'text'; text: string } | { type: 'ref'; citation: Citation };

/** The answer cut into text and links, so that the UI renders both without touching HTML. */
export function segmentAnswer(text: string, citations: readonly Citation[]): AnswerSegment[] {
  const byCode = new Map(citations.map((citation) => [citation.code.toLowerCase(), citation]));
  const segments: AnswerSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(/\[([a-z]\d{1,3})\]/gi)) {
    const citation = byCode.get(match[1].toLowerCase());
    if (!citation) continue;
    if (match.index > last) segments.push({ type: 'text', text: text.slice(last, match.index) });
    segments.push({ type: 'ref', citation });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
  return segments;
}

// ───────── Asking ─────────

export interface AskDeps extends RetrieveDeps {
  llm: LlmProvider;
  /** Earlier turns of this conversation, oldest first. */
  history?: readonly Msg[];
  signal?: AbortSignal;
  /** Called with each piece of the answer as it arrives (codes are still raw there). */
  onToken?(token: string): void;
}

export interface AskAnswer extends CitedText {
  question: string;
  /** Everything the model was shown, for "what was sent" and for the links. */
  materials: Materials;
  usage: Usage;
}

export async function ask(question: string, deps: AskDeps): Promise<AskAnswer> {
  const trimmed = question.trim();
  const [materials, profile] = await Promise.all([retrieveMaterials(trimmed, deps), profileRepo.get()]);
  const turns = (deps.history ?? []).slice(-ASK_LIMITS.history);
  const result = await deps.llm.chat({
    system: buildAskSystem(profile, materials.text),
    messages: [...turns, { role: 'user', content: trimmed }],
    purpose: 'ask',
    tier: 'fast',
    signal: deps.signal,
    onToken: deps.onToken,
  });
  return { question: trimmed, materials, usage: result.usage, ...parseCitations(result.text, materials.sources) };
}
