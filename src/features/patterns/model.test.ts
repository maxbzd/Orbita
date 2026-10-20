import { describe, expect, it } from 'vitest';
import type { Pattern } from '../../domain/types';
import { actionsFor, confidenceLabel, constellationOf, inFilter, recomputeMessage, repeatLine, sortForDisplay } from './model';

const pattern = (extra: Partial<Pattern> = {}): Pattern =>
  ({ id: 'p', title: 'T', description: '', kind: 'behavior', evidence: [], confidence: 0.5, status: 'candidate', firstSeenDay: '2026-10-01', lastSeenDay: '2026-10-05', occurrences: 3, createdAt: '', updatedAt: '', ...extra }) as Pattern;

describe('паттерны: модель', () => {
  it('созвездие: звезда на запись, линии по времени; пунктир у кандидата, сплошная у подтверждённого', () => {
    const evidence = [
      { captureId: 'c2', day: '2026-10-03' },
      { captureId: 'c1', day: '2026-10-01' },
      { captureId: 'c1', day: '2026-10-01', quote: 'повтор той же записи' },
      { captureId: 'c3', day: '2026-10-05' },
    ];
    const candidate = constellationOf({ evidence, status: 'candidate' });
    expect(candidate.nodes.map((n) => n.id)).toEqual(['c1', 'c2', 'c3']);
    expect(candidate.edges.map((e) => [e.a, e.b, e.status])).toEqual([
      ['c1', 'c2', 'candidate'],
      ['c2', 'c3', 'candidate'],
    ]);
    expect(constellationOf({ evidence, status: 'confirmed' }).edges.every((e) => e.status === 'confirmed')).toBe(true);
    expect(constellationOf({ evidence: [evidence[0]!], status: 'candidate' }).edges).toEqual([]);
  });

  it('действия зависят от статуса', () => {
    expect(actionsFor('candidate').map((a) => [a.label, a.to])).toEqual([
      ['Да, это про меня', 'confirmed'],
      ['Нет', 'rejected'],
    ]);
    expect(actionsFor('confirmed').map((a) => a.to)).toEqual(['resolved', 'candidate']);
    expect(actionsFor('rejected').map((a) => a.to)).toEqual(['candidate']);
    expect(actionsFor('resolved').map((a) => a.to)).toEqual(['confirmed']);
  });

  it('фильтры и порядок: подтверждённые выше', () => {
    expect(inFilter(pattern({ status: 'confirmed' }), 'current')).toBe(true);
    expect(inFilter(pattern({ status: 'rejected' }), 'current')).toBe(false);
    expect(inFilter(pattern({ status: 'resolved' }), 'resolved')).toBe(true);
    const sorted = sortForDisplay([pattern({ id: 'a', lastSeenDay: '2026-10-09' }), pattern({ id: 'b', status: 'confirmed', lastSeenDay: '2026-10-01' })]);
    expect(sorted.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('тексты: уверенность, повторения, итог пересчёта', () => {
    expect(confidenceLabel(0.62)).toBe('Уверенность средняя, 62 %');
    expect(confidenceLabel(0.9)).toBe('Уверенность высокая, 90 %');
    expect(repeatLine(pattern())).toContain('3 раза');
    expect(recomputeMessage({ created: 0, updated: 0 })).toBe('Новых паттернов не нашёл.');
    expect(recomputeMessage({ created: 2, updated: 1 })).toContain('новых: 2, дополнено: 1');
    expect(recomputeMessage({ created: 0, updated: 0, notEnoughData: true })).toMatch(/мало записей/);
  });
});
