import { createElement } from 'react';
import type { HTMLAttributes, MouseEventHandler, ReactNode } from 'react';
import { Icon } from '../icons';
import { cx } from './cx';
import styles from './ListRow.module.css';

export interface ListRowProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'onClick'> {
  /** Left medallion or avatar (a TypeMedallion, usually). */
  leading?: ReactNode;
  title: ReactNode;
  /** Up to two lines under the title, in ink-2. */
  subtitle?: ReactNode;
  /** Small text at the right of the title line ("через 4 дня"). Use `tone` for lateness. */
  meta?: ReactNode;
  /** A separate action at the far right (a check button, a menu). It is NOT inside the row's button. */
  trailing?: ReactNode;
  /** Show the chevron on the right. Defaults to true when the row is clickable. */
  chevron?: boolean;
  /** `danger` colours the meta text (overdue). Never the only signal: the meta text says why. */
  tone?: 'default' | 'danger';
  selected?: boolean;
  disabled?: boolean;
  /** Makes the row a button. */
  onClick?: MouseEventHandler<HTMLElement>;
  /** Makes the row a link (when you need a real URL, e.g. open in a new tab). */
  href?: string;
  /** Wrapper tag: use `li` inside a <ul>. */
  as?: 'div' | 'li';
}

/** A list row of at least 64 px, radius 16: medallion, title, subtitle, meta, chevron, trailing action. */
export function ListRow({
  leading,
  title,
  subtitle,
  meta,
  trailing,
  chevron,
  tone = 'default',
  selected,
  disabled,
  onClick,
  href,
  as = 'div',
  className,
  ...rest
}: ListRowProps) {
  const clickable = Boolean(onClick || href);
  const showChevron = chevron ?? clickable;
  const body = (
    <>
      {leading ? <span className={styles.leading}>{leading}</span> : null}
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
      </span>
      {meta ? <span className={cx(styles.meta, tone === 'danger' && styles.danger)}>{meta}</span> : null}
      {showChevron ? <Icon name="chevron-right" size={20} className={styles.chevron} /> : null}
    </>
  );

  let main: ReactNode;
  if (href) {
    main = (
      <a href={href} className={cx(styles.main, styles.clickable)} aria-current={selected ? 'true' : undefined} onClick={onClick as MouseEventHandler<HTMLAnchorElement> | undefined}>
        {body}
      </a>
    );
  } else if (onClick) {
    main = (
      <button type="button" className={cx(styles.main, styles.clickable)} aria-current={selected ? 'true' : undefined} disabled={disabled} onClick={onClick as MouseEventHandler<HTMLButtonElement>}>
        {body}
      </button>
    );
  } else {
    main = <div className={styles.main}>{body}</div>;
  }

  return createElement(
    as,
    { className: cx(styles.row, selected && styles.selected, disabled && styles.disabled, className), ...rest },
    main,
    trailing ? <div className={styles.trailing}>{trailing}</div> : null,
  );
}
