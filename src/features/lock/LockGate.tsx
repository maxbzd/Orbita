import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useSettings } from '../../db/hooks';
import { Backdrop } from '../../ui';
import { LockScreen } from './LockScreen';
import { initLock, useLockStore } from './lockService';
import { useAutoLock } from './useAutoLock';
import styles from './Lock.module.css';

/** Minutes of inactivity before the lock: live, so a change in the settings applies at once. */
function useAutoLockMinutes(status: string): number {
  const settings = useSettings();
  return status === 'unlocked' ? (settings?.lock.autoLockMinutes ?? 0) : 0;
}

/**
 * Wraps the app: shows the lock screen at launch and after inactivity while the lock is on, and renders the
 * children only when the app is open. Without a lock it renders them at once (after the one read of the settings).
 */
export function LockGate({ children }: { children: ReactNode }) {
  const status = useLockStore((state) => state.status);
  const minutes = useAutoLockMinutes(status);

  useEffect(() => {
    if (useLockStore.getState().status === 'checking') void initLock();
  }, []);
  useAutoLock(minutes, status === 'unlocked');

  if (status === 'checking') {
    return (
      <>
        <Backdrop auraIntensity={0} grain={false} twinkle={false} />
        <div className={styles.checking} aria-busy="true" />
      </>
    );
  }
  if (status === 'locked') return <LockScreen />;
  return <>{children}</>;
}
