import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import styles from './EmptyState.module.css';

export interface RingDot {
  x: number;
  y: number;
  filled: boolean;
}

/** Dots on a circle, clockwise from the top; the first `value` are filled. Pure, for the progress ring. */
export function ringDots(total: number, value: number, radius: number, centerX: number, centerY: number): RingDot[] {
  const count = Math.max(0, Math.floor(total));
  const filled = Math.max(0, Math.min(count, Math.floor(value)));
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
    return {
      x: Math.round((centerX + radius * Math.cos(angle)) * 100) / 100,
      y: Math.round((centerY + radius * Math.sin(angle)) * 100) / 100,
      filled: i < filled,
    };
  });
}

/** Fixed star positions of the sleeping constellation (a small "ковш" with a tail) on a 160x120 grid. */
const STARS: ReadonlyArray<readonly [number, number, number]> = [
  [22, 84, 2.2],
  [50, 62, 2.8],
  [78, 70, 2],
  [104, 46, 3.2],
  [132, 58, 2.2],
  [118, 90, 2],
  [76, 28, 1.6],
];
const LINES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [3, 5],
  [1, 6],
];

export type EmptyIllustration = 'constellation' | 'planet' | 'ring' | 'none';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** The one phrase: short, warm, no exclamation marks ("Пока тихо. Скажи первую мысль, я разложу её."). */
  title: ReactNode;
  /** An honest counter or reason ("нужно 7 дней данных"). */
  description?: ReactNode;
  /** The one action (a Button). Omit it when there is nothing to do yet. */
  action?: ReactNode;
  /**
   * constellation  sleeping stars joined by thin lines (default);
   * planet         a day without satellites (Сегодня);
   * ring           a ring of dots filling toward a threshold (needs `progress`).
   */
  illustration?: EmptyIllustration;
  /** `ring` only: "6 из 14". */
  progress?: { value: number; total: number };
  /** Less padding, for a block inside a card. */
  compact?: boolean;
}

/** Calm empty state: one sleeping object, one phrase, one action. */
export function EmptyState({ title, description, action, illustration = 'constellation', progress, compact, className, ...rest }: EmptyStateProps) {
  return (
    <div className={cx(styles.empty, compact && styles.compact, className)} {...rest}>
      {illustration === 'none' ? null : <Illustration kind={illustration} progress={progress} />}
      <p className={styles.title}>{title}</p>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}

function Illustration({ kind, progress }: { kind: Exclude<EmptyIllustration, 'none'>; progress: EmptyStateProps['progress'] }) {
  if (kind === 'ring' && progress) {
    const dots = ringDots(progress.total, progress.value, 44, 60, 60);
    return (
      <svg className={styles.art} width="120" height="120" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        {dots.map((dot, i) => (
          <circle key={i} cx={dot.x} cy={dot.y} r={dot.filled ? 3.2 : 2.4} className={dot.filled ? styles.starOn : styles.dotOff} />
        ))}
        <text x="60" y="66" textAnchor="middle" className={styles.counter}>
          {progress.value}/{progress.total}
        </text>
      </svg>
    );
  }
  if (kind === 'planet') {
    return (
      <svg className={styles.art} width="120" height="120" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <ellipse cx="60" cy="60" rx="50" ry="17" transform="rotate(-24 60 60)" className={styles.line} fill="none" strokeDasharray="2 5" />
        <circle cx="60" cy="60" r="19" className={styles.planet} />
      </svg>
    );
  }
  return (
    <svg className={styles.art} width="160" height="120" viewBox="0 0 160 120" aria-hidden="true" focusable="false">
      {LINES.map(([a, b], i) => (
        <line key={i} x1={STARS[a]![0]} y1={STARS[a]![1]} x2={STARS[b]![0]} y2={STARS[b]![1]} className={styles.line} />
      ))}
      {STARS.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} className={styles.starOn} />
      ))}
    </svg>
  );
}
