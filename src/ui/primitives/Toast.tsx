import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../icons';
import { Portal } from './Portal';
import { cx } from './cx';
import styles from './Toast.module.css';
import { t } from '../../i18n';

export type ToastTone = 'default' | 'ok' | 'danger';
export type ToastCloseReason = 'timeout' | 'action' | 'dismiss' | 'replaced' | 'cleared';

export interface ToastOptions {
  message: ReactNode;
  /** Text of the action button; shown only together with `onAction`. Default "Вернуть". */
  actionLabel?: string;
  /** The action ("Вернуть"). Closes the toast. */
  onAction?(): void;
  /** Milliseconds on screen; `null` keeps it until dismissed. Default 5000. */
  duration?: number | null;
  tone?: ToastTone;
  /** Called once when the toast leaves, with the reason: commit a deferred delete on `timeout`. */
  onClose?(reason: ToastCloseReason): void;
  /** A toast with the same id replaces the one already in the queue. */
  id?: string;
}

interface ToastEntry extends ToastOptions {
  id: string;
}

export interface ToastApi {
  /** Queues a toast; returns its id. Toasts are shown one at a time, in order. */
  show(options: ToastOptions): string;
  /** Closes the toast with this id (or the visible one) as if dismissed. */
  dismiss(id?: string): void;
  /** Drops the visible toast and the whole queue. */
  clear(): void;
}

export const DEFAULT_TOAST_DURATION = 5000;

const ToastContext = createContext<ToastApi | null>(null);

const FALLBACK: ToastApi = { show: () => '', dismiss: () => undefined, clear: () => undefined };

/** The toast API. Outside a provider it does nothing, so a screen renders in isolation. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? FALLBACK;
}

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<ToastEntry[]>([]);
  // The ref is the source of truth, so several calls in one tick (show, show, dismiss) see each other.
  const queueRef = useRef<ToastEntry[]>([]);
  const commit = useCallback((next: ToastEntry[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  const show = useCallback(
    (options: ToastOptions): string => {
      const id = options.id ?? `toast-${++counter}`;
      const entry: ToastEntry = { ...options, id };
      const current = queueRef.current;
      const existing = current.find((t) => t.id === id);
      if (existing) {
        commit(current.map((t) => (t.id === id ? entry : t)));
        existing.onClose?.('replaced');
      } else {
        commit([...current, entry]);
      }
      return id;
    },
    [commit],
  );

  const remove = useCallback(
    (id: string | undefined, reason: ToastCloseReason) => {
      const target = id ? queueRef.current.find((t) => t.id === id) : queueRef.current[0];
      if (!target) return;
      commit(queueRef.current.filter((t) => t.id !== target.id));
      target.onClose?.(reason);
    },
    [commit],
  );

  const clear = useCallback(() => {
    const all = queueRef.current;
    commit([]);
    for (const t of all) t.onClose?.('cleared');
  }, [commit]);

  const api = useMemo<ToastApi>(() => ({ show, dismiss: (id) => remove(id, 'dismiss'), clear }), [show, remove, clear]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Portal>
        <ToastViewport current={queue[0]} remaining={queue.length - 1} onRemove={remove} />
      </Portal>
    </ToastContext.Provider>
  );
}

function ToastViewport({
  current,
  remaining,
  onRemove,
}: {
  current: ToastEntry | undefined;
  remaining: number;
  onRemove(id: string, reason: ToastCloseReason): void;
}) {
  const [paused, setPaused] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const left = useRef(0);
  const startedAt = useRef(0);
  const id = current?.id;
  const duration = current ? (current.duration === undefined ? DEFAULT_TOAST_DURATION : current.duration) : null;

  // A new toast gets its full time.
  useEffect(() => {
    left.current = duration ?? 0;
    setPaused(false);
  }, [id, duration]);

  // The timer runs while the pointer or focus is away (WCAG 2.2.1: time to read and to react).
  useEffect(() => {
    if (!id || duration === null || paused) return;
    startedAt.current = Date.now();
    timer.current = window.setTimeout(() => onRemove(id, 'timeout'), left.current);
    return () => {
      window.clearTimeout(timer.current);
      left.current = Math.max(0, left.current - (Date.now() - startedAt.current));
    };
  }, [id, duration, paused, onRemove]);

  const tone = current?.tone ?? 'default';
  const showAction = Boolean(current?.onAction);

  return (
    <div className={styles.viewport} role="region" aria-label={t('Notifications')}>
      <div role={tone === 'danger' ? 'alert' : 'status'} aria-live={tone === 'danger' ? 'assertive' : 'polite'} aria-atomic="true" className={styles.live}>
        {current ? (
          <div
            key={current.id}
            className={cx(styles.toast, styles[tone])}
            data-tone={tone}
            onPointerEnter={() => setPaused(true)}
            onPointerLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
          >
            <span className={styles.message}>{current.message}</span>
            {showAction ? (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  current.onAction?.();
                  onRemove(current.id, 'action');
                }}
              >
                {current.actionLabel ?? t('Restore')}
              </button>
            ) : null}
            {remaining > 0 ? <span className={styles.more} aria-label={t('{remaining} more notifications', { remaining })}>+{remaining}</span> : null}
            <button type="button" className={styles.close} aria-label={t('Dismiss the notification')} onClick={() => onRemove(current.id, 'dismiss')}>
              <Icon name="close" size={18} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
