import { localDayKey } from '../../domain/dates';
import { countWords } from '../../domain/text';
import type { Capture, CaptureContext, ID } from '../../domain/types';
import { pick } from '../../i18n';
import { capturesA } from './content/captures-a';
import { capturesB } from './content/captures-b';
import { capturesC } from './content/captures-c';
import { capturesD } from './content/captures-d';
import { capturesShort } from './content/captures-short';
import { ids, unitFor } from './context';
import type { SeedContext } from './context';
import type { CaptureSpec } from './specs';
import { plusMinutes } from './time';

/** The authored captures in the current language. */
export const captureSpecs = (): CaptureSpec[] => [...capturesA(), ...capturesB(), ...capturesC(), ...capturesD(), ...capturesShort()];

/** Normal speaking pace, words per second. */
const WORDS_PER_SECOND = 2.4;
const MIN_DURATION_SEC = 15;
/**
 * Recording length relative to the speaking time. On a walk the recording runs hands-free, so there are
 * long pauses to think and to cross a street; at a desk people dictate almost without pauses.
 */
const PAUSE_FACTORS: Record<CaptureContext, readonly [min: number, max: number]> = {
  walk: [1.5, 2.7],
  transit: [1.2, 1.7],
  home: [1.0, 1.35],
  work: [1.0, 1.3],
  other: [1.0, 1.3],
};

/** What a speech recognizer typically produces before the glossary fixes the niche terms. */
const rawMishearings = (): readonly (readonly [string, string])[] =>
  pick(
    [
      ['Lumen', 'loo men'],
      ['MRR', 'm r r'],
      ['MVP', 'm v p'],
      ['CAC and LTV', 'cac and l t v'],
      ['vesting', 'vestin'],
      ['Priya', 'pria'],
      ['Omar', 'oh mar'],
      ['Hana', 'hannah'],
      ['OKR', 'okay are'],
    ],
    [
      ['Lumen', 'люмен'],
      ['MRR', 'эм эр эр'],
      ['MVP', 'эм ви пи'],
      ['CAC и LTV', 'кэк и эл ти ви'],
      ['вестинг', 'вэстинг'],
      ['Прия', 'приа'],
      ['Омар', 'о мар'],
      ['Хана', 'хана'],
      ['OKR', 'окр'],
    ],
  );

function rawTranscript(text: string): string {
  return rawMishearings().reduce((raw, [term, heard]) => raw.split(term).join(heard), text);
}

/** Length of a recording of `text`, with a stable variation per capture. */
function recordedSeconds(spec: CaptureSpec): number {
  const [min, max] = PAUSE_FACTORS[spec.context ?? 'other'];
  const factor = min + (max - min) * unitFor(`duration:${spec.key}`);
  return Math.max(MIN_DURATION_SEC, Math.round((countWords(spec.text) / WORDS_PER_SECOND) * factor));
}

export const idsOf = <K extends string>(keys: readonly K[] | undefined, toId: (key: K) => ID): ID[] =>
  (keys ?? []).map(toId);

/** Authored captures that fall inside the window, oldest first. */
export function buildCaptures(ctx: SeedContext): Capture[] {
  const captures: Capture[] = [];
  for (const spec of captureSpecs()) {
    const created = ctx.clock.at(spec.at);
    const day = localDayKey(created);
    if (day < ctx.firstDay) continue;

    const createdAt = created.toISOString();
    const status = spec.status ?? 'done';
    const processed = status === 'review' || status === 'done';
    // Typed notes are processed at once; spoken ones after transcription and extraction.
    const processingDelayMinutes = spec.kind === 'checkin' ? 0.3 : 1.5 + unitFor(`processed:${spec.key}`);
    const processedAt = processed
      ? new Date(Math.min(new Date(plusMinutes(created, processingDelayMinutes)).getTime(), ctx.clock.now.getTime() - 60_000)).toISOString()
      : undefined;

    const capture: Capture = {
      id: ids.capture(spec.key),
      createdAt,
      updatedAt: processedAt ?? createdAt,
      isDemo: true,
      kind: spec.kind,
      day,
      title: spec.title,
      summary: spec.summary,
      text: spec.text,
      projectIds: idsOf(spec.projects, ids.project),
      personIds: idsOf(spec.people, ids.person),
      tags: [...(spec.tags ?? [])],
      status,
    };
    if (spec.kind === 'voice') {
      capture.durationSec = recordedSeconds(spec);
      capture.rawText = rawTranscript(spec.text);
    } else if (spec.dictated) {
      capture.durationSec = recordedSeconds(spec);
    }
    if (spec.context) capture.context = spec.context;
    if (processedAt) capture.processedAt = processedAt;
    if (spec.pinned) capture.pinned = true;
    if (spec.source) capture.source = { ...spec.source };
    captures.push(capture);
  }
  return captures.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
