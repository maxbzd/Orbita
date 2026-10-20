import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Breakpoint } from '../../styles/media';
import type { AuraExtent } from '../backdrop';

export interface AuraState {
  mood: number | null;
  intensity: number;
  extent: AuraExtent;
}

export const DEFAULT_AURA: AuraState = { mood: 0, intensity: 0.5, extent: 'hero' };

export interface ShellContextValue {
  /** Current layout: phone pill, tablet rail or desktop sidebar. */
  layout: Breakpoint;
  /** True while any screen asks to hide the navigation (recording, onboarding). */
  navHidden: boolean;
  /** True while any screen asks for the mini recorder / dock. */
  recorderVisible: boolean;
  /** The right panel (details, "Спросить"): a column on desktop, a sheet elsewhere. */
  panelOpen: boolean;
  aura: AuraState;
  /** Hides the navigation until the returned function is called. Counted: holds from several screens stack. */
  holdNavHidden(): () => void;
  /** Shows the mini recorder (phone) or the dock (wide screens) until released. Counted. */
  holdRecorder(): () => void;
  setPanelOpen(open: boolean): void;
  togglePanel(): void;
  setAura(aura: Partial<AuraState> | null): void;
  openCommandPalette(): void;
}

const release0 = (): void => undefined;

const OUTSIDE: ShellContextValue = {
  layout: 'phone',
  navHidden: false,
  recorderVisible: false,
  panelOpen: false,
  aura: DEFAULT_AURA,
  holdNavHidden: () => release0,
  holdRecorder: () => release0,
  setPanelOpen: release0,
  togglePanel: release0,
  setAura: release0,
  openCommandPalette: release0,
};

export const ShellContext = createContext<ShellContextValue>(OUTSIDE);

/** The shell's state and controls. Outside an AppShell every control is a harmless no-op. */
export function useShell(): ShellContextValue {
  return useContext(ShellContext);
}

/** Builds the context value; AppShell calls it once. */
export function useShellState(layout: Breakpoint, openCommandPalette: () => void, defaultPanelOpen: boolean): ShellContextValue {
  const [navHolds, setNavHolds] = useState(0);
  const [recorderHolds, setRecorderHolds] = useState(0);
  // The desktop column and the tablet/phone sheet are remembered separately: resizing a window must not
  // pop a modal sheet open just because the column was showing.
  const [columnOpen, setColumnOpen] = useState(defaultPanelOpen);
  const [sheetOpen, setSheetOpen] = useState(false);
  const wide = layout === 'desktop';
  const panelOpen = wide ? columnOpen : sheetOpen;
  const setPanelOpen = wide ? setColumnOpen : setSheetOpen;
  const [aura, setAuraState] = useState<AuraState>(DEFAULT_AURA);

  const holdNavHidden = useCallback(() => {
    setNavHolds((n) => n + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setNavHolds((n) => Math.max(0, n - 1));
    };
  }, []);

  const holdRecorder = useCallback(() => {
    setRecorderHolds((n) => n + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setRecorderHolds((n) => Math.max(0, n - 1));
    };
  }, []);

  const togglePanel = useCallback(() => setPanelOpen((open) => !open), [setPanelOpen]);
  const setAura = useCallback((next: Partial<AuraState> | null) => {
    setAuraState((prev) => (next === null ? DEFAULT_AURA : { ...prev, ...next }));
  }, []);

  return useMemo(
    () => ({
      layout,
      navHidden: navHolds > 0,
      recorderVisible: recorderHolds > 0,
      panelOpen,
      aura,
      holdNavHidden,
      holdRecorder,
      setPanelOpen,
      togglePanel,
      setAura,
      openCommandPalette,
    }),
    [layout, navHolds, recorderHolds, panelOpen, setPanelOpen, aura, holdNavHidden, holdRecorder, togglePanel, setAura, openCommandPalette],
  );
}

/** Hides the navigation while the calling screen is mounted (recording, onboarding). */
export function useHideNavigation(hidden = true): void {
  const { holdNavHidden } = useShell();
  useEffect(() => (hidden ? holdNavHidden() : undefined), [hidden, holdNavHidden]);
}

/** Shows the mini recorder (phone) or the dock (wide) while `visible` and the screen is mounted. */
export function useMiniRecorder(visible = true): void {
  const { holdRecorder } = useShell();
  useEffect(() => (visible ? holdRecorder() : undefined), [visible, holdRecorder]);
}

/** The right panel's open state and controls. */
export function useRightPanel(): { open: boolean; setOpen(open: boolean): void; toggle(): void } {
  const { panelOpen, setPanelOpen, togglePanel } = useShell();
  return { open: panelOpen, setOpen: setPanelOpen, toggle: togglePanel };
}

/**
 * Sets the background aura while the screen is mounted: mood in -1..1 and loudness 0..1
 * (splash 1, "Сегодня" .7, empty states .25, working lists 0). Leaving the screen restores the default.
 */
export function useAura(mood: number | null, intensity: number, extent: AuraExtent = 'hero'): void {
  const { setAura } = useShell();
  useEffect(() => {
    setAura({ mood, intensity, extent });
    return () => setAura(null);
  }, [mood, intensity, extent, setAura]);
}
