import { describe, expect, it } from 'vitest';
import { drawSchedule, edgeProgress, layoutConstellation, nodeRadius, normalizeEdges } from './constellationLayout';
import type { ConstellationEdgeInput, ConstellationNodeInput } from './constellationLayout';

const makeNodes = (n: number): ConstellationNodeInput[] => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, weight: 1 + (i % 4) }));
const ring = (n: number): ConstellationEdgeInput[] => Array.from({ length: n }, (_, i) => ({ a: `n${i}`, b: `n${(i + 1) % n}`, status: i % 2 ? 'candidate' : 'confirmed' }));

function overlaps(placed: ReturnType<typeof layoutConstellation>, gap = 0): number {
  let count = 0;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const d = Math.hypot(placed[i]!.x - placed[j]!.x, placed[i]!.y - placed[j]!.y);
      if (d < placed[i]!.r + placed[j]!.r + gap - 1e-3) count++;
    }
  }
  return count;
}

describe('layoutConstellation', () => {
  it('is deterministic: the same input draws the same picture', () => {
    const nodes = makeNodes(14);
    const edges = ring(14);
    const a = layoutConstellation(nodes, edges);
    const b = layoutConstellation(nodes, edges);
    expect(b).toEqual(a);
  });

  it('never puts two nodes on top of each other', () => {
    for (const n of [2, 3, 7, 12, 25, 40]) {
      const placed = layoutConstellation(makeNodes(n), ring(n), { width: 300, height: 260 });
      expect(placed).toHaveLength(n);
      expect(overlaps(placed)).toBe(0);
    }
  });

  it('keeps the free gap between neighbours', () => {
    const placed = layoutConstellation(makeNodes(20), ring(20), { gap: 8 });
    expect(overlaps(placed, 8)).toBe(0);
  });

  it('separates nodes that start at the same spot (no edges, many nodes)', () => {
    const placed = layoutConstellation(makeNodes(30), [], { width: 200, height: 200 });
    expect(overlaps(placed)).toBe(0);
  });

  it('keeps everything inside the box', () => {
    const placed = layoutConstellation(makeNodes(25), ring(25), { width: 300, height: 240, padding: 24 });
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(300);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(240);
    }
  });

  it('puts one node in the middle and returns nothing for none', () => {
    expect(layoutConstellation([], [])).toEqual([]);
    const [only] = layoutConstellation([{ id: 'x' }], [], { width: 300, height: 200 });
    expect(only).toMatchObject({ x: 150, y: 100 });
  });

  it('pulls linked nodes closer than unlinked ones', () => {
    const nodes = makeNodes(6);
    const linked = layoutConstellation(nodes, [{ a: 'n0', b: 'n1', status: 'confirmed' }]);
    const free = layoutConstellation(nodes, []);
    const distance = (placed: typeof linked) => Math.hypot(placed[0]!.x - placed[1]!.x, placed[0]!.y - placed[1]!.y);
    expect(distance(linked)).toBeLessThan(distance(free));
  });

  it('draws hubs bigger than single records', () => {
    expect(nodeRadius(1)).toBe(6);
    expect(nodeRadius(4)).toBeGreaterThan(nodeRadius(1));
    expect(nodeRadius(99)).toBe(nodeRadius(6));
  });
});

describe('normalizeEdges', () => {
  const ids = new Set(['a', 'b', 'c']);
  it('drops self loops and unknown ends, and keeps one edge per pair (confirmed wins)', () => {
    const out = normalizeEdges(
      [
        { a: 'a', b: 'a', status: 'confirmed' as const },
        { a: 'a', b: 'zzz', status: 'confirmed' as const },
        { a: 'a', b: 'b', status: 'candidate' as const },
        { a: 'b', b: 'a', status: 'confirmed' as const },
        { a: 'b', b: 'c', status: 'candidate' as const },
      ],
      ids,
    );
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.a === 'b' && e.b === 'a')!.status).toBe('confirmed');
  });
});

describe('drawSchedule (the "дорисовка")', () => {
  it('animates at most five lines, one after another, in under 2.4 s', () => {
    const { timings, total } = drawSchedule(9);
    expect(timings.filter((t) => t.duration > 0)).toHaveLength(5);
    expect(total).toBeLessThanOrEqual(2400);
    for (let i = 1; i < 5; i++) expect(timings[i]!.start).toBeGreaterThan(timings[i - 1]!.start);
    for (const t of timings.slice(0, 5)) expect(t.duration).toBe(450);
    // the rest are already there
    for (const t of timings.slice(5)) expect(t).toEqual({ start: 0, duration: 0 });
  });

  it('takes one line in 450 ms and nothing for no lines', () => {
    expect(drawSchedule(1).total).toBe(450);
    expect(drawSchedule(0)).toEqual({ timings: [], total: 0 });
  });

  it('squeezes the stagger when the limit would be exceeded', () => {
    const { total } = drawSchedule(5, { perEdge: 800, totalLimit: 2400 });
    expect(total).toBeLessThanOrEqual(2400);
  });
});

describe('edgeProgress', () => {
  it('is 0 before the start, 1 after the end and eased in between', () => {
    const timing = { start: 450, duration: 450 };
    expect(edgeProgress(0, timing)).toBe(0);
    expect(edgeProgress(450, timing)).toBe(0);
    expect(edgeProgress(900, timing)).toBe(1);
    const mid = edgeProgress(675, timing);
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(1);
  });

  it('treats an instant line as drawn', () => {
    expect(edgeProgress(0, { start: 0, duration: 0 })).toBe(1);
  });
});
