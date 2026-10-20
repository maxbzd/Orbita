import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useBreakpoint } from '../../styles/media';
import type { Breakpoint } from '../../styles/media';
import { Backdrop } from '../backdrop/Backdrop';
import { Sheet } from '../primitives/Sheet';
import { cx } from '../primitives/cx';
import { CommandPalette } from './CommandPalette';
import type { CommandItem, CommandProvider } from './commandFilter';
import type { NavLinkItem, RecentItem } from './destinations';
import { NavPill } from './NavPill';
import type { SphereGesture } from './NavPill';
import { Rail } from './Rail';
import { ShellContext, useShell, useShellState } from './ShellContext';
import { Sidebar } from './Sidebar';
import styles from './AppShell.module.css';
import { t } from '../../i18n';

export interface AppShellProps {
  /** The routed screen. */
  children: ReactNode;
  /** The four sections (Сегодня · Поток · Орбита · Я) with real hrefs. */
  sections: readonly NavLinkItem[];
  /** Люди · Паттерны · Обзоры for the desktop sidebar. */
  more?: readonly NavLinkItem[];
  /** Id of the active item in `sections` or `more`; null on screens outside the navigation. */
  activeId: string | null;
  /** Id of the active section for the 4-item navigation (differs from `activeId` for people/patterns/reviews). */
  activeSectionId?: string | null;
  /** Changes when the screen changes: the new screen cross-fades in (≤ 160 ms, no slide). */
  routeKey?: string;
  /** Plain click on a navigation link: hand it to the router. */
  onNavigate?(item: Pick<NavLinkItem, 'id' | 'href'>): void;
  /** The sphere / "Записать" button: start recording at once. */
  onRecord?(): void;
  /** Press-and-hold on the phone sphere: the arc of four actions. */
  sphereGesture?: SphereGesture;
  recent?: readonly RecentItem[];
  /** Slot: the Canvas orb in the middle of the phone pill. Default: a 68 px CSS sphere. */
  sphere?: ReactNode;
  /** Slot: the 28 px orb of the rail and sidebar. */
  orb?: ReactNode;
  /** Slot: the mini recorder above the phone pill (shown while a screen holds `useMiniRecorder`). */
  miniRecorder?: ReactNode;
  /** Slot: the 64 px dock recorder of tablet/desktop (falls back to `miniRecorder`). */
  dock?: ReactNode;
  /** Slot: the right panel (details, "Спросить"). A column on desktop, a sheet elsewhere. */
  panel?: ReactNode;
  panelTitle?: string;
  /** Whether the panel starts open on desktop. Default true. */
  defaultPanelOpen?: boolean;
  /** Replaces the default Sky + Aura + grain; pass `null` for none. */
  backdrop?: ReactNode;
  commandActions?: readonly CommandItem[];
  commandProviders?: readonly CommandProvider[];
  /** Forces a layout (tests, previews); otherwise it follows the viewport. */
  layout?: Breakpoint;
}

/** The default backdrop reads the aura a screen requested through `useAura`. */
function ShellBackdrop() {
  const { aura } = useShell();
  return <Backdrop mood={aura.mood} auraIntensity={aura.intensity} auraExtent={aura.extent} />;
}

/**
 * The frame around every screen:
 *   phone    < 768    the glass pill at the bottom, a mini recorder above it;
 *   tablet   768-1279 a 64 px rail, the right panel as a sheet;
 *   desktop  >= 1280  a 240 px sidebar, the centre (max 760), a 340 px right panel and a 64 px dock.
 * It provides ShellContext (hide the navigation, mini recorder, panel, aura) and the Ctrl/⌘+K palette.
 */
