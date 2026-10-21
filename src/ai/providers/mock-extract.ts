import { addDays, weekdayIndex } from '../../domain/dates';
import { pick } from '../prompts/common';
import { nameStem } from '../../domain/names';
import { truncate } from '../../domain/text';
import type { DayKey } from '../../domain/types';
import type { Extraction, ExtractedItem } from '../prompts/schemas';

/**
 * Deterministic stand-in for the extraction model (tests, demo, `VITE_MOCK_AI=1`): finds plausible
 * objects in Russian or English text by keywords. Not clever on purpose — same text, same result, no network.
 */

interface Sentence {
  text: string;
  start: number;
}

const SENTENCE = /[^.!?\n…]+[.!?…]*/g;

function sentencesOf(text: string): Sentence[] {
  const result: Sentence[] = [];
  for (const match of text.matchAll(SENTENCE)) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (trimmed.length < 8) continue;
    result.push({ text: trimmed, start: (match.index ?? 0) + raw.indexOf(trimmed) });
  }
  return result;
}

// ───────── Names ─────────

// i18n-ignore-start: language data (Russian and English rules), not UI text

const KNOWN_FIRST_NAMES = [
  'Маша', 'Саша', 'Даша', 'Паша', 'Миша', 'Коля', 'Катя', 'Оля', 'Аня', 'Таня', 'Лена', 'Ира', 'Наташа', 'Света', 'Настя',
  'Женя', 'Дима', 'Вася', 'Петя', 'Ваня', 'Андрей', 'Алексей', 'Иван', 'Пётр', 'Дмитрий', 'Сергей', 'Михаил', 'Николай',
  'Александр', 'Анна', 'Мария', 'Елена', 'Ольга', 'Наталья', 'Татьяна', 'Екатерина', 'Ирина', 'Светлана', 'Анастасия',
  'Виктор', 'Максим', 'Фёдор', 'Егор', 'Кирилл', 'Роман', 'Денис', 'Антон', 'Илья', 'Никита', 'Алина', 'Алиса', 'Виктория',
  'Юлия', 'Дарья', 'Алёна', 'Ксения', 'Софья', 'Вера', 'Надежда', 'Людмила', 'Галина',
  'Anna', 'Alex', 'Alice', 'Ben', 'Bob', 'Chris', 'Dan', 'David', 'Emma', 'Eric', 'George', 'Hannah', 'Jack', 'James', 'Jane', 'Jennifer',
  'John', 'Julia', 'Kate', 'Laura', 'Lucas', 'Maria', 'Mark', 'Mary', 'Mike', 'Nick', 'Olivia', 'Paul', 'Peter', 'Rachel', 'Sam', 'Sara',
  'Sarah', 'Sophie', 'Steve', 'Tom', 'William',
] as const;

const FIRST_NAME_BY_STEM = new Map(KNOWN_FIRST_NAMES.map((name) => [nameStem(name), name]));

/** Verbs after which a capitalized sentence-initial word is a person, not just the start of a sentence. */
const VERB_AFTER_NAME = /^(promised|said|wrote|called|texted|emailed|asked|agreed|refused|offered|will|owes|wants|sent|told|needs|should|must|is|has|can|обещал|обещала|сказал|сказала|написал|написала|позвонил|позвонила|ждёт|ждет|предложил|предложила|согласился|согласилась|отказался|отказалась|пришлёт|пришлет|скинет|прислал|прислала|должен|должна|хочет|просит|попросил|попросила)$/i;

const NOT_NAMES = new Set([
  'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье', 'январь', 'февраль', 'март', 'апрель', 'май',
  'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь', 'okr', 'kpi', 'вк', 'ютуб', 'телеграм', 'это', 'если', 'когда',
  'потом', 'сегодня', 'завтра', 'вчера', 'надо', 'нужно', 'идея', 'думаю', 'решил', 'решила',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december', 'zoom', 'telegram', 'youtube', 'google', 'slack', 'linkedin',
  'instagram', 'the', 'then', 'this', 'that', 'there', 'when', 'what', 'why', 'how', 'today', 'tomorrow', 'yesterday', 'maybe', 'idea',
  'need', 'must', 'also', 'and', 'but',
]);

