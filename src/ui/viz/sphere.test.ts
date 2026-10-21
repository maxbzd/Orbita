import { describe, expect, it } from 'vitest';
import type { PersonRole } from '../../domain/types';
import {
  BELTS,
  ROLE_BELT,
  SPHERE_POINTS,
  assignLattice,
  beltRange,
  fibonacciPoint,
  greatCircleArc,
  personDotRadius,
  pickNearest,
  project,
  rimNames,
  rotate,
} from './sphere';
import { PERSON_ROLES } from '../../domain/types';

const person = (id: string, role: PersonRole, mentions: number) => ({ id, role, mentions });

describe('Fibonacci sphere', () => {
  it('puts every one of the 900 points on the unit sphere, from north to south', () => {
    const first = fibonacciPoint(0);
    const last = fibonacciPoint(SPHERE_POINTS - 1);
    expect(first.y).toBeGreaterThan(0.99);
    expect(last.y).toBeLessThan(-0.99);
    for (let i = 0; i < SPHERE_POINTS; i += 37) {
      const p = fibonacciPoint(i);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 9);
    }
  });

  it('follows y = 1 − 2(i + ½)/N', () => {
    expect(fibonacciPoint(450).y).toBeCloseTo(1 - (2 * 450.5) / 900);
  });
});

describe('belts', () => {
  it('cut the sphere into equal-area bands, north to south', () => {
    expect(beltRange('mentors')[1]).toBeCloseTo(1);
    expect(beltRange('clients')[0]).toBeCloseTo(-1);
    for (let i = 1; i < BELTS.length; i++) expect(beltRange(BELTS[i]!)[1]).toBeCloseTo(beltRange(BELTS[i - 1]!)[0]);
  });

  it('give every person role a belt', () => {
    for (const role of PERSON_ROLES) expect(BELTS).toContain(ROLE_BELT[role]);
  });
});

describe('assignLattice', () => {
  const people = [
    person('anna', 'client', 14),
    person('boris', 'client', 3),
    person('vera', 'family', 20),
    person('gleb', 'mentor', 5),
    person('dina', 'friend', 1),
    person('egor', 'client', 9),
    person('zoya', 'family', 2),
  ];

  it('gives each person a distinct lattice point', () => {
    const slots = assignLattice(people);
    expect(slots.size).toBe(people.length);
    expect(new Set(slots.values()).size).toBe(people.length);
  });

  it('keeps each person inside the latitude belt of their role', () => {
    const slots = assignLattice(people);
    for (const p of people) {
      const [lo, hi] = beltRange(ROLE_BELT[p.role]);
      const y = fibonacciPoint(slots.get(p.id)!).y;
      expect(y).toBeGreaterThanOrEqual(lo);
      expect(y).toBeLessThanOrEqual(hi);
    }
  });

  it('is deterministic and independent of input order', () => {
    const a = assignLattice(people);
    const b = assignLattice([...people].reverse());
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it('spreads the members of one belt over the belt, not in a clump', () => {
    const many = Array.from({ length: 20 }, (_, i) => person(`s${i}`, 'client', 20 - i));
    const ys = [...assignLattice(many).values()].map((i) => fibonacciPoint(i).y);
    const [lo, hi] = beltRange('clients');
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan((hi - lo) * 0.6);
  });
});

describe('rotation and projection', () => {
  it('leaves the point alone at zero angles', () => {
    const p = { x: 0.3, y: 0.5, z: 0.8 };
    const q = rotate(p, 0, 0);
    expect(q).toEqual(p);
  });

  it('preserves length', () => {
    const p = fibonacciPoint(123);
    const q = rotate(p, 1.1, -0.4);
    expect(Math.hypot(q.x, q.y, q.z)).toBeCloseTo(1, 9);
  });

  it('turns the front to the right when yaw grows', () => {
    const front = rotate({ x: 0, y: 0, z: 1 }, 0.5, 0);
    expect(front.x).toBeGreaterThan(0);
    expect(front.z).toBeGreaterThan(0);
  });

  it('tilts the front down when pitch grows', () => {
    expect(rotate({ x: 0, y: 0, z: 1 }, 0, 0.5).y).toBeLessThan(0);
  });

  it('projects with y up on the sphere and down on the screen', () => {
    const s = project({ x: 0, y: 1, z: 0 }, 100, 160, 160);
    expect(s).toMatchObject({ x: 160, y: 60 });
  });
});

describe('greatCircleArc', () => {
  const a = { x: 1, y: 0, z: 0 };
  const b = { x: 0, y: 1, z: 0 };

  it('starts and ends on the sphere at the two points', () => {
    const arc = greatCircleArc(a, b, 10, 0.2);
    expect(arc).toHaveLength(11);
    expect(arc[0]!.x).toBeCloseTo(1);
    expect(arc[10]!.y).toBeCloseTo(1);
  });

  it('bulges off the surface in the middle', () => {
    const arc = greatCircleArc(a, b, 10, 0.2);
    const mid = arc[5]!;
    expect(Math.hypot(mid.x, mid.y, mid.z)).toBeGreaterThan(1.05);
  });

  it('does not blow up for identical points', () => {
    const arc = greatCircleArc(a, a, 4, 0.2);
    for (const p of arc) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
  });
});

describe('dot size, names and picking', () => {
  it('sizes dots by the square root of mentions', () => {
    expect(personDotRadius(0, 10, 140)).toBeCloseTo(2.6);
    expect(personDotRadius(10, 10, 140)).toBeCloseTo(8);
    expect(personDotRadius(5, 10, 140)).toBeLessThan(personDotRadius(10, 10, 140));
    expect(personDotRadius(5, 0, 140)).toBeCloseTo(2.6);
  });

  it('puts the busiest names on the rim, as many as fit', () => {
    const people = [
      { name: 'Анна', mentions: 3 },
      { name: 'Борис', mentions: 9 },
      { name: 'Вера', mentions: 5 },
    ];
    expect(rimNames(people, 10_000)).toEqual(['БОРИС', 'ВЕРА', 'АННА']);
    expect(rimNames(people, 80)).toEqual(['БОРИС']);
    expect(rimNames([], 1000)).toEqual([]);
  });

  it('picks the nearest front-side person within reach', () => {
    const items = [
      { id: 'a', x: 100, y: 100, z: 0.5, r: 5 },
      { id: 'b', x: 108, y: 100, z: 0.9, r: 5 },
      { id: 'back', x: 160, y: 160, z: -0.5, r: 5 },
    ];
    expect(pickNearest(items, 107, 101)?.id).toBe('b');
    expect(pickNearest(items, 160, 160)).toBeNull(); // far side cannot be picked
    expect(pickNearest(items, 300, 300)).toBeNull();
  });
});
