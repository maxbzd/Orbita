import { forwardRef } from 'react';
import type { KeyboardEvent, ReactNode, SVGProps } from 'react';
import { cx } from '../primitives/cx';
import styles from './viz.module.css';

export interface SvgHitProps extends Omit<SVGProps<SVGGElement>, 'onClick' | 'role' | 'children'> {
  /** Centre of the hit area and focus ring. */
  x: number;
  y: number;
  /** Radius of the touch target in viewBox units (grown for small dots so a finger can reach them). */
  hit: number;
  /** Radius of the focus ring; defaults to the hit radius. */
  ring?: number;
  /** Custom hit and ring shapes (an arc segment, say) that replace the circle. Give them `hitAreaClass` / `focusRingClass`. */
  shapes?: { hit: ReactNode; ring: ReactNode };
  /** A rectangular target (centred on x, y) instead of a circle: a month title, a bar. */
  rect?: { w: number; h: number };
  /** Accessible name. */
  label: string;
  role?: 'button' | 'radio' | 'option' | 'link';
  checked?: boolean;
  pressed?: boolean;
  onActivate?: () => void;
  /** Without a handler the element is plain decoration: not focusable, hidden from assistive tech. */
  children?: ReactNode;
}

/**
 * An interactive spot inside an SVG figure: `<g role=button>` with a transparent hit circle, the
 * drawing, a `:focus-visible` ring (outlines on SVG shapes are unreliable, so the ring is a shape)
 * and Enter / Space activation. Pass the roving props from `useRoving().itemProps(i)`.
 */
export const hitAreaClass = styles.hitArea;
export const focusRingClass = styles.focusRing;

export const SvgHit = forwardRef<SVGGElement, SvgHitProps>(function SvgHit(
  { x, y, hit, ring, rect, shapes, label, role = 'button', checked, pressed, onActivate, children, className, ...rest },
  ref,
) {
  const interactive = onActivate !== undefined;
  const onKeyDown = (event: KeyboardEvent<SVGGElement>): void => {
    rest.onKeyDown?.(event as never);
    if (event.defaultPrevented || !interactive) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate();
    }
  };
  return (
    <g
      {...rest}
      ref={ref}
      className={cx(interactive && styles.hit, className)}
      role={interactive ? role : undefined}
      aria-label={interactive ? label : undefined}
      aria-checked={interactive && role === 'radio' ? Boolean(checked) : undefined}
      aria-pressed={interactive && role === 'button' ? pressed : undefined}
      aria-hidden={interactive ? undefined : true}
      tabIndex={interactive ? (rest.tabIndex ?? 0) : undefined}
      onClick={interactive ? onActivate : undefined}
      onKeyDown={interactive ? onKeyDown : undefined}
    >
      {interactive ? shapes ? shapes.hit : rect ? <rect x={x - rect.w / 2} y={y - rect.h / 2} width={rect.w} height={rect.h} className={styles.hitArea} /> : <circle cx={x} cy={y} r={hit} className={styles.hitArea} /> : null}
      {children}
      {interactive ? shapes ? shapes.ring : rect ? <rect x={x - rect.w / 2} y={y - rect.h / 2} width={rect.w} height={rect.h} rx={4} className={styles.focusRing} /> : <circle cx={x} cy={y} r={ring ?? hit} className={styles.focusRing} /> : null}
    </g>
  );
});