export function AppShell({
  children,
  sections,
  more = [],
  activeId,
  activeSectionId,
  routeKey,
  onNavigate,
  onRecord,
  sphereGesture,
  recent,
  sphere,
  orb,
  miniRecorder,
  dock,
  panel,
  panelTitle = t('Details'),
  defaultPanelOpen = true,
  backdrop,
  commandActions = [],
  commandProviders,
  layout: forcedLayout,
}: AppShellProps) {
  const measured = useBreakpoint();
  const layout = forcedLayout ?? measured;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const shell = useShellState(layout, openPalette, defaultPanelOpen);
  const { navHidden, recorderVisible, panelOpen, setPanelOpen } = shell;
  const mainRef = useRef<HTMLElement>(null);

  // Ctrl/⌘+K opens the palette; Ctrl+Shift+R starts a recording (§3.2).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (mod && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'r' && onRecord) {
        event.preventDefault();
        onRecord();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onRecord]);

  const hasRecorderSlot = layout === 'phone' ? Boolean(miniRecorder) : Boolean(dock ?? miniRecorder);
  const showRecorder = recorderVisible && hasRecorderSlot;
  const showDock = layout !== 'phone' && showRecorder;
  const showMini = layout === 'phone' && showRecorder;
  const wideNav = !navHidden && layout !== 'phone';
  const showPanelColumn = layout === 'desktop' && Boolean(panel) && panelOpen;

  // Toasts sit above whatever is fixed at the bottom of the screen.
  useEffect(() => {
    const root = document.documentElement;
    const offset =
      layout === 'phone' ? (navHidden ? 0 : 74) + (showMini ? 64 : 0) : showDock ? 64 : 0;
    root.style.setProperty('--toast-offset', `${offset}px`);
    return () => {
      root.style.removeProperty('--toast-offset');
    };
  }, [layout, navHidden, showMini, showDock]);

  const actions = useMemo<CommandItem[]>(() => {
    const go: CommandItem[] = [...sections, ...more].map((link) => ({
      id: `go-${link.id}`,
      title: link.label,
      icon: link.icon,
      group: t('Go to'),
      keywords: [t('open'), t('go')],
      run: () => onNavigate?.(link),
    }));
    const record: CommandItem[] = onRecord
      ? [{ id: 'record', title: t('New recording'), icon: 'mic', group: t('Actions'), keywords: [t('record', undefined, 'app-shell'), t('voice'), t('thought')], shortcut: ['Ctrl', 'Shift', 'R'], run: onRecord }]
      : [];
    return [...record, ...commandActions, ...go];
  }, [sections, more, onNavigate, onRecord, commandActions]);

  const sectionActive = activeSectionId === undefined ? activeId : activeSectionId;

  return (
    <ShellContext.Provider value={shell}>
      <div className={styles.shell} data-layout={layout} data-nav-hidden={navHidden ? '' : undefined}>
        {backdrop === undefined ? <ShellBackdrop /> : backdrop}

        <button type="button" className={cx(styles.skip, 'no-callout')} onClick={() => mainRef.current?.focus()}>
          {t('Skip to content')}
        </button>

        {wideNav && layout === 'desktop' ? (
          <Sidebar
            sections={sections}
            more={more}
            recent={recent}
            activeId={activeId}
            onNavigate={onNavigate}
            orb={orb}
            onRecord={onRecord}
            onSearch={openPalette}
            className={styles.navCol}
          />
        ) : null}
        {wideNav && layout === 'tablet' ? (
          <Rail items={sections} activeId={sectionActive} onNavigate={onNavigate} orb={orb} onRecord={onRecord} onSearch={openPalette} className={styles.navCol} />
        ) : null}

        <main
          ref={mainRef}
          tabIndex={-1}
          className={cx(styles.main, navHidden && styles.noNav, showMini && styles.withMini, showDock && styles.withDock)}
        >
          <div key={routeKey} className={styles.page}>
            {children}
          </div>
        </main>

        {showPanelColumn ? (
          <aside className={styles.panel} aria-label={panelTitle}>
            {panel}
          </aside>
        ) : null}

        {showDock ? <div className={styles.dock}>{dock ?? miniRecorder}</div> : null}
        {showMini ? <div className={styles.mini}>{miniRecorder}</div> : null}

        {layout === 'phone' ? (
          <NavPill items={sections} activeId={sectionActive} onNavigate={onNavigate} sphere={sphere} onSphereClick={onRecord} sphereGesture={sphereGesture} hidden={navHidden} />
        ) : null}

        {panel && layout !== 'desktop' ? (
          <Sheet open={panelOpen} onClose={() => setPanelOpen(false)} title={panelTitle} placement="panel">
            {panel}
          </Sheet>
        ) : null}

        <CommandPalette open={paletteOpen} onClose={closePalette} actions={actions} providers={commandProviders} />
      </div>
    </ShellContext.Provider>
  );
}