/** Dative / accusative / instrumental forms of known names back to the nominative; unknown words stay as written. */
function toNominative(word: string): string {
  return FIRST_NAME_BY_STEM.get(nameStem(word)) ?? word;
}

function wordsWithIndex(sentence: string): { word: string; index: number }[] {
  return [...sentence.matchAll(/[\p{L}][\p{L}-]*/gu)].map((match) => ({ word: match[0], index: match.index ?? 0 }));
}

/** Capitalized words that look like people's names, in order of appearance. */
export function findNames(sentence: string): string[] {
  const tokens = wordsWithIndex(sentence);
  const names: string[] = [];
  tokens.forEach(({ word }, position) => {
    if (word.length < 3 || !/^\p{Lu}/u.test(word) || NOT_NAMES.has(word.toLowerCase())) return;
    const next = tokens[position + 1]?.word ?? '';
    if (position === 0 && !VERB_AFTER_NAME.test(next) && !FIRST_NAME_BY_STEM.has(nameStem(word))) return;
    const name = toNominative(word);
    if (!names.includes(name)) names.push(name);
  });
  return names;
}

// ───────── Dates ─────────

const WEEKDAYS: [RegExp, number][] = [
  [/понедельник|monday/, 0], [/вторник|tuesday/, 1], [/сред[ауы]|wednesday/, 2], [/четверг|thursday/, 3], [/пятниц[ауы]|friday/, 4], [/суббот[ауы]|saturday/, 5], [/воскресень|sunday/, 6],
];

function nextWeekday(from: DayKey, index: number): DayKey {
  const delta = (index - weekdayIndex(from) + 7) % 7 || 7;
  return addDays(from, delta);
}

/** Relative date words of a sentence resolved from the day of the record; null when there is none. */
export function findDueDate(sentence: string, captureDay: DayKey): DayKey | null {
  const lower = sentence.toLowerCase();
  if (/послезавтра|day after tomorrow/.test(lower)) return addDays(captureDay, 2);
  if (/завтра|tomorrow/.test(lower)) return addDays(captureDay, 1);
  if (/через неделю|next week|in a week/.test(lower)) return addDays(captureDay, 7);
  if (/через две недели|in two weeks|in 2 weeks/.test(lower)) return addDays(captureDay, 14);
  if (/через месяц|next month|in a month/.test(lower)) return addDays(captureDay, 30);
  const days = /(?:через|in) (\d{1,2}) (?:дн|день|days?)/.exec(lower);
  if (days) return addDays(captureDay, Number(days[1]));
  for (const [pattern, index] of WEEKDAYS) if (pattern.test(lower)) return nextWeekday(captureDay, index);
  return null;
}

// ───────── Items ─────────

const WORD_PROBABILITY: [RegExp, number][] = [
  [/почти наверняка|точно сбудется|almost certain|for sure/, 0.9],
  [/скорее всего|most likely|very likely/, 0.7],
  [/наверное|возможно|может быть|probably|maybe|perhaps|possibly/, 0.55],
  [/пятьдесят на пятьдесят|50 на 50|50\/50|fifty[- ]fifty|50 50/, 0.5],
  [/почти невозможно|маловероятно|almost impossible|very unlikely/, 0.05],
  [/вряд ли|unlikely/, 0.2],
];

function probabilityOf(lower: string): number | null {
  const percent = /(\d{1,3})\s*(?:%|процент|per ?cent)/.exec(lower);
  if (percent) return Math.min(0.99, Math.max(0.01, Number(percent[1]) / 100));
  for (const [pattern, value] of WORD_PROBABILITY) if (pattern.test(lower)) return value;
  return null;
}

const isPrediction = (lower: string) =>
  /вероятност|шанс|скорее всего|вряд ли|думаю,? что|уверен,? что|наверное|probability|chance|most likely|unlikely|i think|i'?m sure|probably|maybe/.test(lower) && probabilityOf(lower) !== null;
