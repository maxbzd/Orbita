import { t } from '../../i18n';
import { recordsCount } from '../../domain/counts';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useReducedMotion } from '../../styles/theme';
import { cx } from '../primitives/cx';
import { typeColor } from '../primitives/kinds';
import type { TypeKind } from '../primitives/kinds';
import { placeLabels } from './constellationLabels';
import { drawSchedule, edgeProgress, layoutConstellation, normalizeEdges } from './constellationLayout';
import type { ConstellationEdgeInput, ConstellationNodeInput, EdgeStatus } from './constellationLayout';
import { useRoving } from './hooks';
import { lerp } from './polar';
import { SvgHit } from './SvgHit';
import styles from './Constellation.module.css';
import shared from './viz.module.css';

export interface ConstellationNode extends ConstellationNodeInput {
  /** Name for screen readers and tooltips ("Запись 3 окт."). */
  label: string;
  /** Colours the star by record type; without it the star is plain ink. */
  kind?: TypeKind;
}

export interface ConstellationEdge extends ConstellationEdgeInput {
  /** Why the link exists, read aloud ("оба про срок оплаты"). */
  reason?: string;
}

export interface ConstellationProps {
  nodes: readonly ConstellationNode[];
  edges: readonly ConstellationEdge[];
  /** Box of the drawing in viewBox units (it scales to the container). Default 300 × 240. */
  width?: number;
  height?: number;
  /** Draw the lines one after another (≤ 5 lines, ≤ 2.4 s). A tap on the figure skips it. Default true. */
  animate?: boolean;
  /** Called once when the lines are all drawn (also after a skip, and at once without animation). */
  onDrawn?: () => void;
  selectedId?: string | null;
  /** Makes the stars selectable. */
  onSelectNode?: (id: string) => void;
  /** Names next to the stars. Default false: names live in the tooltips and the text list. */
  showLabels?: boolean;
  label?: string;
  className?: string;
}

/** Elapsed ms of the draw-in timeline; `skip` jumps to the end. Without `enabled` it starts finished. */
function useDrawClock(total: number, enabled: boolean, resetKey: string): { elapsed: number; skip: () => void } {
  const [elapsed, setElapsed] = useState(enabled ? 0 : total);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || total <= 0 || typeof requestAnimationFrame !== 'function') {
      setElapsed(total);
      return;
    }
    setElapsed(0);
    let start: number | null = null;
    const step = (now: number): void => {
      start ??= now;
      const value = Math.min(total, now - start);
      setElapsed(value);
      frame.current = value < total ? requestAnimationFrame(step) : null;
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [enabled, total, resetKey]);

  return {
    elapsed,
    skip: () => {
      if (frame.current !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current);
      frame.current = null;
      setElapsed(total);
    },
  };
}

const STATUS_TEXT: Record<EdgeStatus, string> = { get confirmed() { return t('confirmed') }, get candidate() { return t('candidate') } };

/**
 * "Созвездие" (docs §2.2): records as stars, links as lines — dashed means "candidate", solid
 * means "confirmed". Positions come from a deterministic force layout, so the same data always
 * draws the same picture. The links draw themselves in (≤ 5 lines, ≤ 2.4 s, tap to skip) only when
 * there are real links; with reduced motion they are simply there.
 */
