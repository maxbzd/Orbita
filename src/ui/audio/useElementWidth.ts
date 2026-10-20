import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * The rendered width of an element in CSS px, kept up to date with a ResizeObserver. Until the element
 * has a size (first render, jsdom) it reports `fallback`, so a component can always lay itself out.
 */
export function useElementWidth(ref: RefObject<Element | null>, fallback = 320): number {
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = (): void => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth((previous) => (Math.abs(previous - w) < 0.5 ? previous : Math.round(w * 100) / 100));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
