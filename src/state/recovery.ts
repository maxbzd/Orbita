import { create } from 'zustand';
import { discardRecording, findUnfinishedRecordings, recoverRecording } from '../audio';
import type { RecoverableRecording } from '../audio';
import type { ID } from '../domain/types';
import { processing } from './processing';
import { t, msg } from '../i18n';

/**
 * Recordings the browser lost (tab killed, battery dead): their chunks are in IndexedDB but were never glued
 * together. At app start the shell offers "Восстановить"; a restored recording is a normal saved capture and
 * goes to the background processing like any other.
 */

export interface RecoveryState {
  /** The check has run (once per page load). */
  checked: boolean;
  items: RecoverableRecording[];
  busy: boolean;
  error: string | null;
}

export interface RecoveryDeps {
  find(): Promise<RecoverableRecording[]>;
  recover(captureId: ID): Promise<{ captureId: ID } | undefined>;
  discard(captureId: ID): Promise<void>;
  process(captureId: ID): void;
}

export const browserRecoveryDeps: RecoveryDeps = {
  find: () => findUnfinishedRecordings(),
  recover: async (captureId) => {
    const recovered = await recoverRecording(captureId);
    return recovered ? { captureId: recovered.capture.id } : undefined;
  },
  discard: (captureId) => discardRecording(captureId),
  process: (captureId) => void processing.enqueue(captureId),
};

export interface RecoveryService {
  readonly store: ReturnType<typeof createStore>;
  /** Looks for lost recordings; later calls do nothing unless `force`. */
  check(options?: { force?: boolean }): Promise<RecoverableRecording[]>;
  /** Glues the recording back together and starts its processing. Resolves with the capture id. */
  restore(captureId: ID): Promise<ID | undefined>;
  discard(captureId: ID): Promise<void>;
  /** "Не сейчас": hides the offer until the next launch; the chunks stay. */
  postpone(): void;
}

const createStore = () => create<RecoveryState>(() => ({ checked: false, items: [], busy: false, error: null }));

const RESTORE_FAILED = msg('Could not restore the record. It stays on the device, try later.');

export function createRecoveryService(deps: RecoveryDeps = browserRecoveryDeps): RecoveryService {
  const store = createStore();
  let checking: Promise<RecoverableRecording[]> | undefined;

  const without = (captureId: ID): RecoverableRecording[] => store.getState().items.filter((item) => item.captureId !== captureId);

  return {
    store,
    check({ force = false } = {}) {
      if (store.getState().checked && !force) return Promise.resolve(store.getState().items);
      checking ??= deps
        .find()
        .catch(() => [] as RecoverableRecording[])
        .then((items) => {
          store.setState({ checked: true, items });
          return items;
        })
        .finally(() => {
          checking = undefined;
        });
      return checking;
    },
    async restore(captureId) {
      store.setState({ busy: true, error: null });
      try {
        const recovered = await deps.recover(captureId);
        store.setState({ items: without(captureId), busy: false });
        if (!recovered) return undefined;
        processing.markSaving(recovered.captureId);
        deps.process(recovered.captureId);
        return recovered.captureId;
      } catch {
        store.setState({ busy: false, error: t(RESTORE_FAILED) });
        return undefined;
      }
    },
    async discard(captureId) {
      store.setState({ busy: true, error: null });
      try {
        await deps.discard(captureId);
        store.setState({ items: without(captureId), busy: false });
      } catch {
        store.setState({ busy: false, error: t('Could not delete the record. Try later.') });
      }
    },
    postpone() {
      store.setState({ items: [] });
    },
  };
}

export const recoveryService: RecoveryService = createRecoveryService();

export function useRecovery(): RecoveryState {
  return recoveryService.store((state) => state);
}
