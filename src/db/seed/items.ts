import { addDays, localDayKey } from '../../domain/dates';
import type { Capture, ID, ISODate, Item, ItemBase } from '../../domain/types';
import { commitments } from './content/commitments';
import { decisions } from './content/decisions';
import { ideas } from './content/ideas';
import { predictions } from './content/predictions';
import { facts, lessons, questions, tasks } from './content/small-items';
import { ids, unitFor } from './context';
import type { SeedContext } from './context';
import { DemoContentError } from './errors';
import type { ItemSpec } from './specs';
import { idsOf } from './captures';

/** The authored items in the current language. */
export const itemSpecs = (): ItemSpec[] => [
  ...decisions(),
  ...commitments(),
  ...ideas(),
  ...predictions(),
  ...tasks(),
  ...questions(),
  ...lessons(),
  ...facts(),
];

const MS_PER_MINUTE = 60_000;
/** Items are extracted a couple of minutes after the capture is processed. */
const EXTRACTION_DELAY_MINUTES = 2;
/** Deadlines are end-of-day, so "due today" is never overdue before midnight. */
const DEADLINE_TIME = '23:59';

const pad = (value: number): string => String(value).padStart(2, '0');

/** When something was closed `daysAgo` days ago: a stable time of day between 10:00 and 21:00. */
function closedInstant(ctx: SeedContext, key: string, daysAgo: number, notBefore: number): number {
  const now = ctx.clock.now.getTime();
  let at: number;
  if (daysAgo <= 0) {
    at = now - 150 * MS_PER_MINUTE;
  } else {
    const minutes = 10 * 60 + Math.floor(unitFor(`closed:${key}`) * 11 * 60);
    at = ctx.clock.local(ctx.clock.day(daysAgo), `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`).getTime();
  }
  if (at <= notBefore) at = notBefore + 3 * 60 * MS_PER_MINUTE;
  return Math.min(at, now - MS_PER_MINUTE);
}

/** Drops `undefined` values, so stored records carry only the fields that are set. */
function compact<T extends object>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

interface Source {
  capture?: Capture;
  createdAt: number;
}

/**
 * Items for the captures inside the window. Every quote must be a verbatim substring of its capture
 * (the offset is stored as `quoteStart`); a quote that is not found is a bug in the authored content and
 * makes the whole build fail with the list of offenders.
 */
export function buildItems(ctx: SeedContext, captures: readonly Capture[]): Item[] {
  const now = ctx.clock.now.getTime();
  const captureById = new Map(captures.map((capture) => [capture.id, capture]));
  const perCapture = new Map<ID, number>();
  const problems: string[] = [];
  const items: Item[] = [];

  for (const spec of itemSpecs()) {
    const source = resolveSource(ctx, spec, captureById, perCapture, now);
    if (!source) continue;
    const { capture, createdAt: createdMs } = source;
    const createdAt: ISODate = new Date(createdMs).toISOString();

    let quoteStart: number | undefined;
    if (spec.quote !== undefined) {
      quoteStart = capture?.text.indexOf(spec.quote);
      if (quoteStart === undefined || quoteStart < 0) {
        problems.push(`${spec.key}: quote not found in capture ${spec.cap ?? '(none)'}: “${spec.quote}”`);
        continue;
      }
    }

    const status = spec.status ?? 'active';
    const closed = spec.closed !== undefined ? closedInstant(ctx, spec.key, spec.closed, createdMs) : undefined;
    if ((status === 'done' || status === 'dropped') && closed === undefined) {
      problems.push(`${spec.key}: a closed item has no \`closed\` field`);
      continue;
    }
    const acceptedMs = Math.min(createdMs + (3 + 25 * unitFor(`accepted:${spec.key}`)) * MS_PER_MINUTE, now - 30_000);
    const updatedMs = Math.max(status === 'proposed' ? createdMs : acceptedMs, closed ?? 0);

    const base: ItemBase = {
      id: ids.item(spec.key),
      createdAt,
      updatedAt: new Date(updatedMs).toISOString(),
      isDemo: true,
      kind: spec.kind,
      status,
      title: spec.title,
      body: spec.body,
      captureId: capture?.id,
      quote: spec.quote,
      quoteStart,
      personIds: [...new Set([...idsOf(spec.people, ids.person), ...('who' in spec && spec.who ? [ids.person(spec.who)] : [])])],
      projectIds: idsOf(spec.projects, ids.project),
      tags: [...(spec.tags ?? [])],
      confidence: spec.confidence,
      duplicateOf: spec.duplicateOf ? ids.item(spec.duplicateOf) : undefined,
      dueAt:
        spec.due !== undefined ? ctx.clock.local(addDays(ctx.clock.today, spec.due), DEADLINE_TIME).toISOString() : undefined,
      doneAt: status === 'done' && closed !== undefined ? new Date(closed).toISOString() : undefined,
    };

    items.push(compact(finishItem(ctx, spec, base, closed)));
  }

  if (problems.length > 0) throw new DemoContentError(problems);
  return sanitizeReferences(items);
}

