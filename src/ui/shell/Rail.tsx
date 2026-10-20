import type { ReactNode } from 'react';
import { Icon } from '../icons';
import { cx } from '../primitives/cx';
import type { NavLinkItem } from './destinations';
import { NavLink } from './NavLink';
import { OrbSphere } from './OrbSphere';
import styles from './Rail.module.css';
import { t } from '../../i18n';

export interface RailProps {
  items: readonly NavLinkItem[];
  activeId: string | null;
  onNavigate?(item: Pick<NavLinkItem, 'id' | 'href'>): void;
  /** The 28 px orb mark at the top. */
  orb?: ReactNode;
  onRecord?(): void;
  onSearch?(): void;
  className?: string;
}

/** Tablet navigation: a 64 px rail of icons (the labels are in aria-label and the tooltip). */
export function Rail({ items, activeId, onNavigate, orb, onRecord, onSearch, className }: RailProps) {
  return (
    <nav aria-label={t('Main navigation')} className={cx(styles.rail, className)}>
      <div className={styles.mark} aria-hidden="true">
        {orb ?? <OrbSphere size={28} />}
      </div>
      <ul className={styles.list}>
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <li key={item.id}>
              <NavLink item={item} active={active} onNavigate={onNavigate} className={cx(styles.link, active && styles.active)} aria-label={item.label} title={item.label}>
                <Icon name={item.icon} size={24} />
              </NavLink>
            </li>
          );
        })}
      </ul>
      <div className={styles.foot}>
        {onSearch ? (
          <button type="button" className={styles.link} aria-label={t('Search and commands')} title={t('Search and commands (Ctrl+K)')} onClick={onSearch}>
            <Icon name="search" size={24} />
          </button>
        ) : null}
        {onRecord ? (
          <button type="button" className={cx(styles.link, styles.record)} aria-label={t('Record', undefined, 'rail')} title={t('Record', undefined, 'rail')} onClick={onRecord}>
            <Icon name="mic" size={24} />
          </button>
        ) : null}
      </div>
    </nav>
  );
}
