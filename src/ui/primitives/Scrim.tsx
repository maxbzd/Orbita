import type { MouseEventHandler } from 'react';
import { cx } from './cx';
import styles from './Scrim.module.css';

/** The dimming layer behind a sheet or dialog. Decorative: closing is also available by Esc and a button. */
export function Scrim({ shown, onClick, className }: { shown: boolean; onClick?: MouseEventHandler<HTMLDivElement>; className?: string }) {
  return <div className={cx(styles.scrim, shown && styles.shown, className)} onClick={onClick} aria-hidden="true" data-testid="scrim" />;
}
