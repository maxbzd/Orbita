import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import styles from './ProgressRing.module.css';

export interface RingGeometry {
  radius: number;
  circumference: number;
  /** Visible part of the arc, in px of the circumference. */
  dash: number;
  /** Value after clamping to 0..1. */
  value: number;
}

/** Pure geometry of a ring: radius that keeps the stroke inside the box, and the dash for `value`. */
export function ringGeometry(value: number, size: number, stroke: number): RingGeometry {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const radius = Math.max(0, (size - stroke) / 2);
  const circumference = 2 * Math.PI * radius;
  return { radius, circumference, dash: circumference * clamped, value: clamped };
}

export interface ProgressRingProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** 0..1. Leave undefined for an indeterminate ring (a quarter arc turning slowly). */
  value?: number;
  /** Outer diameter in px. Default 56. */
  size?: number;
  /** Stroke width in px. Default 4. */
  stroke?: number;
  /** Accessible name ("Прогресс паттернов"). */
  label: string;
  /** Spoken value ("6 из 14"); defaults to a percentage. */
  valueText?: string;
  /** Arc colour: a CSS colour or token. Default the AI violet. */
  color?: string;
  /** Centre content: a number, an icon. */
  children?: ReactNode;
}

/** A circular progress arc. The arc fills in 700 ms (`--dur-slow`); under reduced motion it jumps. */
export function ProgressRing({ value, size = 56, stroke = 4, label, valueText, color, className, style, children, ...rest }: ProgressRingProps) {
  const determinate = value !== undefined;
  const g = ringGeometry(value ?? 0.25, size, stroke);
  const center = size / 2;
  return (
    <div
      className={cx(styles.ring, !determinate && styles.indeterminate, className)}
      style={{ width: size, height: size, '--ring-color': color ?? 'var(--ai-2)', ...style } as CSSProperties}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(g.value * 100) : undefined}
      aria-valuetext={determinate ? (valueText ?? `${Math.round(g.value * 100)} %`) : undefined}
      {...rest}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle cx={center} cy={center} r={g.radius} className={styles.track} strokeWidth={stroke} fill="none" />
        <circle
          cx={center}
          cy={center}
          r={g.radius}
          className={styles.arc}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${g.dash} ${g.circumference}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      {children ? <span className={styles.center}>{children}</span> : null}
    </div>
  );
}
