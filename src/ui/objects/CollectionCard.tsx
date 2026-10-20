import { useCallback, useEffect, useRef } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { recordsCount } from '../../domain/counts';
import { Icon } from '../icons';
import { cx } from '../primitives/cx';
import { TYPE_LABELS_PLURAL, typeColor } from '../primitives/kinds';
import type { TypeKind } from '../primitives/kinds';
import { TypeMedallion } from '../primitives/TypeMark';
import styles from './CollectionCard.module.css';
import { t } from '../../i18n';

export interface CollectionCardProps {
  kind: TypeKind;
  /** Number of records of this type. */
  count: number;
  /** Title in `display-l`. Default: the type's plural name ("Решения"). */
  title?: string;
  /** Up to three short titles of the latest records: the mini preview. */
  previews?: readonly string[];
  /** Shows the lock and "Только ты". Default true: everything is private unless shared. */
  private?: boolean;
  /** Tap / Enter. */
  onOpen?: () => void;
  /** Long press, right click or the context-menu key: the card menu. Receives the card element to anchor to. */
  onMenu?: (anchor: HTMLElement) => void;
  className?: string;
}

/** Long-press time in ms. */
export const LONG_PRESS_MS = 500;

const MOVE_TOLERANCE = 10;

/**
 * Type collection (docs §2.9, Hypelist): 2:1, radius 28, a gradient of the type's colour into the surface, a counter
 * ("9 записей"), the title in display-l, a lock, a mini preview. One button; the menu opens on long press.
 */
export function CollectionCard({
  kind,
  count,
  title,
  previews = [],
  private: isPrivate = true,
  onOpen,
  onMenu,
  className,
}: CollectionCardProps) {
  const name = title ?? TYPE_LABELS_PLURAL[kind];
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!onMenu || (event.pointerType === 'mouse' && event.button !== 0)) return;
    longPressed.current = false;
    origin.current = { x: event.clientX, y: event.clientY };
    const anchor = event.currentTarget;
    timer.current = setTimeout(() => {
      longPressed.current = true;
      timer.current = null;
      onMenu(anchor);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!origin.current) return;
    if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > MOVE_TOLERANCE) clear();
  };
  const onClick = (): void => {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    onOpen?.();
  };
  const onContextMenu = (event: MouseEvent<HTMLButtonElement>): void => {
    if (!onMenu) return;
    event.preventDefault();
    clear();
    longPressed.current = false;
    onMenu(event.currentTarget);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (onMenu && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
      event.preventDefault();
      onMenu(event.currentTarget);
    }
  };

  const countText = recordsCount(count);
  const lines = previews.slice(0, 3);
  return (
    <div className={cx(styles.root, className)}>
      <button
        type="button"
        className={styles.card}
        style={{ '--c': typeColor(kind) } as CSSProperties}
        data-kind={kind}
        aria-label={`${name}, ${countText}${isPrivate ? t(', only you') : ''}`}
        aria-haspopup={onMenu ? 'menu' : undefined}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={clear}
        onPointerCancel={clear}
        onPointerLeave={clear}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
      >
        <span className={styles.top} aria-hidden="true">
          <TypeMedallion kind={kind} size={36} />
          <span className={styles.count}>{countText}</span>
        </span>
        <span className={styles.title} aria-hidden="true">
          {name}
        </span>
        {lines.length ? (
          <span className={styles.preview} aria-hidden="true">
            {lines.map((line, i) => (
              <span key={`${i}-${line}`} className={styles.previewLine}>
                {line}
              </span>
            ))}
          </span>
        ) : null}
        {isPrivate ? (
          <span className={styles.lock} aria-hidden="true">
            <Icon name="lock" size={14} />
            {t('Only you')}
          </span>
        ) : null}
      </button>
    </div>
  );
}
