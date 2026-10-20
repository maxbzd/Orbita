import { normalizeName } from '../domain/names';
import { truncate } from '../domain/text';
import type { Extraction } from './prompts/schemas';

/**
 * Long records (a pasted chat can be hundreds of thousands of characters) are extracted in parts, each
 * part a separate request, and the answers are merged. Parts are plain substrings of the record, so
 * quotes found in any of them can be located in the whole text.
 */

/** Characters per request: about 4–5 thousand tokens of Russian, comfortable for the fast models. */
export const PART_CHARS = 14_000;
/** More than this is left unprocessed (reported as `truncated`): the cost would surprise the user. */
export const MAX_PARTS = 8;

export interface SplitText {
  parts: string[];
  /** The text was longer than `maxParts` parts hold; the tail was not processed. */
  truncated: boolean;
}

/** The last place before `limit` where a part can end without cutting a sentence or a word. */
function breakPoint(text: string, start: number, limit: number): number {
  const window = text.slice(start, limit);
  const floor = Math.floor(window.length * 0.6);
  const paragraph = window.lastIndexOf('\n\n');
  if (paragraph >= floor) return start + paragraph + 2;
  const line = window.lastIndexOf('\n');
  if (line >= floor) return start + line + 1;
  for (let index = window.length - 2; index >= floor; index--) {
    if (/[.!?…]/.test(window[index]) && /\s/.test(window[index + 1])) return start + index + 1;
  }
  const space = window.lastIndexOf(' ');
  return space >= floor ? start + space + 1 : limit;
}

export function splitText(text: string, partChars: number = PART_CHARS, maxParts: number = MAX_PARTS): SplitText {
  if (text.length <= partChars) return { parts: [text], truncated: false };
  const parts: string[] = [];
  let position = 0;
  while (position < text.length && parts.length < maxParts) {
    const limit = Math.min(position + partChars, text.length);
    const end = limit === text.length ? limit : breakPoint(text, position, limit);
    const part = text.slice(position, end).trim();
    if (part !== '') parts.push(part);
    position = end;
  }
  return { parts, truncated: text.slice(position).trim() !== '' };
}

const SUMMARY_MAX = 320;
const TAGS_MAX = 8;
const QUESTIONS_MAX = 3;

/** Merges per-part extractions into one. People and projects are joined by name; repeats of items are the pipeline's job. */
export function mergeExtractions(parts: readonly Extraction[]): Extraction {
  if (parts.length === 1) return parts[0];

  const people = new Map<string, Extraction['people'][number]>();
  for (const person of parts.flatMap((part) => part.people)) {
    const key = normalizeName(person.name);
    const known = people.get(key);
    if (!known) people.set(key, { ...person, aliases: [...person.aliases] });
    else {
      known.aliases = [...new Set([...known.aliases, ...person.aliases])];
      known.sentiment ??= person.sentiment;
      known.note ??= person.note;
      if (known.role === 'other') known.role = person.role;
    }
  }

  const projects = new Map<string, Extraction['projects'][number]>();
  for (const project of parts.flatMap((part) => part.projects)) {
    const key = normalizeName(project.name);
    const known = projects.get(key);
    if (!known) projects.set(key, { ...project, keywords: [...project.keywords] });
    else known.keywords = [...new Set([...known.keywords, ...project.keywords])];
  }

  const moods = parts.flatMap((part) => (part.mood ? [part.mood] : []));
  const mood = moods.reduce<Extraction['mood']>((best, candidate) => (best && best.confidence >= candidate.confidence ? best : candidate), null);

  return {
    title: parts[0].title,
    summary: truncate(
      parts
        .map((part) => part.summary.trim())
        .filter((summary) => summary !== '')
        .join(' '),
      SUMMARY_MAX,
    ),
    tags: [...new Set(parts.flatMap((part) => part.tags))].slice(0, TAGS_MAX),
    mood,
    items: parts.flatMap((part) => part.items),
    people: [...people.values()],
    projects: [...projects.values()],
    questionsForUser: [...new Set(parts.flatMap((part) => part.questionsForUser))].slice(0, QUESTIONS_MAX),
  };
}
