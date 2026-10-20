import { clamp } from './polar';

/**
 * Deterministic force layout for the constellation: no random numbers, no dependencies.
 * Fruchterman–Reingold forces, a fit into the box, then a hard pass that pushes any overlapping
 * nodes apart, so the result never has two nodes on top of each other.
 */

export interface ConstellationNodeInput {
  id: string;
  /** Importance: sets the size of the star (1 = a record, larger = a hub). Default 1. */
  weight?: number;
}

export type EdgeStatus = 'candidate' | 'confirmed';

export interface ConstellationEdgeInput {
  a: string;
  b: string;
  status: EdgeStatus;
}

export interface LayoutOptions {
  width?: number;
  height?: number;
  /** Space kept free round the figure. Default 24. */
  padding?: number;
  /** Rounds of the force simulation. Default 260. */
  iterations?: number;
  /** Radius of a weight-1 node. Default 6. */
  baseRadius?: number;
  /** Minimum free space between two nodes' edges. Default 8. */
  gap?: number;
}

export interface PlacedNode<T extends ConstellationNodeInput = ConstellationNodeInput> {
  node: T;
  x: number;
  y: number;
  r: number;
}

const GOLDEN_ANGLE = 2.399963229728653;

export function nodeRadius(weight = 1, base = 6): number {
  return base + Math.min(Math.max(weight, 1), 6) * 1.1 - 1.1;
}

/** Edges between known nodes, deduplicated (a confirmed duplicate beats a candidate), self-loops dropped. */
export function normalizeEdges<E extends ConstellationEdgeInput>(edges: readonly E[], nodeIds: ReadonlySet<string>): E[] {
  const byPair = new Map<string, E>();
  for (const edge of edges) {
    if (edge.a === edge.b || !nodeIds.has(edge.a) || !nodeIds.has(edge.b)) continue;
    const key = edge.a < edge.b ? `${edge.a}\u0000${edge.b}` : `${edge.b}\u0000${edge.a}`;
    const existing = byPair.get(key);
    if (!existing || (existing.status === 'candidate' && edge.status === 'confirmed')) byPair.set(key, edge);
  }
  return [...byPair.values()];
}

export function layoutConstellation<T extends ConstellationNodeInput>(
  nodes: readonly T[],
  edges: readonly ConstellationEdgeInput[],
  { width = 300, height = 260, padding = 24, iterations = 260, baseRadius = 6, gap = 8 }: LayoutOptions = {},
): Array<PlacedNode<T>> {
  const n = nodes.length;
  if (n === 0) return [];
  const cx = width / 2;
  const cy = height / 2;
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);
  const radii = nodes.map((node) => nodeRadius(node.weight, baseRadius));

  if (n === 1) return [{ node: nodes[0]!, x: cx, y: cy, r: radii[0]! }];

  const index = new Map(nodes.map((node, i) => [node.id, i] as const));
  const links = normalizeEdges(edges, new Set(index.keys())).map((e) => ({
    a: index.get(e.a)!,
    b: index.get(e.b)!,
    strength: e.status === 'confirmed' ? 1 : 0.55,
  }));

  // Start on a golden-angle spiral: even, and the same for the same input.
  const px: number[] = [];
  const py: number[] = [];
  const spread = 0.42 * Math.min(innerW, innerH);
  for (let i = 0; i < n; i++) {
    const radius = spread * Math.sqrt((i + 0.5) / n);
    px.push(cx + radius * Math.cos(i * GOLDEN_ANGLE));
    py.push(cy + radius * Math.sin(i * GOLDEN_ANGLE));
  }

  const k = 0.75 * Math.sqrt((innerW * innerH) / n);
  const dx = new Array<number>(n).fill(0);
  const dy = new Array<number>(n).fill(0);
  const t0 = Math.min(innerW, innerH) / 6;

  for (let step = 0; step < iterations; step++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = px[i]! - px[j]!;
        let vy = py[i]! - py[j]!;
        let dist = Math.hypot(vx, vy);
        if (dist < 0.01) {
          // Two nodes on one spot: separate them along a direction that depends only on their indices.
          const angle = (i * 31 + j * 17) * GOLDEN_ANGLE;
          vx = Math.cos(angle) * 0.01;
          vy = Math.sin(angle) * 0.01;
          dist = 0.01;
        }
        const force = (k * k) / dist;
        const fx = (vx / dist) * force;
        const fy = (vy / dist) * force;
        dx[i]! += fx;
        dy[i]! += fy;
        dx[j]! -= fx;
        dy[j]! -= fy;
      }
    }
    for (const link of links) {
      const vx = px[link.a]! - px[link.b]!;
      const vy = py[link.a]! - py[link.b]!;
      const dist = Math.max(0.01, Math.hypot(vx, vy));
      const force = ((dist * dist) / k) * link.strength;
      const fx = (vx / dist) * force;
      const fy = (vy / dist) * force;
      dx[link.a]! -= fx;
      dy[link.a]! -= fy;
      dx[link.b]! += fx;
      dy[link.b]! += fy;
    }
    const temperature = t0 * (1 - step / iterations) + 0.5;
    for (let i = 0; i < n; i++) {
      // A light pull to the middle keeps separate clusters in one picture.
      dx[i]! += (cx - px[i]!) * 0.08;
      dy[i]! += (cy - py[i]!) * 0.08;
      const len = Math.max(0.01, Math.hypot(dx[i]!, dy[i]!));
      const move = Math.min(len, temperature);
      px[i]! += (dx[i]! / len) * move;
      py[i]! += (dy[i]! / len) * move;
    }
  }

  // Fit the cloud into the box (uniform scale, so shapes are kept), centred.
  const minX = Math.min(...px);
  const maxX = Math.max(...px);
  const minY = Math.min(...py);
  const maxY = Math.max(...py);
  const scale = Math.min(innerW / Math.max(1, maxX - minX), innerH / Math.max(1, maxY - minY));
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  for (let i = 0; i < n; i++) {
    px[i] = cx + (px[i]! - midX) * scale;
    py[i] = cy + (py[i]! - midY) * scale;
  }

  // Hard pass: no two nodes may overlap. If the box is too crowded, shrink the stars and retry.
  let shrink = 1;
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = radii.map((value) => value * shrink);
    if (separate(px, py, r, gap * shrink, padding, width, height)) {
      return nodes.map((node, i) => ({ node, x: px[i]!, y: py[i]!, r: r[i]! }));
    }
    shrink *= 0.85;
  }
  const r = radii.map((value) => value * shrink);
  return nodes.map((node, i) => ({ node, x: px[i]!, y: py[i]!, r: r[i]! }));
}

