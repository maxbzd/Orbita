import { localDayKey } from '../domain/dates';
import { normalizeForSearch, truncate } from '../domain/text';
import type { Capture, CaptureKind, DayKey, ID, ISODate, Item, ItemKind, ItemStatus, Person, Project } from '../domain/types';

/** What the index knows about: the four tables people actually look things up in. */
export const SEARCH_KINDS = ['capture', 'item', 'person', 'project'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** Search kind of each Dexie table that is indexed. */
export const SEARCH_KIND_OF_TABLE = { captures: 'capture', items: 'item', people: 'person', projects: 'project' } as const satisfies Record<
  string,
  SearchKind
>;
export type SearchTable = keyof typeof SEARCH_KIND_OF_TABLE;

/** Records that can be indexed, by the table they live in. */
export interface SearchableRecords {
  captures: Capture;
  items: Item;
  people: Person;
  projects: Project;
}

/** Text fields of the index, in the order matches are reported (the most telling first). */
export const SEARCH_FIELDS = [
  'title',
  'name',
  'aliases',
  'tags',
  'keywords',
  'summary',
  'quote',
  'details',
  'body',
  'description',
  'notes',
  'text',
] as const;
export type SearchField = (typeof SEARCH_FIELDS)[number];

/** A match in a short, meaningful field outweighs the same match in the middle of a long transcript. */
export const FIELD_BOOST: Readonly<Record<SearchField, number>> = {
  title: 3,
  name: 3,
  aliases: 2.5,
  tags: 2,
  keywords: 2,
  summary: 1.5,
  quote: 1.2,
  details: 1.2,
  body: 1,
  description: 1,
  notes: 1,
  text: 1,
};

export type SearchFieldTexts = Partial<Record<SearchField, string>>;

/** One indexed record: the texts to search in plus what is needed to filter, rank and label it. */
export interface SearchEntry {
  /** `kind:id` — ids are unique across tables, the prefix keeps keys readable. */
  key: string;
  kind: SearchKind;
  id: ID;
  itemKind?: ItemKind;
  itemStatus?: ItemStatus;
  captureKind?: CaptureKind;
  /** Label for result lists. */
  title: string;
  fields: SearchFieldTexts;
  /** Normalized, for filtering. */
  tags: string[];
  personIds: ID[];
  projectIds: ID[];
  /** Local day of captures and items; people and projects are not tied to a day. */
  day?: DayKey;
  /** The moment the content is about: freshness is measured from it. */
  at: ISODate;
  /** `updatedAt` of the indexed record: unchanged records are not re-indexed. */
  version: ISODate;
}

const LABEL_MAX = 80;
const LIST_SEPARATOR = ', ';

export const searchKey = (kind: SearchKind, id: ID): string => `${kind}:${id}`;

const normalizeTag = (tag: string): string => normalizeForSearch(tag).replace(/^#/, '');

/** Drops empty values, so an empty field never reaches the index. */
function presentFields(fields: Record<string, string | undefined>): SearchFieldTexts {
  const result: SearchFieldTexts = {};
  for (const [field, value] of Object.entries(fields)) {
    if (value !== undefined && value.trim() !== '') result[field as SearchField] = value;
  }
  return result;
}

const joinList = (values: readonly string[] | undefined): string | undefined =>
  values === undefined || values.length === 0 ? undefined : values.join(LIST_SEPARATOR);

function firstLine(text: string): string {
  const line = text.split('\n').find((candidate) => candidate.trim() !== '');
  return line === undefined ? '' : truncate(line.trim(), LABEL_MAX);
}

function captureLabel(capture: Capture): string {
  const title = capture.title?.trim();
  if (title) return title;
  return firstLine(capture.text) || (capture.kind === 'voice' ? 'Голосовая запись' : 'Запись');
}

/** Text of an item that lives outside the shared fields: the heart of a decision, a counterparty, an answer. */
function itemDetails(item: Item): string | undefined {
  const parts: (string | undefined)[] = [];
  switch (item.kind) {
    case 'decision':
      parts.push(item.question, item.chosen, ...item.alternatives, ...item.reasons, item.expected, item.outcome?.note);
      break;
    case 'commitment':
      parts.push(item.counterpartyName);
      break;
    case 'prediction':
      parts.push(item.resolutionNote);
      break;
    case 'question':
      parts.push(item.answer);
      break;
    case 'fact':
      parts.push(item.value);
      break;
    case 'idea':
    case 'task':
    case 'lesson':
      break;
  }
  const present = parts.filter((part): part is string => part !== undefined && part.trim() !== '');
  return present.length > 0 ? present.join('\n') : undefined;
}

/** Trashed captures are not searchable. */
export function captureEntry(capture: Capture): SearchEntry | undefined {
  if (capture.deletedAt !== undefined) return undefined;
  return {
    key: searchKey('capture', capture.id),
    kind: 'capture',
    id: capture.id,
    captureKind: capture.kind,
    title: captureLabel(capture),
    fields: presentFields({
      title: capture.title,
      summary: capture.summary,
      text: capture.text,
      tags: joinList(capture.tags),
    }),
    tags: capture.tags.map(normalizeTag),
    personIds: capture.personIds,
    projectIds: capture.projectIds,
    day: capture.day,
    at: capture.createdAt,
    version: capture.updatedAt,
  };
}

/** Trashed and dismissed items are not searchable: the user already said no to them. */
export function itemEntry(item: Item): SearchEntry | undefined {
  if (item.deletedAt !== undefined || item.status === 'dismissed') return undefined;
  const personIds = item.kind === 'commitment' && item.counterpartyId ? [...item.personIds, item.counterpartyId] : item.personIds;
  return {
    key: searchKey('item', item.id),
    kind: 'item',
    id: item.id,
    itemKind: item.kind,
    itemStatus: item.status,
    title: item.title,
    fields: presentFields({
      title: item.title,
      body: item.body,
      quote: item.quote,
      details: itemDetails(item),
      tags: joinList(item.tags),
    }),
    tags: item.tags.map(normalizeTag),
    personIds,
    projectIds: item.projectIds,
    day: localDayKey(item.createdAt),
    at: item.createdAt,
    version: item.updatedAt,
  };
}

export function personEntry(person: Person): SearchEntry | undefined {
  if (person.deletedAt !== undefined) return undefined;
  return {
    key: searchKey('person', person.id),
    kind: 'person',
    id: person.id,
    title: person.name,
    fields: presentFields({ name: person.name, aliases: joinList(person.aliases), notes: person.notes }),
    tags: [],
    personIds: [person.id],
    projectIds: [],
    at: person.lastMentionAt ?? person.updatedAt,
    version: person.updatedAt,
  };
}

export function projectEntry(project: Project): SearchEntry | undefined {
  if (project.deletedAt !== undefined) return undefined;
  return {
    key: searchKey('project', project.id),
    kind: 'project',
    id: project.id,
    title: project.name,
    fields: presentFields({ name: project.name, description: project.description, keywords: joinList(project.keywords) }),
    tags: [],
    personIds: [],
    projectIds: [project.id],
    at: project.updatedAt,
    version: project.updatedAt,
  };
}

const ENTRY_BUILDERS: { [T in keyof SearchableRecords]: (record: SearchableRecords[T]) => SearchEntry | undefined } = {
  captures: captureEntry,
  items: itemEntry,
  people: personEntry,
  projects: projectEntry,
};

/** The entry of a record, or undefined when it must not be in the index. */
export function entryOf<T extends keyof SearchableRecords>(table: T, record: SearchableRecords[T]): SearchEntry | undefined {
  return ENTRY_BUILDERS[table](record);
}
