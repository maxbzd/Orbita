import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Behaviour shared by every modal layer (Sheet, Dialog, command palette):
 *   - Escape closes the topmost layer only;
 *   - Tab is trapped inside it, focus starts inside and returns to the opener on close;
 *   - the page behind is inert, does not scroll, and `<html data-overlay>` is set so ambient
 *     animations pause under the blur (effects.css).
 * Everything global is reference-counted, so stacked layers (a dialog over a sheet) nest correctly.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true' && !el.closest('[hidden], [inert]'),
  );
}

let locks = 0;
let previousOverflow = '';

function lockPage(): void {
  if (locks++ > 0) return;
  const root = document.documentElement;
  previousOverflow = root.style.overflow;
  root.style.overflow = 'hidden';
  root.dataset.overlay = '';
  document.getElementById('root')?.setAttribute('inert', '');
}

function unlockPage(): void {
  if (--locks > 0) return;
  const root = document.documentElement;
  root.style.overflow = previousOverflow;
  delete root.dataset.overlay;
  document.getElementById('root')?.removeAttribute('inert');
}

const stack: symbol[] = [];

export interface ModalBehaviorOptions {
  /** True while the layer is open (not while it is animating out). */
  active: boolean;
  containerRef: RefObject<HTMLElement | null>;
  onEscape?(): void;
  /** Element to focus first; defaults to the first focusable inside, then the container. */
  initialFocus?(container: HTMLElement): HTMLElement | null | undefined;
}

export function useModalBehavior({ active, containerRef, onEscape, initialFocus }: ModalBehaviorOptions): void {
  // Latest callbacks without re-running the effect (a new closure every render must not steal focus).
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  const focusRef = useRef(initialFocus);
  focusRef.current = initialFocus;

  useLayoutEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const id = Symbol('modal');
    stack.push(id);
    lockPage();

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
    const first = focusRef.current?.(container) ?? getFocusable(container)[0] ?? container;
    first.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (stack[stack.length - 1] !== id) return;
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        escapeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = getFocusable(container);
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const current = document.activeElement;
      if (event.shiftKey && (current === firstItem || !container.contains(current))) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && (current === lastItem || !container.contains(current))) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = stack.indexOf(id);
      if (index >= 0) stack.splice(index, 1);
      unlockPage();
      // Deferred: React restores the previously focused element at the end of the commit and would
      // undo a focus() made here, because the closing layer is still mounted while it animates out.
      queueMicrotask(() => {
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      });
    };
  }, [active, containerRef]);
}
