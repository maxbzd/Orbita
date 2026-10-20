import type { RefObject } from 'react';
import { useDocumentVisible, useOnScreen, useOverlayOpen } from '../../styles/media';

/**
 * True while the orb has a reason to animate: its tab is visible, it is on screen and (by default) no
 * real-blur layer is open above it (§4.1: blur over motion is the costliest combination on a phone).
 * Everything that loops (canvas frames, the level meter of the CSS orb) stops when this is false.
 */
export function useOrbActive(ref: RefObject<Element | null>, pauseUnderOverlay = true): boolean {
  const visible = useDocumentVisible();
  const onScreen = useOnScreen(ref);
  const overlay = useOverlayOpen();
  return visible && onScreen && !(pauseUnderOverlay && overlay);
}