const isCommitment = (lower: string) =>
  /обещал|обещала|пообещал|пообещала|обязал|должен мне|должна мне|мне должны|жду от|жду оплат|жду договор|promised|\bowes? me\b|\bi owe\b|\bowes\b|waiting for .{0,40} from|i'?m waiting for/.test(lower);
const isDecision = (lower: string) =>
  /решил|решила|принял решение|выбираю|выбрал|выбрала|значит,? делаем|отказываюсь|договорились|decided|i choose|\bchose\b|made the decision|we agreed|giving up on/.test(lower);
const isIdea = (lower: string) => /идея|а что если|было бы круто|придумал|можно было бы|\bidea\b|what if|would be (?:cool|great)|came up with/.test(lower);
const isLesson = (lower: string) => /понял,? что|урок|вывод:|вывод —|больше не буду|нельзя |i realized|i learned|lesson|takeaway|never again/.test(lower);
const isQuestion = (lower: string) =>
  /не понимаю|непонятно|вопрос:|почему|стоит ли|что делать|как (?:мне|лучше|правильно|быть)|зачем|i don'?t understand|unclear|question:|\bwhy\b|should i|what to do|how (?:do|can|should) i/.test(lower);
const isTask = (lower: string) => /надо |нужно |не забыть|не забудь|сделаю|напомни|нужна |need to|have to|don'?t forget|remind me|i'?ll do|gotta/.test(lower);
const isFact = (lower: string) => /у меня \d+|сейчас \d+ (?:учеников|клиентов|групп|пользователей)|стоит \d+|платят \d+|i have \d+|currently \d+ (?:users|clients|groups|customers)|costs? \d+|pay \d+/.test(lower);

const MAX_QUOTE = 200;

function titleOf(sentence: string): string {
  const cleaned = sentence.replace(/^(?:ну|так|вот|короче|значит|слушай|well|so|okay|ok|listen)[,\s]+/i, '').replace(/[.!?…]+$/, '');
  return truncate(cleaned.charAt(0).toUpperCase() + cleaned.slice(1), 100);
}

function quoteOf(text: string, sentence: Sentence): string {
  return truncate(text.slice(sentence.start, sentence.start + sentence.text.length), MAX_QUOTE).replace(/…$/, '');
}

function afterKeyword(sentence: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(sentence);
  if (!match) return undefined;
  const rest = sentence.slice(match.index + match[0].length).replace(/^[\s,:—-]+/, '').replace(/[.!?…]+$/, '');
  return rest === '' ? undefined : rest;
}

function commitmentDirection(sentence: string, names: string[]): { direction: 'i_owe' | 'owed_to_me'; counterparty: string | null } {
  const lower = sentence.toLowerCase();
  const keyword = /обещал|обещала|пообещал|пообещала|обязал|должен|должна|должны|жду|promised|\bowes?\b|waiting/.exec(lower);
  const before = keyword ? sentence.slice(0, keyword.index) : '';
  const nameBefore = findNames(before)[0];
  const fromThem = /(?:^|\s)мне(?=\s|[.,!?]|$)|жду|\bowes? me\b|promised me|\bwaiting\b/.test(lower) || (nameBefore !== undefined && !/(^|\s)(?:я|i)(\s|$)/i.test(before));
  if (fromThem) return { direction: 'owed_to_me', counterparty: nameBefore ?? names[0] ?? null };
  return { direction: 'i_owe', counterparty: names.find((name) => name !== nameBefore) ?? null };
}

