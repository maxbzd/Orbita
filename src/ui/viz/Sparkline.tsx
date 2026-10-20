import { useMemo } from 'react';
import type { SVGAttributes } from 'react';
import { cx } from '../primitives/cx';
import { clamp } from './polar';
import styles from './Sparkline.module.css';
import { t } from '../../i18n';

export interface SparklineGeometry {
  /** SVG path of the line (gaps in the data break it into pieces). */
  line: string;
  /** SVG path of the filled area under each piece. */
  area: string;
  /** Position of the last real value, for the end dot. */
  last: { x: number; y: number } | null;
  min: number;
  max: number;
}

/**
 * Turns a series into paths. `null` marks a gap and breaks the line. A single value becomes a dot
 * (no line); a flat series is drawn along the middle. `domain` fixes the vertical range so several
 * sparklines can be compared on one scale.
 */
export function sparklineGeometry(values: ReadonlyArray<number | null>, width: number, height: number, pad = 3, domain?: readonly [number, number]): SparklineGeometry {
  const real = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const min = domain ? domain[0] : real.length ? Math.min(...real) : 0;
  const max = domain ? domain[1] : real.length ? Math.max(...real) : 0;
  const span = max - min;
  const n = values.length;
  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);
  const xAt = (i: number): number => (n <= 1 ? width / 2 : pad + (i / (n - 1)) * innerW);
  const yAt = (v: number): number => (span === 0 ? height / 2 : pad + (1 - clamp((v - min) / span, 0, 1)) * innerH);

  let line = '';
  let area = '';
  let piece: Array<{ x: number; y: number }> = [];
  let last: { x: number; y: number } | null = null;
  const flush = (): void => {
    if (piece.length >= 2) {
      line += piece.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');
      const first = piece[0]!;
      const end = piece[piece.length - 1]!;
      area += `M${first.x.toFixed(1)} ${(height - pad).toFixed(1)}${piece.map((p) => `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('')}L${end.x.toFixed(1)} ${(height - pad).toFixed(1)}Z`;
    }
    piece = [];
  };
  values.forEach((value, i) => {
    if (value === null || !Number.isFinite(value)) {
      flush();
      return;
    }
    const point = { x: xAt(i), y: yAt(value) };
    piece.push(point);
    last = point;
  });
  flush();
  return { line, area, last, min, max };
}

export interface SparklineProps extends Omit<SVGAttributes<SVGSVGElement>, 'viewBox' | 'children' | 'values'> {
  values: ReadonlyArray<number | null>;
  width?: number;
  height?: number;
  /** Line colour: a CSS colour or token. Default ink-2. */
  color?: string;
  /** Fill under the line. Default true. */
  area?: boolean;
  /** Dot on the last value. Default true. */
  showLast?: boolean;
  domain?: readonly [number, number];
  /** Spoken summary; the default reads the range and the last value. */
  summary?: string;
  /** Unit appended to numbers in the default summary ("%"). */
  unit?: string;
}

/** A tiny trend line. It carries no axes: put the number beside it. */
export function Sparkline({ values, width = 96, height = 28, color = 'var(--ink-2)', area = true, showLast = true, domain, summary, unit = '', className, style, ...rest }: SparklineProps) {
  const g = useMemo(() => sparklineGeometry(values, width, height, 3, domain), [values, width, height, domain]);
  const real = values.filter((v): v is number => v !== null);
  const text = summary ?? (real.length === 0 ? t('No data') : t('From {min}{unit} to {max}{unit2}, latest value {v}{unit3}', { min: g.min, unit, max: g.max, unit2: unit, v: real[real.length - 1], unit3: unit }));
  return (
    <svg {...rest} className={cx(styles.spark, className)} style={{ ...style, color }} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={text}>
      {area && g.area ? <path d={g.area} className={styles.area} /> : null}
      {g.line ? <path d={g.line} className={styles.line} /> : null}
      {showLast && g.last ? <circle cx={g.last.x} cy={g.last.y} r={real.length === 1 ? 3 : 2.5} className={styles.dot} /> : null}
    </svg>
  );
}
