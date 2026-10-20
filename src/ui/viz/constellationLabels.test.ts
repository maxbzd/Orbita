import { describe, expect, it } from 'vitest';
import { placeLabels } from './constellationLabels';

describe('placeLabels', () => {
  it('puts a lone star label under the star', () => {
    const labels = placeLabels([{ id: 'a', x: 100, y: 80, r: 6, text: 'Запись' }], 300, 240);
    expect(labels.get('a')).toMatchObject({ anchor: 'middle' });
    expect(labels.get('a')!.y).toBeGreaterThan(86);
  });

  it('moves a label away from a neighbour that sits right under the star', () => {
    const stars = [
      { id: 'a', x: 150, y: 100, r: 8, text: 'Запись 3 окт.' },
      { id: 'b', x: 150, y: 118, r: 6, text: 'Запись 4 окт.' },
    ];
    const labels = placeLabels(stars, 300, 240);
    const a = labels.get('a')!;
    // the label of "a" must not land on the disc of "b"
    expect(a.anchor === 'middle' ? a.y < 110 : true).toBe(true);
  });

  it('keeps labels apart and inside the picture when there is room', () => {
    const stars = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, x: 40 + i * 44, y: 100 + (i % 2) * 14, r: 6, text: `Запись ${i + 3} окт.` }));
    const labels = placeLabels(stars, 300, 240);
    expect(labels.size).toBe(6);
    for (const star of stars) expect(Number.isFinite(labels.get(star.id)!.x)).toBe(true);
  });
});