/** Pushes overlapping nodes apart in place. Returns true when no overlap is left. */
function separate(px: number[], py: number[], r: readonly number[], gap: number, padding: number, width: number, height: number): boolean {
  const n = px.length;
  for (let pass = 0; pass < 400; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const need = r[i]! + r[j]! + gap;
        let vx = px[j]! - px[i]!;
        let vy = py[j]! - py[i]!;
        let dist = Math.hypot(vx, vy);
        if (dist >= need - 1e-6) continue;
        if (dist < 1e-6) {
          const angle = (i * 13 + j * 7) * GOLDEN_ANGLE;
          vx = Math.cos(angle);
          vy = Math.sin(angle);
          dist = 1;
        }
        const push = (need - dist) / 2 + 0.01;
        const ux = vx / dist;
        const uy = vy / dist;
        px[i]! -= ux * push;
        py[i]! -= uy * push;
        px[j]! += ux * push;
        py[j]! += uy * push;
        moved = true;
      }
    }
    for (let i = 0; i < n; i++) {
      px[i] = clamp(px[i]!, padding + r[i]! * 0.5, width - padding - r[i]! * 0.5);
      py[i] = clamp(py[i]!, padding + r[i]! * 0.5, height - padding - r[i]! * 0.5);
    }
    if (!moved) return !hasOverlap(px, py, r, gap);
  }
  return !hasOverlap(px, py, r, gap);
}

function hasOverlap(px: readonly number[], py: readonly number[], r: readonly number[], gap: number): boolean {
  for (let i = 0; i < px.length; i++) {
    for (let j = i + 1; j < px.length; j++) {
      if (Math.hypot(px[i]! - px[j]!, py[i]! - py[j]!) < r[i]! + r[j]! + gap - 1e-3) return true;
    }
  }
  return false;
}

export interface EdgeTiming {
  /** Delay in ms before the line starts to draw. */
  start: number;
  /** Time in ms the line takes. 0 means "already there". */
  duration: number;
}

export interface DrawSchedule {
  timings: EdgeTiming[];
  /** When the last line finishes; 0 when nothing is animated. */
  total: number;
}

/**
 * The "дорисовка" timeline (docs §2.7): lines draw one after another, each in 450 ms, at most 5 of
 * them, and everything is done within 2.4 s. Lines beyond the fifth are simply there.
 */
export function drawSchedule(edgeCount: number, { perEdge = 450, maxAnimated = 5, totalLimit = 2400 }: { perEdge?: number; maxAnimated?: number; totalLimit?: number } = {}): DrawSchedule {
  const animated = Math.min(edgeCount, maxAnimated);
  const timings: EdgeTiming[] = [];
  if (animated === 0) return { timings: Array.from({ length: edgeCount }, () => ({ start: 0, duration: 0 })), total: 0 };
  const stagger = animated > 1 ? Math.min(perEdge, (totalLimit - perEdge) / (animated - 1)) : 0;
  for (let i = 0; i < edgeCount; i++) {
    timings.push(i < animated ? { start: i * stagger, duration: perEdge } : { start: 0, duration: 0 });
  }
  return { timings, total: (animated - 1) * stagger + perEdge };
}

/** 0…1 progress of one line at `elapsed` ms, eased out. */
export function edgeProgress(elapsed: number, timing: EdgeTiming): number {
  if (timing.duration <= 0) return 1;
  const t = clamp((elapsed - timing.start) / timing.duration, 0, 1);
  return 1 - (1 - t) ** 3;
}
