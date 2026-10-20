import { useEffect, useRef } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { Icon } from '../icons';
import { Glass } from '../primitives/Glass';
import { cx } from '../primitives/cx';
import type { NavLinkItem } from './destinations';
import { NavLink } from './NavLink';
import { OrbSphere } from './OrbSphere';
import styles from './NavPill.module.css';
import { t } from '../../i18n';

export interface HoldPoint {
  x: number;
  y: number;
}

/**
 * Press-and-hold on the sphere: after `HOLD_MS` the arc of four actions
 * opens over the finger; the finger slides to an action and lifts. A plain tap still records.
 */
export interface SphereGesture {
  /** The hold was recognised. `origin` is the centre of the sphere, `point` the finger. */
  onHoldStart(point: HoldPoint, origin: HoldPoint): void;
  /** The finger moves while held. */
  onHoldMove(point: HoldPoint): void;
  /** The finger lifted. The tap that would follow is swallowed. */
  onHoldEnd(point: HoldPoint): void;
  /** The pointer was cancelled by the system (a call, a scroll takeover). */
  onHoldCancel?(): void;
  /** Keyboard and assistive tech: ArrowUp, the context-menu key or Shift+F10 on the sphere. */
  onMenuKey?(): void;
}

/** How long a finger must rest on the sphere before the arc opens. */
export const HOLD_MS = 380;
/** Moving further than this before the hold fires means a scroll or a stray touch, not a hold. */
const HOLD_SLOP_PX = 12;

export interface NavPillProps {
  /** Four destinations: the first half sits left of the sphere, the rest right of it. */
  items: readonly NavLinkItem[];
  activeId: string | null;
  onNavigate?(item: Pick<NavLinkItem, 'id' | 'href'>): void;
  /** The orb slot (Canvas orb). Defaults to the 68 px CSS sphere. */
  sphere?: ReactNode;
  /** Accessible name of the sphere button. */
  sphereLabel?: string;
  /** Tap on the sphere: start recording at once (no choice first). */
  onSphereClick?(): void;
  /** Press-and-hold on the sphere: the arc of four actions. */
  sphereGesture?: SphereGesture;
  /** Slides away and leaves the tab order (the recording screen hides the pill). */
  hidden?: boolean;
  className?: string;
}

/**
 * The phone navigation: a glass pill of 64 px, radius 32, four labelled destinations and the recording
 * sphere in the middle, 68 px, rising 18 px above the pill. Labels are 11 px; the active item sits in a
 * tablet. Real glass: it is one of the 2-3 blurred surfaces a screen may have.
 */
export function NavPill({ items, activeId, onNavigate, sphere, sphereLabel = t('Record', undefined, 'nav-pill'), onSphereClick, sphereGesture, hidden, className }: NavPillProps) {
  const split = Math.ceil(items.length / 2);
  const left = items.slice(0, split);
  const right = items.slice(split);
  // `inert` is not in React 18's types; the attribute still reaches the DOM.
  const inert = hidden ? ({ inert: '' } as Record<string, string>) : undefined;

  const hold = useRef<{ pointerId: number; startX: number; startY: number; timer: number | undefined; held: boolean } | null>(null);
  const swallowClick = useRef(false);
  const gesture = useRef(sphereGesture);
  useEffect(() => {
    gesture.current = sphereGesture;
  });
  useEffect(
    () => () => {
      if (hold.current?.timer !== undefined) window.clearTimeout(hold.current.timer);
    },
    [],
  );

  const onSpherePointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!gesture.current || event.button > 0) return;
    const button = event.currentTarget;
    const state = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, timer: undefined as number | undefined, held: false };
    state.timer = window.setTimeout(() => {
      state.timer = undefined;
      state.held = true;
      const rect = button.getBoundingClientRect();
      try {
        button.setPointerCapture(state.pointerId);
      } catch {
        // The pointer is already gone; the hold still opens the arc.
      }
      gesture.current?.onHoldStart({ x: state.startX, y: state.startY }, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }, HOLD_MS);
    hold.current = state;
  };

  const onSpherePointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    const state = hold.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (state.held) {
      gesture.current?.onHoldMove({ x: event.clientX, y: event.clientY });
    } else if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > HOLD_SLOP_PX && state.timer !== undefined) {
      window.clearTimeout(state.timer);
      state.timer = undefined;
    }
  };

  const endHold = (event: PointerEvent<HTMLButtonElement>, cancelled: boolean): void => {
    const state = hold.current;
    if (!state || state.pointerId !== event.pointerId) return;
    hold.current = null;
    if (state.timer !== undefined) window.clearTimeout(state.timer);
    if (!state.held) return;
    // The click that follows the lift would start a recording: swallow it.
    swallowClick.current = true;
    window.setTimeout(() => {
      swallowClick.current = false;
    }, 0);
    if (cancelled) gesture.current?.onHoldCancel?.();
    else gesture.current?.onHoldEnd({ x: event.clientX, y: event.clientY });
  };

  const onSphereKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const menu = gesture.current?.onMenuKey;
    if (!menu) return;
    if (event.key === 'ArrowUp' || event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      menu();
    }
  };

  const renderItem = (item: NavLinkItem): ReactNode => {
    const active = item.id === activeId;
    return (
      <li key={item.id} className={styles.cell}>
        <NavLink item={item} active={active} onNavigate={onNavigate} className={cx(styles.link, active && styles.active)}>
          <Icon name={item.icon} size={24} />
          <span className={styles.label}>{item.label}</span>
        </NavLink>
      </li>
    );
  };

  return (
    <nav aria-label={t('Main navigation')} aria-hidden={hidden || undefined} className={cx(styles.nav, hidden && styles.hidden, className)} data-hidden={hidden ? '' : undefined} {...inert}>
      <Glass variant="real" size="bar" radius="bar" className={styles.bar}>
        <ul className={styles.list}>
          {left.map(renderItem)}
          <li className={styles.gap} aria-hidden="true" />
          {right.map(renderItem)}
        </ul>
        <button
          type="button"
          className={styles.sphere}
          aria-label={sphereLabel}
          onClick={() => {
            if (!swallowClick.current) onSphereClick?.();
          }}
          onPointerDown={onSpherePointerDown}
          onPointerMove={onSpherePointerMove}
          onPointerUp={(event) => endHold(event, false)}
          onPointerCancel={(event) => endHold(event, true)}
          onContextMenu={sphereGesture ? (event) => event.preventDefault() : undefined}
          onKeyDown={onSphereKeyDown}
        >
          {sphere ?? <OrbSphere size={68} />}
        </button>
      </Glass>
    </nav>
  );
}
