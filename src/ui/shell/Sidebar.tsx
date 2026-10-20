import type { ReactNode } from 'react';
import { Icon } from '../icons';
import { Button } from '../primitives/Button';
import { Kbd, KbdCombo } from '../primitives/Kbd';
import { cx } from '../primitives/cx';
import type { NavLinkItem, RecentItem } from './destinations';
import { NavLink } from './NavLink';
import { OrbSphere } from './OrbSphere';
import styles from './Sidebar.module.css';
import { t } from '../../i18n';

export interface SidebarProps {
  /** Сегодня · Поток · Орбита · Я. */
  sections: readonly NavLinkItem[];
  /** Люди · Паттерны · Обзоры. */
  more?: readonly NavLinkItem[];
  recent?: readonly RecentItem[];
  activeId: string | null;
  onNavigate?(item: Pick<NavLinkItem, 'id' | 'href'>): void;
  /** The 28 px orb next to the name. */
  orb?: ReactNode;
  onRecord?(): void;
  onSearch?(): void;
  /** Shown on the search button, e.g. ['⌘', 'K']. */
  searchKeys?: readonly string[];
  className?: string;
}

/** Desktop navigation, 240 px: orb and name, record button, search, sections, people/patterns/reviews, recent. */
export function Sidebar({ sections, more = [], recent = [], activeId, onNavigate, orb, onRecord, onSearch, searchKeys = ['Ctrl', 'K'], className }: SidebarProps) {
  const renderLink = (item: NavLinkItem): ReactNode => {
    const active = item.id === activeId;
    return (
      <li key={item.id}>
        <NavLink item={item} active={active} onNavigate={onNavigate} className={cx(styles.link, active && styles.active)}>
          <Icon name={item.icon} size={22} />
          <span>{item.label}</span>
        </NavLink>
      </li>
    );
  };

  return (
    <div className={cx(styles.sidebar, className)}>
      <div className={styles.brand}>
        <span className={styles.mark} aria-hidden="true">
          {orb ?? <OrbSphere size={28} />}
        </span>
        <span className={styles.name}>{t('Orbita')}</span>
      </div>

      {onRecord ? (
        <Button variant="primary" size="md" iconStart="mic" fullWidth onClick={onRecord}>
          {t('Record', undefined, 'sidebar')}
        </Button>
      ) : null}
      {onSearch ? (
        <button type="button" className={styles.search} onClick={onSearch} aria-label={t('Search and commands')} aria-keyshortcuts="Control+K Meta+K">
          <Icon name="search" size={20} />
          <span className={styles.searchText}>{t('Search')}</span>
          <KbdCombo keys={searchKeys} />
        </button>
      ) : null}

      <nav aria-label={t('Main navigation')} className={styles.nav}>
        <ul className={styles.list}>{sections.map(renderLink)}</ul>
        {more.length > 0 ? (
          <>
            <p className={styles.caption} id="sidebar-orbit-caption">
              {t('In orbit')}
            </p>
            <ul className={styles.list} aria-labelledby="sidebar-orbit-caption">
              {more.map(renderLink)}
            </ul>
          </>
        ) : null}
      </nav>

      {recent.length > 0 ? (
        <nav aria-label={t('Recent records')} className={styles.recent}>
          <p className={styles.caption}>{t('Recent')}</p>
          <ul className={styles.list}>
            {recent.map((entry) => (
              <li key={entry.id}>
                <NavLink item={{ id: entry.id, href: entry.href }} onNavigate={onNavigate} className={styles.recentLink} title={entry.subtitle ? `${entry.title} — ${entry.subtitle}` : entry.title}>
                  <span className={styles.recentTitle}>{entry.title}</span>
                  {entry.subtitle ? <span className={styles.recentMeta}>{entry.subtitle}</span> : null}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {onRecord ? (
        <p className={styles.hint}>
          <Kbd>Ctrl</Kbd> <Kbd>Shift</Kbd> <Kbd>R</Kbd>{' '}{t('— record')}
        </p>
      ) : null}
    </div>
  );
}
