import type { CSSProperties } from 'react';
import { cx } from '../primitives/cx';
import styles from './OrbSphere.module.css';

export interface OrbSphereProps {
  /** Diameter in px. 68 for the navigation sphere, 28 for the sidebar mark. */
  size?: number;
  className?: string;
}

/**
 * The CSS sphere: the default for every orb slot of the shell, and the fallback of the real Canvas orb on
 * the low tier. A radial gradient and one soft glow; breathes only if the tier allows (--anim-breathe).
 */
export function OrbSphere({ size = 68, className }: OrbSphereProps) {
  return <span className={cx(styles.sphere, className)} style={{ '--sphere': `${size}px` } as CSSProperties} aria-hidden="true" />;
}
