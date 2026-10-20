import type { Capture, DayKey, Pattern, PatternEvidence } from '../../domain/types';
import { patternSpecs } from './content/patterns';
import { ids } from './context';
import type { SeedContext } from './context';
import { DemoContentError } from './errors';

const MS_PER_HOUR = 3_600_000;
/** A pattern needs at least two quotes to be worth showing. */
const MIN_EVIDENCE = 2;

/**
 * Patterns with quotes from the demo captures. The weekly search found each of them after its second
 * quote and refreshed it whenever a new quote appeared; confirmed ones were answered a day later.
 */
export function buildPatterns(ctx: SeedContext, captures: readonly Capture[]): Pattern[] {
  const byId = new Map(captures.map((capture) => [capture.id, capture]));
  const now = ctx.clock.now.getTime();
  const problems: string[] = [];
  const patterns: Pattern[] = [];

  for (const spec of patternSpecs()) {
    const evidence: { entry: PatternEvidence; at: string }[] = [];
    for (const item of spec.evidence) {
      const capture = byId.get(ids.capture(item.cap));
      if (!capture) continue;
      if (!capture.text.includes(item.quote)) {
        problems.push(`${spec.key}: quote not found in capture ${item.cap}: “${item.quote}”`);
        continue;
      }
      evidence.push({ entry: { captureId: capture.id, quote: item.quote, day: capture.day }, at: capture.createdAt });
    }
    if (evidence.length < MIN_EVIDENCE) continue;

    evidence.sort((a, b) => a.at.localeCompare(b.at));
    const days: DayKey[] = evidence.map(({ entry }) => entry.day);
    const found = ctx.clock.at({ d: spec.foundD, t: '08:30' }).getTime();
    const secondQuote = new Date(evidence[1].at).getTime() + MS_PER_HOUR;
    const createdMs = Math.min(Math.max(found, secondQuote), now - 5 * 60_000);
    const lastQuote = new Date(evidence[evidence.length - 1].at).getTime() + MS_PER_HOUR;
    const answeredMs = spec.status === 'candidate' ? 0 : createdMs + 26 * MS_PER_HOUR;
    const updatedMs = Math.min(Math.max(createdMs, lastQuote, answeredMs), now - 2 * 60_000);

    const createdAt = new Date(createdMs).toISOString();
    const pattern: Pattern = {
      id: ids.pattern(spec.key),
      createdAt,
      updatedAt: new Date(updatedMs).toISOString(),
      isDemo: true,
      title: spec.title,
      description: spec.description,
      kind: spec.kind,
      evidence: evidence.map(({ entry }) => entry),
      confidence: spec.confidence,
      status: spec.status,
      firstSeenDay: days[0],
      lastSeenDay: days[days.length - 1],
      occurrences: Math.max(spec.occurrences ?? 0, evidence.length),
    };
    if (spec.suggestion) pattern.suggestion = spec.suggestion;
    patterns.push(pattern);
  }

  if (problems.length > 0) throw new DemoContentError(problems);
  return patterns;
}
