import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { Backdrop } from '../backdrop/Backdrop';
import styles from './FullscreenLayout.module.css';

/**
 * Layout of screens outside the shell (the recording screen): the sky behind, no navigation, the whole
 * viewport for the screen, safe-area insets applied. The screen decides its own aura.
 */
export function FullscreenLayout({ children }: { children?: ReactNode }) {
  return (
    <>
      <Backdrop auraIntensity={0} grain={false} twinkle={false} />
      <main className={styles.screen}>{children ?? <Outlet />}</main>
    </>
  );
}
