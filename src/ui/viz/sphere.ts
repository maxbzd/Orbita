import type { PersonRole } from '../../domain/types';
import { TAU } from './polar';
import { t } from '../../i18n';

/**
 * Math of the people sphere: a Fibonacci lattice of 900 points, latitude belts by kind of
 * relationship, rotation and projection, great-circle arcs. Pure and deterministic.
 */

export const SPHERE_POINTS = 900;
export const GOLDEN_ANGLE = 2.399963229728653;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Point i of n on the unit sphere: y = 1 − 2(i + ½)/n, then the golden angle round the axis. */
export function fibonacciPoint(i: number, n: number = SPHERE_POINTS): Vec3 {
  const y = 1 - (2 * (i + 0.5)) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = i * GOLDEN_ANGLE;
  return { x: r * Math.cos(phi), y, z: r * Math.sin(phi) };
}

export type Belt = 'mentors' | 'family' | 'friends' | 'partners' | 'clients';

/** North to south. Equal y-bands of a sphere have equal area, so every belt has room for the same number of people. */
export const BELTS: readonly Belt[] = ['mentors', 'family', 'friends', 'partners', 'clients'];

export const BELT_LABELS: Record<Belt, string> = {
  get mentors() { return t('Mentors') },
  get family() { return t('Family') },
  get friends() { return t('Friends') },
  get partners() { return t('Partners and colleagues') },
  get clients() { return t('Clients') },
};

export const ROLE_BELT: Record<PersonRole, Belt> = {
  mentor: 'mentors',
  family: 'family',
  friend: 'friends',
  other: 'friends',
  partner: 'partners',
  teammate: 'partners',
  client: 'clients',
};

export const ROLE_LABELS: Record<PersonRole, string> = {
  get partner() { return t('Partner') },
  get teammate() { return t('Colleague') },
  get client() { return t('Client') },
  get friend() { return t('Friend') },
  get family() { return t('Family') },
  get mentor() { return t('Mentor') },
  get other() { return t('Other') },
};

/** The y-range [lo, hi] a belt occupies on the unit sphere. */
export function beltRange(belt: Belt): [number, number] {
  const k = BELTS.indexOf(belt);
  const step = 2 / BELTS.length;
  return [1 - step * (k + 1), 1 - step * k];
}

export interface SpherePersonInput {
  id: string;
  role: PersonRole;
  mentions: number;
}

const PHI_CONJUGATE = 0.6180339887498949;

/**
 * Gives every person one lattice point inside the belt of their role. People are spread over the
 * belt with a low-discrepancy sequence (so neighbours in the list are not neighbours on the sphere);
 * the most mentioned get their pick first. Returns person id → lattice index.
 */
export function assignLattice(people: readonly SpherePersonInput[], n: number = SPHERE_POINTS): Map<string, number> {
  const result = new Map<string, number>();
  for (const belt of BELTS) {
    const [lo, hi] = beltRange(belt);
    const candidates: number[] = [];
    for (let i = 0; i < n; i++) {
      const { y } = fibonacciPoint(i, n);
      if (y >= lo && (y < hi || (belt === 'mentors' && y <= hi))) candidates.push(i);
    }
    const members = people
      .filter((p) => ROLE_BELT[p.role] === belt)
      .sort((a, b) => b.mentions - a.mentions || a.id.localeCompare(b.id));
    const taken = new Set<number>();
    members.forEach((person, j) => {
      if (candidates.length === 0) return;
      let slot = Math.floor((((j + 0.5) * PHI_CONJUGATE) % 1) * candidates.length);
      for (let tries = 0; tries < candidates.length && taken.has(slot); tries++) slot = (slot + 1) % candidates.length;
      taken.add(slot);
      result.set(person.id, candidates[slot]!);
    });
  }
  return result;
}

/** Yaw (about the vertical axis) then pitch (about the horizontal one). */
export function rotate(p: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = p.x * cy + p.z * sy;
  const z1 = -p.x * sy + p.z * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return { x: x1, y: p.y * cp - z1 * sp, z: p.y * sp + z1 * cp };
}

export interface Screen {
  x: number;
  y: number;
  /** Depth after rotation: 1 faces the viewer, −1 is on the far side. */
  z: number;
}

/** Orthographic projection into a canvas of radius `radius` centred on (cx, cy); y is up on the sphere. */
export function project(p: Vec3, radius: number, cx: number, cy: number): Screen {
  return { x: cx + p.x * radius, y: cy - p.y * radius, z: p.z };
}

/** Radius of a person's dot in px for a sphere of the given radius: size follows the mentions. */
export function personDotRadius(mentions: number, maxMentions: number, sphereRadius: number): number {
  const share = maxMentions > 0 ? Math.sqrt(Math.max(0, mentions) / maxMentions) : 0;
  const scale = sphereRadius / 140;
  return (2.6 + 5.4 * share) * scale;
}

/**
 * Points of the great-circle arc between two points on the unit sphere, lifted off the surface by
 * up to `lift` in the middle so an arc reads as a bridge and does not hide in the surface.
 */
export function greatCircleArc(a: Vec3, b: Vec3, steps = 24, lift = 0.16): Vec3[] {
  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  const omega = Math.acos(dot);
  const out: Vec3[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    let x: number;
    let y: number;
    let z: number;
    if (omega < 1e-4) {
      x = a.x;
      y = a.y;
      z = a.z;
    } else {
      const sa = Math.sin((1 - t) * omega) / Math.sin(omega);
      const sb = Math.sin(t * omega) / Math.sin(omega);
      x = a.x * sa + b.x * sb;
      y = a.y * sa + b.y * sb;
      z = a.z * sa + b.z * sb;
    }
    const height = 1 + lift * Math.sin(Math.PI * t) * Math.min(1, omega / 1.2);
    out.push({ x: x * height, y: y * height, z: z * height });
  }
  return out;
}

/**
 * The names for the rim ring: the most mentioned first, as many as fit the ring's length.
 * `charWidth` is the average advance of one character incl. spacing, in px.
 */
export function rimNames(people: readonly { name: string; mentions: number }[], ringLength: number, charWidth = 7.6, separator = '  ·  ', max = 14): string[] {
  const sorted = [...people].sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));
  const out: string[] = [];
  let used = 0;
  for (const person of sorted) {
    const name = person.name.trim().toUpperCase();
    if (!name) continue;
    const cost = (name.length + (out.length > 0 ? separator.length : 0)) * charWidth;
    if (used + cost > ringLength * 0.96 || out.length >= max) break;
    out.push(name);
    used += cost;
  }
  return out;
}

/** Closest drawn person to a pointer, front side only, within the dot plus a touch margin. */
export function pickNearest<T extends { x: number; y: number; z: number; r: number }>(items: readonly T[], px: number, py: number, margin = 10): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const item of items) {
    if (item.z <= 0) continue;
    const distance = Math.hypot(item.x - px, item.y - py);
    if (distance <= item.r + margin && distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

export const REVOLUTION_SECONDS = 120;
/** Per-frame decay of the drag inertia at 60 fps (docs §2.7). */
export const INERTIA_DECAY = 0.94;
export const AUTO_YAW_PER_SECOND = TAU / REVOLUTION_SECONDS;
