import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { mentionsCount } from '../../domain/counts';
import type { PersonRole } from '../../domain/types';
import { useTheme } from '../../styles/theme';
import { useDocumentVisible, useOnScreen, useOverlayOpen } from '../../styles/media';
import { useReducedMotion } from '../../styles/theme';
import { cx } from '../primitives/cx';
import { clamp, TAU } from './polar';
import {
  AUTO_YAW_PER_SECOND,
  BELTS,
  BELT_LABELS,
  INERTIA_DECAY,
  ROLE_BELT,
  ROLE_LABELS,
  SPHERE_POINTS,
  assignLattice,
  fibonacciPoint,
  greatCircleArc,
  personDotRadius,
  pickNearest,
  project,
  rimNames,
  rotate,
} from './sphere';
import type { Vec3 } from './sphere';
import styles from './People.module.css';
import shared from './viz.module.css';
import { t } from '../../i18n';

export interface SpherePerson {
  id: string;
  name: string;
  role: PersonRole;
  /** How many times the person was mentioned: sets the size of the dot. */
  mentions: number;
}

export interface PeopleSphereProps {
  people: readonly SpherePerson[];
  selectedId?: string | null;
  /** Pairs of people who appear together; the arcs are drawn only for the selected person. */
  links?: ReadonlyArray<{ a: string; b: string }>;
  onSelect?: (id: string | null) => void;
  /** Largest width in CSS px. Default 320. */
  size?: number;
  /** The sphere turns by itself (one revolution in 120 s). Default true; off in the low tier. */
  autoRotate?: boolean;
  /** auto: the static list under reduced motion, the sphere otherwise. */
  variant?: 'auto' | 'sphere' | 'list';
  label?: string;
  className?: string;
}

const VIEW = 320;
const CENTER = VIEW / 2;
const RADIUS = 124;
const RING_RADIUS = 144;

let latticeCache: Vec3[] | null = null;
function lattice(): Vec3[] {
  latticeCache ??= Array.from({ length: SPHERE_POINTS }, (_, i) => fibonacciPoint(i, SPHERE_POINTS));
  return latticeCache;
}

interface Palette {
  person: string;
  dust: string;
  selected: string;
  arc: string;
}

const FALLBACK_PALETTE: Palette = { person: '#5fd8c8', dust: '#8d93b0', selected: '#f2eddc', arc: '#f2eddc' };

function readPalette(el: Element | null): Palette {
  if (!el || typeof getComputedStyle !== 'function') return FALLBACK_PALETTE;
  const style = getComputedStyle(el);
  const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
  return {
    person: read('--t-person', FALLBACK_PALETTE.person),
    dust: read('--ink-3', FALLBACK_PALETTE.dust),
    selected: read('--cta-bg', FALLBACK_PALETTE.selected),
    arc: read('--cta-bg', FALLBACK_PALETTE.arc),
  };
}

interface Drawn {
  id: string;
  x: number;
  y: number;
  z: number;
  r: number;
}

interface Scene {
  people: readonly SpherePerson[];
  slots: Map<string, number>;
  usedSlots: Set<number>;
  maxMentions: number;
  selectedId: string | null;
  links: ReadonlyArray<{ a: string; b: string }>;
  palette: Palette;
}

