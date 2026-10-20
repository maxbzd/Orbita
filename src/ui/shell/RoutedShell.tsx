import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Outlet, useHref, useLocation, useNavigate } from 'react-router-dom';
import { useCaptureShell } from '../../features/capture/shell';
import { createSearchProvider } from '../../features/stream/paletteSearch';
import { AppShell } from './AppShell';
import type { AppShellProps } from './AppShell';
import { ORBIT_LINKS, SECTIONS, destinationForPath, sectionOf } from './destinations';
import type { NavDestination, NavLinkItem } from './destinations';

/** Route to start a recording at once (the PWA shortcut uses the same URL). */
export const RECORD_PATH = '/capture?autostart=1';

type RoutedShellProps = Partial<Omit<AppShellProps, 'children' | 'sections' | 'more' | 'activeId' | 'activeSectionId' | 'routeKey' | 'onNavigate'>> & {
  children?: ReactNode;
};

// One useHref per fixed destination: the arrays are constants, so the hook order never changes.
function useLinks(destinations: readonly NavDestination[]): NavLinkItem[] {
  const hrefs = destinations.map((d) => useHref(d.to)); // eslint-disable-line react-hooks/rules-of-hooks
  return useMemo(
    () => destinations.map((d, i) => ({ id: d.id, label: d.label, icon: d.icon, href: hrefs[i] ?? d.to })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [destinations, hrefs.join('|')],
  );
}

/** Router adapter of the shell: derives the active item from the URL and navigates on clicks. */
export function RoutedShell({ children, onRecord, ...rest }: RoutedShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const sections = useLinks(SECTIONS);
  const more = useLinks(ORBIT_LINKS);

  const destination = destinationForPath(location.pathname);
  const section = sectionOf(destination);

  const onNavigate = useCallback(
    (item: { id: string; href: string }) => {
      const known = [...SECTIONS, ...ORBIT_LINKS].find((d) => d.id === item.id);
      // A recent entry carries a router href ("#/entry/…" under the hash router).
      navigate(known ? known.to : item.href.startsWith('#') ? item.href.slice(1) : item.href);
    },
    [navigate],
  );
  const commandProviders = useMemo(() => [createSearchProvider((path) => navigate(path))], [navigate]);
  // The capture feature supplies the live sphere, the mini recorder / dock and the hold-arc of the sphere.
  const capture = useCaptureShell();
  const record = useCallback(() => (onRecord ? onRecord() : capture.record()), [onRecord, capture.record]);

  // The first path segment keys the cross-fade: tab changes fade, moves inside a section do not flash.
  const routeKey = location.pathname.split('/')[1] ?? '';

  return (
    <AppShell
      sphere={capture.sphere}
      miniRecorder={capture.miniRecorder}
      dock={capture.dock}
      sphereGesture={capture.sphereGesture}
      commandActions={capture.commandActions}
      commandProviders={commandProviders}
      {...rest}
      sections={sections}
      more={more}
      activeId={destination}
      activeSectionId={section}
      routeKey={routeKey}
      onNavigate={onNavigate}
      onRecord={record}
    >
      {children ?? <Outlet />}
      {capture.overlay}
    </AppShell>
  );
}
