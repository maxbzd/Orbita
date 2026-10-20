import type { ReactNode } from 'react';
import { Heading } from '../../ui';
import styles from './Settings.module.css';

export interface GroupProps {
  /** Anchor: `/settings?section=<id>` scrolls here. */
  id: string;
  title: string;
  /** A sentence under the card (iOS footer). */
  footer?: ReactNode;
  children: ReactNode;
}

/** An iOS-style group: a caption, a card of rows, an explanation underneath. */
export function Group({ id, title, footer, children }: GroupProps) {
  return (
    <section id={`section-${id}`} className={styles.group} aria-labelledby={`group-${id}`}>
      <Heading as="h2" variant="headline" id={`group-${id}`} className={styles.groupTitle}>
        {title}
      </Heading>
      <div className={styles.card}>{children}</div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </section>
  );
}

/** One row inside a card: label and optional hint above the control. */
export function Row({ label, hint, children }: { label?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.row}>
      {label ? <span className={styles.rowLabel}>{label}</span> : null}
      {children}
      {hint ? <span className={styles.rowHint}>{hint}</span> : null}
    </div>
  );
}