function itemFor(sentence: Sentence, text: string, captureDay: DayKey): ExtractedItem | null {
  const raw = sentence.text;
  const lower = raw.toLowerCase();
  const names = findNames(raw);
  const base = {
    title: titleOf(raw),
    body: null,
    quote: quoteOf(text, sentence),
    confidence: 0.8,
    people: names,
    projects: [],
    dueDate: findDueDate(raw, captureDay),
    duplicateOf: null,
    tags: [],
  };

  if (isPrediction(lower)) return { kind: 'prediction', ...base, probability: probabilityOf(lower) ?? 0.6 };
  if (isCommitment(lower)) {
    const { direction, counterparty } = commitmentDirection(raw, names);
    return { kind: 'commitment', ...base, direction, counterparty };
  }
  if (isDecision(lower)) {
    const chosen = afterKeyword(raw, /решил[а]?|выбрал[а]?|выбираю|принял решение|значит,? делаем|decided(?: to)?|chose|i choose|made the decision/i) ?? raw;
    const reasonText = afterKeyword(raw, /потому что|так как|ведь|because|since/i);
    const alternative = afterKeyword(raw, /вместо|а не|instead of|rather than/i);
    return {
      kind: 'decision',
      ...base,
      question: null,
      chosen: truncate(chosen.split(/\s+(?:потому что|так как|ведь|because|since)\s+/i)[0], 160),
      alternatives: alternative ? [truncate(alternative.split(/[,;]/)[0], 100)] : [],
      reasons: reasonText ? [truncate(reasonText, 160)] : [],
      expected: null,
    };
  }
  if (isIdea(lower)) return { kind: 'idea', ...base, stage: 'spark' };
  if (isLesson(lower)) return { kind: 'lesson', ...base };
  if (isQuestion(lower)) return { kind: 'question', ...base, confidence: 0.7 };
  if (isTask(lower)) return { kind: 'task', ...base, priority: /срочно|горит|сегодня же|urgent|asap|right away/.test(lower) ? 'high' : null };
  if (isFact(lower)) return { kind: 'fact', ...base, confidence: 0.7, value: /\d+/.exec(raw)?.[0] ?? null };
  return null;
}

// ───────── Mood, tags, context ─────────

const POSITIVE = /отлично|круто|(?:^|\s)рад[а]?(?=\s|[.,!?]|$)|классно|супер|кайф|доволен|доволна|получилось|заряжен|подъём|\bgreat\b|awesome|excellent|\bhappy\b|\bglad\b|excited|it worked|energi[sz]ed/;
const NEGATIVE = /устал[а]?|плохо|бесит|тревожно|злюсь|грустно|выгорел[а]?|не выспал|нет сил|накрыло|переживаю|\btired\b|exhausted|annoy|anxious|\bangry\b|\bsad\b|burn(?:ed|t) out|didn'?t sleep|no energy|overwhelmed|worried|stressed/;
const TIRED = /устал|выгорел|не выспал|нет сил|вымотал|\btired\b|exhausted|burn(?:ed|t) out|didn'?t sleep|no energy/;
const ENERGIZED = /заряжен|подъём|полон сил|энерги|energi[sz]ed|excited|full of energy|pumped/;

function moodOf(text: string): Extraction['mood'] {
  const lower = text.toLowerCase();
  const positive = POSITIVE.test(lower);
  const negative = NEGATIVE.test(lower);
  if (!positive && !negative) return null;
  const valence = positive && negative ? 0 : positive ? 0.6 : -0.6;
  const energy = TIRED.test(lower) ? 0.2 : ENERGIZED.test(lower) ? 0.8 : 0.5;
  const tags: string[] = [];
  if (/сон|спал|выспа|sleep|slept/.test(lower)) tags.push(pick('sleep', 'сон'));
  if (/деньги|оплат|доход|money|payment|income/.test(lower)) tags.push(pick('money', 'деньги'));
  if (/работ|проект|встреч|work|project|meeting/.test(lower)) tags.push(pick('work', 'работа'));
  const sentence = sentencesOf(text).find((candidate) => POSITIVE.test(candidate.text.toLowerCase()) || NEGATIVE.test(candidate.text.toLowerCase()));
  return {
    valence,
    energy,
    focus: null,
    stress: /тревожно|переживаю|накрыло|anxious|worried|overwhelmed|stressed/.test(lower) ? 0.7 : null,
    tags,
    note: null,
    confidence: 0.6,
    quote: sentence ? quoteOf(text, sentence) : null,
  };
}