/** Paints one frame into a context that is already scaled to the 320 × 320 design box. */
export function drawSphere(ctx: CanvasRenderingContext2D, yaw: number, pitch: number, scene: Scene): Drawn[] {
  ctx.clearRect(0, 0, VIEW, VIEW);
  const points = lattice();

  // Dust: every lattice point that is not a person. Far side is barely there.
  ctx.fillStyle = scene.palette.dust;
  for (let i = 0; i < points.length; i++) {
    if (scene.usedSlots.has(i)) continue;
    const q = rotate(points[i]!, yaw, pitch);
    const near = q.z > 0;
    ctx.globalAlpha = near ? 0.16 + 0.34 * q.z : 0.05;
    const s = near ? 1.1 + 0.7 * q.z : 0.8;
    ctx.fillRect(CENTER + q.x * RADIUS - s / 2, CENTER - q.y * RADIUS - s / 2, s, s);
  }

  // People, far side first so the near side paints over it.
  const drawn: Drawn[] = [];
  for (const person of scene.people) {
    const slot = scene.slots.get(person.id);
    if (slot === undefined) continue;
    const q = rotate(points[slot]!, yaw, pitch);
    const s = project(q, RADIUS, CENTER, CENTER);
    const r = personDotRadius(person.mentions, scene.maxMentions, RADIUS) * (0.85 + 0.15 * q.z);
    drawn.push({ id: person.id, x: s.x, y: s.y, z: q.z, r });
  }
  drawn.sort((a, b) => a.z - b.z);
  const selected = scene.selectedId ? drawn.find((d) => d.id === scene.selectedId) : undefined;

  // Arcs of the selected person only: more would be a tangle.
  if (selected && scene.selectedId) {
    const from = points[scene.slots.get(scene.selectedId)!]!;
    ctx.strokeStyle = scene.palette.arc;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    for (const link of scene.links) {
      const other = link.a === scene.selectedId ? link.b : link.b === scene.selectedId ? link.a : null;
      const otherSlot = other ? scene.slots.get(other) : undefined;
      if (otherSlot === undefined) continue;
      const arc = greatCircleArc(from, points[otherSlot]!, 28, 0.2).map((p) => rotate(p, yaw, pitch));
      let open = false;
      for (const p of arc) {
        const sp = project(p, RADIUS, CENTER, CENTER);
        ctx.globalAlpha = p.z > -0.05 ? 0.75 : 0.12;
        if (!open) {
          ctx.beginPath();
          ctx.moveTo(sp.x, sp.y);
          open = true;
        } else {
          ctx.lineTo(sp.x, sp.y);
        }
      }
      ctx.stroke();
    }
  }

  for (const d of drawn) {
    const front = d.z > 0;
    ctx.globalAlpha = front ? 0.6 + 0.4 * d.z : 0.22;
    ctx.fillStyle = d.id === scene.selectedId ? scene.palette.selected : scene.palette.person;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, TAU);
    ctx.fill();
  }
  if (selected) {
    ctx.globalAlpha = selected.z > 0 ? 1 : 0.5;
    ctx.strokeStyle = scene.palette.selected;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(selected.x, selected.y, selected.r + 4, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return drawn;
}

/**
 * "Сфера людей" (docs §3.6): a Fibonacci sphere of 900 points on a canvas. People sit in latitude
 * belts by the kind of relationship, their dot size is the number of mentions, the most active
 * names run round the rim on a text path. Drag to turn it (it keeps turning a little after you
 * let go); arcs are drawn only for the selected person. The list is always reachable: through
 * hidden buttons here, and as the visible static variant under reduced motion.
 */
export function PeopleSphere({ people, selectedId = null, links = [], onSelect, size = VIEW, autoRotate = true, variant = 'auto', label = t('People sphere'), className }: PeopleSphereProps) {
  const reduced = useReducedMotion();
  if (variant === 'list' || (variant === 'auto' && reduced)) {
    return <PeopleSphereList people={people} selectedId={selectedId} onSelect={onSelect} label={label} className={className} />;
  }
  return <SphereView people={people} selectedId={selectedId} links={links} onSelect={onSelect} size={size} autoRotate={autoRotate} label={label} className={className} />;
}

function SphereView({ people, selectedId, links, onSelect, size, autoRotate, label, className }: Required<Pick<PeopleSphereProps, 'people' | 'links' | 'size' | 'autoRotate' | 'label'>> & Pick<PeopleSphereProps, 'selectedId' | 'onSelect' | 'className'>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ringId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const visible = useDocumentVisible();
  const onScreen = useOnScreen(rootRef);
  const overlay = useOverlayOpen();
  const { resolvedTheme } = useTheme();
  const running = visible && onScreen && !overlay;
  const [width, setWidth] = useState(Math.min(size, VIEW));

  const slots = useMemo(() => assignLattice(people), [people]);
  const usedSlots = useMemo(() => new Set(slots.values()), [slots]);
  const maxMentions = useMemo(() => people.reduce((m, p) => Math.max(m, p.mentions), 0), [people]);
  const names = useMemo(() => rimNames(people, TAU * RING_RADIUS), [people]);
  const selected = people.find((p) => p.id === selectedId) ?? null;

  const view = useRef({ yaw: 0.5, pitch: -0.3, vyaw: 0, vpitch: 0, dragging: false, raf: 0, last: 0 });
  const drawnRef = useRef<Drawn[]>([]);
  const sceneRef = useRef<Scene | null>(null);
  const runningRef = useRef(running);
  runningRef.current = running;
  const autoRef = useRef(autoRotate);
  autoRef.current = autoRotate;
  const tickRef = useRef<(now: number) => void>(() => undefined);

  sceneRef.current = { people, slots, usedSlots, maxMentions, selectedId: selectedId ?? null, links, palette: sceneRef.current?.palette ?? FALLBACK_PALETTE };

  const paint = useCallback((): void => {
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !scene) return;
    const dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
    const backing = Math.round(width * dpr);
    if (canvas.width !== backing) {
      canvas.width = backing;
      canvas.height = backing;
    }
    const scale = backing / VIEW;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawnRef.current = drawSphere(ctx, view.current.yaw, view.current.pitch, scene);
  }, [width]);

  const request = useCallback((): void => {
    const v = view.current;
    if (v.raf || !runningRef.current || typeof requestAnimationFrame !== 'function') return;
    v.raf = requestAnimationFrame((now) => tickRef.current(now));
  }, []);

  tickRef.current = (now: number): void => {
    const v = view.current;
    v.raf = 0;
    const dt = Math.min(64, v.last ? now - v.last : 16);
    v.last = now;
    if (!v.dragging) {
      const decay = INERTIA_DECAY ** (dt / 16.67);
      v.yaw += v.vyaw * (dt / 16.67);
      v.pitch = clamp(v.pitch + v.vpitch * (dt / 16.67), -1.2, 1.2);
      v.vyaw *= decay;
      v.vpitch *= decay;
      if (Math.abs(v.vyaw) < 1e-5) v.vyaw = 0;
      if (Math.abs(v.vpitch) < 1e-5) v.vpitch = 0;
      if (autoRef.current) v.yaw += AUTO_YAW_PER_SECOND * (dt / 1000);
    }
    paint();
    if (runningRef.current && (v.dragging || v.vyaw !== 0 || v.vpitch !== 0 || autoRef.current)) request();
    else v.last = 0;
  };

  // Palette follows the theme; one repaint when it (or the data) changes.
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.palette = readPalette(rootRef.current);
    paint();
  }, [resolvedTheme, people, selectedId, links, width, paint]);

  // Start/stop the loop with visibility.
  useEffect(() => {
    if (running) request();
    else {
      const v = view.current;
      if (v.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(v.raf);
      v.raf = 0;
      v.last = 0;
    }
  }, [running, autoRotate, request]);

  useEffect(
    () => () => {
      const v = view.current;
      if (v.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(v.raf);
    },
    [],
  );

  // Measure the container so the canvas backing store matches what is on screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.min(size, w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [size]);

  const gesture = useRef({ x: 0, y: 0, t: 0, moved: 0, lastX: 0, lastY: 0, lastT: 0 });

  const toDesign = (event: PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    const k = rect.width > 0 ? VIEW / rect.width : 1;
    return { x: (event.clientX - rect.left) * k, y: (event.clientY - rect.top) * k };
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    const v = view.current;
    v.dragging = true;
    v.vyaw = 0;
    v.vpitch = 0;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gesture.current = { x: event.clientX, y: event.clientY, t: event.timeStamp, moved: 0, lastX: event.clientX, lastY: event.clientY, lastT: event.timeStamp };
    request();
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    const v = view.current;
    if (!v.dragging) return;
    const g = gesture.current;
    const dx = event.clientX - g.lastX;
    const dy = event.clientY - g.lastY;
    const dt = Math.max(1, event.timeStamp - g.lastT);
    const sensitivity = 0.0085 * (VIEW / Math.max(1, width));
    v.yaw += dx * sensitivity;
    v.pitch = clamp(v.pitch + dy * sensitivity, -1.2, 1.2);
    // Velocity in rad per 60 fps frame, lightly smoothed, becomes the inertia on release.
    v.vyaw = 0.6 * v.vyaw + 0.4 * ((dx * sensitivity) / dt) * 16.67;
    v.vpitch = 0.6 * v.vpitch + 0.4 * ((dy * sensitivity) / dt) * 16.67;
    g.moved += Math.abs(dx) + Math.abs(dy);
    g.lastX = event.clientX;
    g.lastY = event.clientY;
    g.lastT = event.timeStamp;
    request();
    if (!running) paint();
  };

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>): void => {
    const v = view.current;
    if (!v.dragging) return;
    v.dragging = false;
    const g = gesture.current;
    // A pause before release kills the inertia, as a held finger would.
    if (event.timeStamp - g.lastT > 90) {
      v.vyaw = 0;
      v.vpitch = 0;
    }
    if (g.moved < 6 && event.timeStamp - g.t < 600 && onSelect) {
      const at = toDesign(event);
      const hit = pickNearest(drawnRef.current, at.x, at.y, 12);
      if (hit) onSelect(hit.id === selectedId ? null : hit.id);
      else if (selectedId) onSelect(null);
    }
    request();
  };

  const circumference = TAU * RING_RADIUS;
  const text = names.join('  ·  ');

  return (
    <div ref={rootRef} className={cx(styles.sphere, className)} style={{ maxWidth: size }}>
      <div className={styles.stage} role="group" aria-label={label}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          width={VIEW}
          height={VIEW}
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        <svg className={styles.rim} viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true" focusable="false">
          <defs>
            <path id={`rim-${ringId}`} d={`M${CENTER} ${CENTER - RING_RADIUS}a${RING_RADIUS} ${RING_RADIUS} 0 1 1 0 ${2 * RING_RADIUS}a${RING_RADIUS} ${RING_RADIUS} 0 1 1 0 ${-2 * RING_RADIUS}`} />
          </defs>
          <text className={styles.rimText}>
            <textPath href={`#rim-${ringId}`} startOffset="0" textLength={text ? circumference * 0.97 : undefined} lengthAdjust="spacing">
              {text}
            </textPath>
          </text>
        </svg>
        <p className={styles.chosen} aria-live="polite">
          {selected ? (
            <>
              <strong>{selected.name}</strong> · {ROLE_LABELS[selected.role]} · {mentionsCount(selected.mentions)}
            </>
          ) : (
            ''
          )}
        </p>
      </div>
      {/* The people as real buttons: the way in for keyboards and screen readers. */}
      <ul className={shared.srOnly} aria-label={t('{label}: list', { label })}>
        {[...people]
          .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name))
          .map((person) => (
            <li key={person.id}>
              <button type="button" aria-pressed={person.id === selectedId} onClick={() => onSelect?.(person.id === selectedId ? null : person.id)}>
                {person.name}, {ROLE_LABELS[person.role]}, {mentionsCount(person.mentions)}
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}

export interface PeopleSphereListProps {
  people: readonly SpherePerson[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  label?: string;
  className?: string;
}

/** The static variant of the sphere: people grouped by belt, a dot sized by mentions, no motion. */
export function PeopleSphereList({ people, selectedId = null, onSelect, label = t('People'), className }: PeopleSphereListProps) {
  const max = people.reduce((m, p) => Math.max(m, p.mentions), 0);
  return (
    <div className={cx(styles.list, className)} role="group" aria-label={label}>
      {BELTS.map((belt) => {
        const members = people.filter((p) => ROLE_BELT[p.role] === belt).sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));
        if (members.length === 0) return null;
        return (
          <section key={belt} className={styles.belt} aria-label={BELT_LABELS[belt]}>
            <h3 className={styles.beltTitle}>{BELT_LABELS[belt]}</h3>
            <ul className={styles.beltList}>
              {members.map((person) => {
                const dot = 8 + 8 * Math.sqrt(max > 0 ? person.mentions / max : 0);
                return (
                  <li key={person.id}>
                    <button type="button" className={styles.person} aria-pressed={person.id === selectedId} onClick={() => onSelect?.(person.id === selectedId ? null : person.id)}>
                      <span className={styles.personDot} style={{ width: dot, height: dot }} aria-hidden="true" />
                      <span className={styles.personName}>{person.name}</span>
                      <span className={styles.personMeta}>{person.mentions}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
