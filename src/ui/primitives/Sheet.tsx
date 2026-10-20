import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useBreakpoint } from '../../styles/media';
import { useReducedMotion } from '../../styles/theme';
import { Icon } from '../icons';
import { Portal } from './Portal';
import { Scrim } from './Scrim';
import { useModalBehavior } from './overlay';
import { usePresence } from './usePresence';
import { cx } from './cx';
import { DEFAULT_SNAPS, clampDrag, clampIndex, resolveRelease, snapShift, stepSnap } from './sheetGeometry';
import styles from './Sheet.module.css';
import { t } from '../../i18n';

export type SheetPlacement = 'auto' | 'panel' | 'sheet';

export interface SheetProps {
  open: boolean;
  onClose(): void;
  /** Accessible name and visible heading. */
  title: string;
  /** Keeps the title for screen readers only (the content draws its own heading). */
  hideTitle?: boolean;
  description?: ReactNode;
  /** Stops as fractions of the viewport height, ascending. Default 0.4 / 0.7 / 0.92. */
  snaps?: readonly number[];
  /** Controlled stop (index into `snaps`). */
  snapIndex?: number;
  /** Stop the sheet opens at. Default: the middle one. */
  defaultSnapIndex?: number;
  onSnapChange?(index: number): void;
  /**
   * `auto`  bottom sheet on a phone, centred window on tablet/desktop;
   * `panel` bottom sheet on a phone, right-hand panel (340) on tablet/desktop;
   * `sheet` always a bottom sheet.
   */
  placement?: SheetPlacement;
  /** Esc, the scrim, the close button and a swipe down close the sheet. Default true. */
  dismissible?: boolean;
  /** Sticks to the bottom of the sheet (the main action). */
  footer?: ReactNode;
  closeLabel?: string;
  className?: string;
  children?: ReactNode;
}

interface DragState {
  pointerId: number;
  startY: number;
  lastY: number;
  lastT: number;
  velocity: number;
  moved: boolean;
}

const EXIT_MS = 420;
const EXIT_MS_REDUCED = 120;
const DRAG_THRESHOLD = 4;

/**
 * Bottom sheet with three stops, drag, focus trap, Esc and a scrim. Real glass (one of the 2-3 allowed
 * per screen); on tablet/desktop it becomes a window or a right panel, where the stops do not apply.
 */
export function Sheet({
  open,
  onClose,
  title,
  hideTitle,
  description,
  snaps = DEFAULT_SNAPS,
  snapIndex,
  defaultSnapIndex = 1,
  onSnapChange,
  placement = 'auto',
  dismissible = true,
  footer,
  closeLabel = t('Close'),
  className,
  children,
}: SheetProps) {
  const breakpoint = useBreakpoint();
  const reduced = useReducedMotion();
  const { mounted, shown } = usePresence(open, reduced ? EXIT_MS_REDUCED : EXIT_MS);
  const titleId = useId();
  const descriptionId = useId();

  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [innerIndex, setInnerIndex] = useState(() => clampIndex(defaultSnapIndex, snaps));
  const index = clampIndex(snapIndex ?? innerIndex, snaps);

  const mode: 'sheet' | 'modal' | 'panel' =
    placement === 'sheet' || breakpoint === 'phone' ? 'sheet' : placement === 'panel' ? 'panel' : 'modal';

  const setIndex = useCallback(
    (next: number) => {
      const clamped = clampIndex(next, snaps);
      setInnerIndex(clamped);
      if (clamped !== index) onSnapChange?.(clamped);
    },
    [index, onSnapChange, snaps],
  );

  // A reopened sheet starts from its default stop again.
  useEffect(() => {
    if (open) setInnerIndex(clampIndex(defaultSnapIndex, snaps));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a (re)opening resets the stop
  }, [open]);

  const requestClose = useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);

  useModalBehavior({
    active: open,
    containerRef: panelRef,
    onEscape: requestClose,
    initialFocus: (container) => container.querySelector<HTMLElement>('[data-autofocus]') ?? container,
  });

  const setDrag = (px: number): void => panelRef.current?.style.setProperty('--sheet-drag', `${px}px`);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (mode !== 'sheet' || event.button > 0) return;
    const target = event.target as HTMLElement;
    // Buttons in the header (close) stay clickable; the grabber itself is a button that also drags.
    if (target.closest('button:not([data-grabber]), a, input, textarea, select')) return;
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, lastY: event.clientY, lastT: event.timeStamp, velocity: 0, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const offset = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(offset) < DRAG_THRESHOLD) return;
    drag.moved = true;
    const dt = event.timeStamp - drag.lastT;
    if (dt > 0) {
      // Smoothed velocity over the last few events, so one jittery sample does not flip the result.
      drag.velocity = 0.6 * ((event.clientY - drag.lastY) / dt) + 0.4 * drag.velocity;
      drag.lastY = event.clientY;
      drag.lastT = event.timeStamp;
    }
    setDrag(clampDrag(offset, snaps, index, window.innerHeight));
  };

  const finishDrag = (event: ReactPointerEvent<HTMLElement>, cancelled: boolean): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDrag(0);
    if (!drag.moved || cancelled) return;
    const result = resolveRelease({
      snaps,
      index,
      offset: event.clientY - drag.startY,
      velocity: drag.velocity,
      viewport: window.innerHeight,
      dismissible,
    });
    if (result.kind === 'close') onClose();
    else setIndex(result.index);
  };

  const onGrabberKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex(stepSnap(index, 1, snaps));
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex(stepSnap(index, -1, snaps));
    }
  };

  // A tap on the grabber (not a drag) steps up, and from the top stop back down.
  const onGrabberClick = (): void => {
    if (index >= snaps.length - 1) setIndex(0);
    else setIndex(index + 1);
  };

  if (!mounted) return null;

  const style = {
    '--sheet-max': snaps[snaps.length - 1] ?? 1,
    '--sheet-shift': snapShift(snaps, index),
  } as CSSProperties;

  return (
    <Portal>
      <Scrim shown={shown} onClick={requestClose} />
      <div
        ref={panelRef}
        className={cx(styles.sheet, shown && styles.shown, dragging && styles.dragging, className)}
        data-mode={mode}
        data-snap={index}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header className={styles.head} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(e) => finishDrag(e, false)} onPointerCancel={(e) => finishDrag(e, true)}>
          {mode === 'sheet' && snaps.length > 1 ? (
            <button
              type="button"
              data-grabber=""
              className={styles.grabber}
              aria-label={t('Sheet height: {round} %. Up and down arrows change the height', { round: Math.round((snaps[index] ?? 1) * 100) })}
              onKeyDown={onGrabberKeyDown}
              onClick={onGrabberClick}
            >
              <span className={styles.handle} aria-hidden="true" />
            </button>
          ) : null}
          <div className={styles.titleRow}>
            <h2 id={titleId} className={cx(styles.title, hideTitle && 'sr-only')}>
              {title}
            </h2>
            {dismissible ? (
              <button type="button" className={styles.close} aria-label={closeLabel} onClick={onClose}>
                <Icon name="close" size={22} />
              </button>
            ) : null}
          </div>
          {description ? (
            <p id={descriptionId} className={styles.description}>
              {description}
            </p>
          ) : null}
        </header>
        <div className={styles.body}>{children}</div>
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </div>
    </Portal>
  );
}