const tagRules = (): [RegExp, string][] => [
  [/встреч|созвон|звонок|meeting|call\b/, pick('meetings', 'встречи')],
  [/цен[аыуе]|прайс|стоимост|price|pricing|cost/, pick('prices', 'цены')],
  [/реклам|таргет|marketing|\bads?\b/, pick('marketing', 'реклама')],
  [/клиент|заказчик|client|customer/, pick('clients', 'клиенты')],
  [/родител|мама|папа|семь|parents?|mom|dad|family/, pick('family', 'семья')],
  [/экзамен|зачёт|сессия|exam|study|course/, pick('study', 'учёба')],
  [/конверс|воронк|лид|conversion|funnel|lead/, pick('funnel', 'воронка')],
  [/деньги|оплат|доход|выручк|money|payment|revenue|income/, pick('money', 'деньги')],
  [/расписан|перенос|schedule|reschedul/, pick('schedule', 'расписание')],
];

function tagsOf(lower: string): string[] {
  return tagRules().filter(([pattern]) => pattern.test(lower)).map(([, tag]) => tag).slice(0, 4);
}

/** Lines of the form `- Name — …` in one `## Section` of the user message. */
function listedNames(context: string, heading: string): string[] {
  const block = new RegExp(`## (?:${heading})\\n((?:- .*\\n?)+)`).exec(context)?.[1] ?? '';
  return block
    .split('\n')
    .map((line) => /^- ([^—;]+?)(?: —.*)?$/.exec(line)?.[1]?.trim())
    .filter((name): name is string => !!name);
}

export interface MockExtractionInput {
  text: string;
  captureDay: DayKey;
  /** The part of the user message before the record: known people and projects live there. */
  context: string;
}

export function mockExtraction({ text, captureDay, context }: MockExtractionInput): Extraction {
  const sentences = sentencesOf(text);
  const items: ExtractedItem[] = [];
  for (const sentence of sentences) {
    const item = itemFor(sentence, text, captureDay);
    if (item) items.push(item);
  }

  const knownPeople = listedNames(context, 'Known people|Известные люди');
  const lower = text.toLowerCase();
  const projects = listedNames(context, 'Known projects|Известные проекты')
    .filter((name) => lower.includes(name.toLowerCase()))
    .map((name) => ({ name, kind: 'business' as const, keywords: [] }));
  const projectNames = new Set(projects.map((project) => project.name.toLowerCase()));

  const mentioned = new Set<string>();
  for (const sentence of sentences) {
    for (const { word } of wordsWithIndex(sentence.text)) {
      const known = knownPeople.find((name) => nameStem(name.split(' ')[0]) === nameStem(word));
      if (known) mentioned.add(known);
    }
    for (const name of findNames(sentence.text)) if (!projectNames.has(name.toLowerCase())) mentioned.add(name);
  }
  // Items refer to people by the name they were found under; map them onto known full names.
  // "Маша" and "Маша Иванова" in one record are one person: keep the longer name.
  const people = [...mentioned].filter((name) => ![...mentioned].some((other) => other.startsWith(`${name} `)));
  const resolveName = (name: string): string => people.find((full) => nameStem(full.split(' ')[0]) === nameStem(name)) ?? name;
  for (const item of items) {
    item.people = [...new Set(item.people.map(resolveName))];
    if (item.kind === 'commitment' && item.counterparty) item.counterparty = resolveName(item.counterparty);
  }

  const first = sentences[0]?.text ?? text.trim();
  return {
    title: truncate(titleOf(first), 60) || pick('Note', 'Запись'),
    summary: truncate(sentences.slice(0, 2).map((sentence) => sentence.text).join(' '), 220),
    tags: tagsOf(lower),
    mood: moodOf(text),
    items,
    people: people.map((name) => ({
      name,
      aliases: [],
      role: /мама|папа|родител|\bmom\b|\bdad\b|\bparents?\b/.test(lower) ? ('family' as const) : ('other' as const),
      sentiment: null,
      note: null,
    })),
    projects,
    questionsForUser: [],
  };
}
// i18n-ignore-end