export function Constellation({ nodes, edges, width = 300, height = 240, animate = true, onDrawn, selectedId = null, onSelectNode, showLabels = false, label = t('Constellation of records'), className }: ConstellationProps) {
  const reduced = useReducedMotion();
  const placed = useMemo(() => layoutConstellation(nodes, edges, { width, height }), [nodes, edges, width, height]);
  const positions = useMemo(() => new Map(placed.map((p) => [p.node.id, p] as const)), [placed]);
  const links = useMemo(() => normalizeEdges(edges, new Set(nodes.map((n) => n.id))), [edges, nodes]);
  const schedule = useMemo(() => drawSchedule(links.length), [links.length]);
  const signature = useMemo(() => links.map((l) => `${l.a}>${l.b}:${l.status}`).join('|'), [links]);
  const animating = animate && !reduced && links.length > 0;
  const { elapsed, skip } = useDrawClock(schedule.total, animating, signature);
  const drawing = animating && elapsed < schedule.total;
  const labelAt = useMemo(
    () => (showLabels ? placeLabels(placed.map((p) => ({ id: p.node.id, x: p.x, y: p.y, r: p.r, text: p.node.label })), width, height) : null),
    [placed, showLabels, width, height],
  );
  const roving = useRoving({ count: placed.length });

  const announced = useRef(false);
  useEffect(() => {
    if (!drawing && !announced.current) {
      announced.current = true;
      onDrawn?.();
    }
  }, [drawing, onDrawn]);
  useEffect(() => {
    announced.current = false;
  }, [signature]);

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>): void => {
    if (drawing && (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape')) {
      event.preventDefault();
      skip();
    }
  };

  return (
    <figure className={cx(shared.figure, className)}>
      <svg
        className={cx(shared.svg, drawing && styles.skippable)}
        viewBox={`0 0 ${width} ${height}`}
        role={onSelectNode ? 'group' : 'img'}
        aria-label={label}
        onClick={drawing ? skip : undefined}
        onKeyDown={onKeyDown}
        tabIndex={drawing ? 0 : undefined}
      >
        <g aria-hidden="true">
          {links.map((link, i) => {
            const from = positions.get(link.a)!;
            const to = positions.get(link.b)!;
            const timing = schedule.timings[i] ?? { start: 0, duration: 0 };
            const p = animating ? edgeProgress(elapsed, timing) : 1;
            if (p <= 0) return null;
            return (
              <line
                key={`${link.a}-${link.b}`}
                x1={from.x}
                y1={from.y}
                x2={lerp(from.x, to.x, p)}
                y2={lerp(from.y, to.y, p)}
                className={link.status === 'confirmed' ? styles.confirmed : styles.candidate}
              />
            );
          })}
        </g>
        <g role={onSelectNode ? 'group' : undefined} aria-label={onSelectNode ? t('Records') : undefined}>
          {placed.map((p, i) => {
            const color = p.node.kind ? typeColor(p.node.kind) : 'var(--ink)';
            const isSelected = p.node.id === selectedId;
            return (
              <SvgHit
                key={p.node.id}
                x={p.x}
                y={p.y}
                hit={Math.max(16, p.r + 6)}
                ring={p.r + 5}
                label={p.node.label}
                pressed={onSelectNode ? isSelected : undefined}
                onActivate={onSelectNode ? () => onSelectNode(p.node.id) : undefined}
                {...(onSelectNode ? roving.itemProps(i) : {})}
              >
                <title>{p.node.label}</title>
                <circle cx={p.x} cy={p.y} r={p.r * 2.4} style={{ fill: color }} className={styles.glow} />
                <circle cx={p.x} cy={p.y} r={p.r} style={{ fill: color }} className={styles.star} />
                {isSelected ? <circle cx={p.x} cy={p.y} r={p.r + 4} className={styles.selected} /> : null}
                {labelAt ? (
                  <text x={labelAt.get(p.node.id)?.x ?? p.x} y={labelAt.get(p.node.id)?.y ?? p.y + p.r + 13} textAnchor={labelAt.get(p.node.id)?.anchor ?? 'middle'} className={styles.name}>
                    {p.node.label}
                  </text>
                ) : null}
              </SvgHit>
            );
          })}
        </g>
      </svg>
      <figcaption className={shared.srOnly}>
        {links.length === 0
          ? t('{records}, no links.', { records: recordsCount(nodes.length) })
          : t('{records}. Links: {links}.', {
              records: recordsCount(nodes.length),
              links: links
                .map((l) => t('{a} and {b}, {status}{reason}', { a: positions.get(l.a)!.node.label, b: positions.get(l.b)!.node.label, status: STATUS_TEXT[l.status], reason: (l as ConstellationEdge).reason ? `, ${(l as ConstellationEdge).reason}` : '' }))
                .join('; '),
            })}
      </figcaption>
    </figure>
  );
}