function resolveSource(
  ctx: SeedContext,
  spec: ItemSpec,
  captureById: ReadonlyMap<ID, Capture>,
  perCapture: Map<ID, number>,
  now: number,
): Source | undefined {
  if (spec.cap !== undefined) {
    const capture = captureById.get(ids.capture(spec.cap));
    if (!capture) return undefined;
    const index = perCapture.get(capture.id) ?? 0;
    perCapture.set(capture.id, index + 1);
    const at = new Date(capture.processedAt ?? capture.createdAt).getTime() + EXTRACTION_DELAY_MINUTES * MS_PER_MINUTE;
    return { capture, createdAt: Math.min(at + index * 1000, now - MS_PER_MINUTE) };
  }
  if (spec.at === undefined) throw new DemoContentError([`${spec.key}: needs a capture (cap) or a creation moment (at)`]);
  const created = ctx.clock.at(spec.at);
  return localDayKey(created) < ctx.firstDay ? undefined : { createdAt: created.getTime() };
}

/** Adds the fields specific to each kind. */
function finishItem(ctx: SeedContext, spec: ItemSpec, base: ItemBase, closed: number | undefined): Item {
  switch (spec.kind) {
    case 'decision':
      return {
        ...base,
        kind: 'decision',
        question: spec.question,
        chosen: spec.chosen,
        alternatives: [...spec.alternatives],
        reasons: [...spec.reasons],
        expected: spec.expected,
        reviewAt: base.dueAt,
        outcome: spec.outcome && {
          rating: spec.outcome.rating,
          note: spec.outcome.note,
          at: new Date(closedInstant(ctx, spec.key, spec.outcome.ago, new Date(base.createdAt).getTime())).toISOString(),
        },
      };
    case 'commitment':
      return {
        ...base,
        kind: 'commitment',
        direction: spec.direction,
        counterpartyId: spec.who ? ids.person(spec.who) : undefined,
        counterpartyName: spec.who ? undefined : spec.whoName,
      };
    case 'idea':
      return { ...base, kind: 'idea', stage: spec.stage, relatedIds: (spec.related ?? []).map(ids.item) };
    case 'prediction':
      return {
        ...base,
        kind: 'prediction',
        probability: spec.probability,
        resolvesAt: base.dueAt,
        outcome: spec.outcome,
        resolvedAt: spec.outcome && closed !== undefined ? new Date(closed).toISOString() : undefined,
        resolutionNote: spec.note,
      };
    case 'task':
      return {
        ...base,
        kind: 'task',
        priority: spec.priority,
        scheduledFor: spec.scheduled !== undefined ? addDays(ctx.clock.today, spec.scheduled) : undefined,
      };
    case 'question':
      return { ...base, kind: 'question', answer: spec.answer };
    case 'lesson':
      return { ...base, kind: 'lesson' };
    case 'fact':
      return {
        ...base,
        kind: 'fact',
        value: spec.value,
        validFrom: base.createdAt,
        supersededBy: spec.supersededBy ? ids.item(spec.supersededBy) : undefined,
      };
  }
}

/** References to items that fell out of the window are dropped instead of left dangling. */
function sanitizeReferences(items: Item[]): Item[] {
  const existing = new Set(items.map((item) => item.id));
  return items.map((item) => {
    const next: Item = { ...item };
    if (next.duplicateOf !== undefined && !existing.has(next.duplicateOf)) delete next.duplicateOf;
    if (next.kind === 'idea') next.relatedIds = next.relatedIds.filter((id) => existing.has(id));
    if (next.kind === 'fact' && next.supersededBy !== undefined && !existing.has(next.supersededBy)) {
      delete next.supersededBy;
    }
    return next;
  });
}
