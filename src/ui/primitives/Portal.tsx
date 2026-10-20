import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/** Renders into <body>, outside the app root (which is made inert while a modal layer is open). */
export function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
