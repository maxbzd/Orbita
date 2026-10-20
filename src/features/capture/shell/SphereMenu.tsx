import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../../ui/icons';
import { ListRow, Sheet } from '../../../ui/primitives';
import type { SphereGesture } from '../../../ui/shell/NavPill';
import { ARC_ACTIONS, arcPositions, satelliteAt } from './arc';
import type { Point, SphereActionId } from './arc';
import { useQuickActions } from './quickActions';
import styles from './SphereMenu.module.css';
import { t } from '../../../i18n';

/** What each action of the arc does. */
export function useSphereActions(): { run(id: SphereActionId): void } {
  const navigate = useNavigate();
  const openSheet = useQuickActions((state) => state.open);
  const run = useCallback(
    (id: SphereActionId) => {
      switch (id) {
        case 'text':
          navigate('/capture?mode=text');
          break;
        case 'checkin':
          navigate('/checkin');
          break;
        case 'import':
          openSheet('import');
          break;
        case 'quick':
          openSheet('quick');
          break;
      }
    },
    [navigate, openSheet],
  );
  return { run };
}

interface ArcState {
  origin: Point;
  /** `hold`: the finger is still down. `tap`: it lifted over nothing and the arc waits for a tap. */
  mode: 'hold' | 'tap';
  hot: SphereActionId | null;
}

const haptic = (): void => {
  try {
    navigator.vibrate?.(8);
  } catch {
    // No vibration on this device.
  }
};

/**
 * The gesture of the sphere and what it opens: the arc (hold, then slide and lift; or lift and tap) and the same
 * four actions as a sheet for the keyboard and for anyone who cannot hold (§3.2).
 */
export function useSphereMenu(): { gesture: SphereGesture; element: JSX.Element } {
  const { run } = useSphereActions();
  const sheet = useQuickActions((state) => state.sheet);
  const openSheet = useQuickActions((state) => state.open);
  const closeSheet = useQuickActions((state) => state.close);
  const [arc, setArc] = useState<ArcState | null>(null);
  const satellitesRef = useRef<ReturnType<typeof arcPositions>>([]);

  const compute = useCallback((origin: Point) => {
    satellitesRef.current = arcPositions(origin, { width: window.innerWidth, height: window.innerHeight });
  }, []);

  const choose = useCallback(
    (id: SphereActionId) => {
      setArc(null);
      run(id);
    },
    [run],
  );

  const gesture = useMemo<SphereGesture>(
    () => ({
      onHoldStart: (_point, origin) => {
        compute(origin);
        haptic();
        setArc({ origin, mode: 'hold', hot: null });
      },
      onHoldMove: (point) => {
        const hot = satelliteAt(satellitesRef.current, point);
        setArc((current) => {
          if (!current || current.mode !== 'hold' || current.hot === hot) return current;
          if (hot) haptic();
          return { ...current, hot };
        });
      },
      onHoldEnd: (point) => {
        const hot = satelliteAt(satellitesRef.current, point);
        if (hot) {
          setArc(null);
          run(hot);
        } else {
          // Lifted over nothing: leave the arc open for a tap on one of the four.
          setArc((current) => (current ? { ...current, mode: 'tap', hot: null } : current));
        }
      },
      onHoldCancel: () => setArc(null),
      onMenuKey: () => openSheet('menu'),
    }),
    [compute, openSheet, run],
  );

  const element = (
    <>
      {arc ? <Arc state={arc} satellites={satellitesRef.current} onChoose={choose} onClose={() => setArc(null)} /> : null}
      <Sheet
        open={sheet === 'menu'}
        onClose={closeSheet}
        title={t('Quick actions')}
        placement="auto"
        snaps={[0.5]}
        defaultSnapIndex={0}
      >
        <ul role="menu" aria-label={t('Quick actions')} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--s-2)' }}>
          {ARC_ACTIONS.map((action) => (
            <ListRow
              key={action.id}
              as="li"
              role="none"
              leading={<Icon name={action.icon} size={24} />}
              title={action.label}
              subtitle={action.hint}
              onClick={() => {
                closeSheet();
                run(action.id);
              }}
            />
          ))}
        </ul>
      </Sheet>
    </>
  );
  return { gesture, element };
}

function Arc({
  state,
  satellites,
  onChoose,
  onClose,
}: {
  state: ArcState;
  satellites: ReturnType<typeof arcPositions>;
  onChoose(id: SphereActionId): void;
  onClose(): void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // After a lift the arc is a normal menu: focus goes to its first item.
  useEffect(() => {
    if (state.mode === 'tap') menuRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [state.mode]);

  const vars = { '--ox': `${state.origin.x}px`, '--oy': `${state.origin.y}px` } as CSSProperties;
  return createPortal(
    <div className={styles.layer} style={vars} data-mode={state.mode} data-testid="sphere-arc">
      <div className={styles.scrim} onPointerDown={state.mode === 'tap' ? onClose : undefined} aria-hidden="true" />
      <div ref={menuRef} className={styles.menu} role="menu" aria-label={t('Quick actions')}>
        {satellites.map(({ action, x, y }, index) => {
          const side = ['left', 'up-left', 'up-right', 'right'][index] ?? 'up-left';
          const cell = { '--x': x, '--y': y, '--i': index } as CSSProperties;
          return (
            <span key={action.id} style={cell}>
              <button
                type="button"
                role="menuitem"
                className={styles.satellite}
                style={cell}
                data-hot={state.hot === action.id ? '' : undefined}
                aria-label={action.label}
                onClick={() => onChoose(action.id)}
              >
                <Icon name={action.icon} size={26} />
              </button>
              <span className={styles.caption} style={cell} data-side={side} aria-hidden="true">
                {action.label}
              </span>
            </span>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
