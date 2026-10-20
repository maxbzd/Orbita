import { normalizeName } from '../domain/names';
import type { ID, Person, PrivacyLevel } from '../domain/types';
import { t } from '../i18n';

/**
 * Name masking for exports (context packs). Deterministic: the same people always get the same labels,
 * so that "Человек A" means one person from the first line to the last. Masking works on the words of the
 * text, not on ids: names inside titles, quotes and notes are found in any Russian case form
 * («Маше», «с Машей», «Марии Ивановой»). Only names of people in the database are known; the report says so.
 */

type NamedPerson = Pick<Person, 'id' | 'name' | 'aliases'>;

export interface Scrubber {
  level: PrivacyLevel;
  /** Text with the names replaced. */
  scrub(text: string): string;
  /** The same for every string inside an object or array. */
  scrubDeep<T>(value: T): T;
  /** What the person is called in the export. */
  labelOf(personId: ID): string;
  /** Things the user should know about the result. */
  warnings: string[];
}

const AUTHOR_ID = '__author__';
/** Names shorter than this (Ия, Ян) are matched exactly: a loose ending would swallow ordinary words. */
const MIN_NAME = 3;

/** Case endings of Russian names; matched after the stem of a word. */
const ENDINGS = ('(?:ами|ями|ого|ему|ому|ией|ей|ой|ою|ею|ом|ем|ём|ью|ам|ям|ах|ях|ев|ов|ым|им|ие|ия|ию|ии|ы|и|а|я|у|ю|е|о|ь|й)?');

const normalizeWord = (word: string): string => word.toLowerCase().replace(/ё/g, 'е');
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** «Мария Иванова» → «М. И.»; «Маша» → «М.». */
export function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .map((part) => [...part].find((char) => /\p{L}/u.test(char)))
    .filter((letter): letter is string => letter !== undefined)
    .map((letter) => `${letter.toUpperCase()}.`);
  return letters.length > 0 ? letters.join(' ') : '?';
}

/** 0 → A, 25 → Z, 26 → AA … */
export function letterLabel(index: number): string {
  let rest = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (rest % 26)) + label;
    rest = Math.floor(rest / 26) - 1;
  } while (rest >= 0);
  return t('Person {label}', { label });
}

/** A pattern that finds `word` in any case form: the stem is matched exactly (е/ё alike), the ending loosely. */
function wordPattern(word: string): string {
  const lower = word.toLowerCase();
  const stem = /[аяйь]$/.test(lower) && lower.length >= MIN_NAME ? lower.slice(0, -1) : lower;
  const letters = [...stem].map((char) => (char === 'е' || char === 'ё' ? '[её]' : escapeRegExp(char))).join('');
  return lower.length >= MIN_NAME ? `${letters}${ENDINGS}` : letters;
}

const phrasePattern = (phrase: string): string => phrase.trim().split(/\s+/).map(wordPattern).join('\\s+');

interface Variant {
  key: string;
  label: string;
}

export function createScrubber(people: readonly NamedPerson[], level: PrivacyLevel, author = ''): Scrubber {
  const warnings: string[] = [];
  const identity: Scrubber = {
    level,
    scrub: (text) => text,
    scrubDeep: (value) => value,
    labelOf: (personId) => people.find((person) => person.id === personId)?.name ?? '',
    warnings,
  };
  if (level === 'full') return identity;

  const everyone: NamedPerson[] = [...people].sort(
    (a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name), 'ru') || a.id.localeCompare(b.id),
  );

  // ───── Labels
  const labels = new Map<ID, string>();
  const taken = new Set<string>();
  const unique = (label: string): string => {
    let candidate = label;
    for (let n = 2; taken.has(candidate); n++) candidate = `${label} (${n})`;
    taken.add(candidate);
    return candidate;
  };
  everyone.forEach((person, index) => {
    labels.set(person.id, unique(level === 'initials' ? initialsOf(person.name) : letterLabel(index)));
  });
  const authorName = author.trim();
  if (authorName !== '') labels.set(AUTHOR_ID, unique(level === 'initials' ? initialsOf(authorName) : t('Author')));

  // ───── Words to find: full names and aliases first, then their separate words
  const variants = new Map<string, Variant>();
  const ambiguous = new Set<string>();
  const addVariant = (text: string, label: string): void => {
    const key = normalizeWord(text.trim());
    if (key === '') return;
    const known = variants.get(key);
    if (!known) variants.set(key, { key: text.trim(), label });
    else if (known.label !== label) ambiguous.add(text.trim());
  };
  const entities: { id: ID; names: string[] }[] = everyone.map((person) => ({ id: person.id, names: [person.name, ...person.aliases] }));
  if (authorName !== '') entities.push({ id: AUTHOR_ID, names: [authorName] });
  for (const entity of entities) {
    const label = labels.get(entity.id) ?? '';
    for (const name of entity.names) {
      addVariant(name, label);
      const parts = name.trim().split(/[\s-]+/).filter((part) => part.length >= 2);
      if (parts.length > 1) parts.forEach((part) => addVariant(part, label));
    }
  }
  if (ambiguous.size > 0) {
    warnings.push(t('The name “{v}” {v2}belongs to several people: in the text it is replaced with the label of the first of them.', { v: [...ambiguous][0], v2: ambiguous.size > 1 ? t('and {v} more ', { v: ambiguous.size - 1 }) : '' }));
  }
  warnings.push(
    t("People's names from your database are replaced (in any grammatical form). Names not in the database, company names and free text in the profile may contain extra details — check the preview before sending."),
  );

  const sorted = [...variants.values()].sort((a, b) => b.key.length - a.key.length);
  if (sorted.length === 0) return { ...identity, labelOf: (id) => labels.get(id) ?? '', warnings };
  const byKey = new Map(sorted.map((variant) => [normalizeWord(variant.key), variant.label]));
  const matcher = new RegExp(`(?<![\\p{L}\\p{N}])(?:${sorted.map((variant) => phrasePattern(variant.key)).join('|')})(?![\\p{L}\\p{N}])`, 'giu');

  // Which label a matched piece of text stands for: the variant it is a case form of.
  const patterns = sorted.map((variant) => ({ regex: new RegExp(`^${phrasePattern(variant.key)}$`, 'iu'), label: variant.label }));
  const labelFor = (matched: string): string => byKey.get(normalizeWord(matched)) ?? patterns.find(({ regex }) => regex.test(matched))?.label ?? '';

  const scrub = (text: string): string => text.replace(matcher, (matched) => labelFor(matched) || matched);
  const scrubDeep = <T>(value: T): T => {
    if (typeof value === 'string') return scrub(value) as T;
    if (Array.isArray(value)) return value.map((entry) => scrubDeep(entry)) as T;
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrubDeep(entry)])) as T;
    }
    return value;
  };

  return { level, scrub, scrubDeep, labelOf: (id) => labels.get(id) ?? '', warnings };
}
