import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefCallback, RefObject } from 'react';

export interface VirtualWindow {
  /** First rendered index. */
  start: number;
  /** One past the last rendered index. */
  end: number;
  /** Height of the rows above `start`, px. */
  before: number;
  /** Height of the rows from `end` on, px. */
  after: number;
  total: number;
}

/**
 * Which rows to render for a viewport: those whose box intersects `[scrollTop - overscan, scrollTop + viewport + overscan]`.
 * `heights` are the (measured or estimated) row heights in order; `scrollTop` is relative to the top of the list.
 */
export function computeWindow(heights: readonly number[], scrollTop: number, viewport: number, overscan = 600): VirtualWindow {
  const count = heights.length;
  let total = 0;
  const tops = new Array<number>(count);
  for (let i = 0; i < count; i += 1) {
    tops[i] = total;
    total += heights[i] ?? 0;
  }
  if (count === 0) return { start: 0, end: 0, before: 0, after: 0, total: 0 };

  const from = scrollTop - overscan;
  const to = scrollTop + viewport + overscan;

  // First row whose bottom edge is below `from`.
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((tops[mid] ?? 0) + (heights[mid] ?? 0) <= from) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;

  let end = start;
  while (end < count && (tops[end] ?? 0) < to) end += 1;
  if (end === start) end = Math.min(count, start + 1);

  const before = tops[start] ?? 0;
  const endTop = end < count ? (tops[end] ?? total) : total;
  return { start, end, before, after: total - endTop, total };
}

export interface WindowVirtualizer {
  window: VirtualWindow;
  /** Put on the element that wraps the rows. */
  containerRef: RefObject<HTMLDivElement>;
  /** Ref callback for a rendered row; its measured height replaces the estimate. */
  measure(key: string): RefCallback<HTMLElement>;
}

/**
 * Virtual list for a page that scrolls the window (the shell has no inner scroller). Rows have variable
 * height: it starts from `estimate` and settles on the measured size. Disabled, every row is rendered.
 */
export function useWindowVirtualizer(keys: readonly string[], estimate: (index: number) => number, enabled: boolean, overscan = 600): WindowVirtualizer {
  const containerRef = useRef<HTMLDivElement>(null);
  const sizes = useRef(new Map<string, number>());
  const elements = useRef(new Map<string, HTMLElement>());
  const refs = useRef(new Map<string, RefCallback<HTMLElement>>());
  const observer = useRef<ResizeObserver | null>(null);
  const [version, bump] = useState(0);
  const [view, setView] = useState({ scrollTop: 0, viewport: typeof window === 'undefined' ? 800 : window.innerHeight });
  const frame = useRef<number | null>(null);

  const scheduleBump = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      bump((n) => n + 1);
    });
  }, []);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      observer.current?.disconnect();
    },
    [],
  );

  const getObserver = useCallback((): ResizeObserver | null => {
    if (observer.current) return observer.current;
    if (typeof ResizeObserver === 'undefined') return null;
    observer.current = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.vkey;
        if (!key) continue;
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        if (Math.abs((sizes.current.get(key) ?? -1) - height) > 0.5) {
          sizes.current.set(key, height);
          changed = true;
        }
      }
      if (changed) scheduleBump();
    });
    return observer.current;
  }, [scheduleBump]);

  const measure = useCallback(
    (key: string): RefCallback<HTMLElement> => {
      const cached = refs.current.get(key);
      if (cached) return cached;
      const callback: RefCallback<HTMLElement> = (element) => {
        const previous = elements.current.get(key);
        if (previous && previous !== element) getObserver()?.unobserve(previous);
        if (!element) {
          elements.current.delete(key);
          return;
        }
        elements.current.set(key, element);
        element.dataset.vkey = key;
        getObserver()?.observe(element);
        const height = element.getBoundingClientRect().height;
        if (height > 0 && Math.abs((sizes.current.get(key) ?? -1) - height) > 0.5) {
          sizes.current.set(key, height);
          scheduleBump();
        }
      };
      refs.current.set(key, callback);
      return callback;
    },
    [getObserver, scheduleBump],
  );

  // Follow the window scroll.
  useEffect(() => {
    if (!enabled) return undefined;
    let pending = false;
    const update = (): void => {
      pending = false;
      const container = containerRef.current;
      if (!container) return;
      const top = container.getBoundingClientRect().top + window.scrollY;
      setView((current) => {
        const next = { scrollTop: window.scrollY - top, viewport: window.innerHeight };
        return Math.abs(current.scrollTop - next.scrollTop) < 8 && current.viewport === next.viewport ? current : next;
      });
    };
    const request = (): void => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request);
    return () => {
      window.removeEventListener('scroll', request);
      window.removeEventListener('resize', request);
    };
  }, [enabled]);

  // Keys can change under the same scroll position (a filter): forget sizes of rows that are gone.
  useLayoutEffect(() => {
    if (sizes.current.size < 2000) return;
    const live = new Set(keys);
    for (const key of sizes.current.keys()) if (!live.has(key)) sizes.current.delete(key);
  }, [keys]);

  const heights = useMemo(
    () => keys.map((key, index) => sizes.current.get(key) ?? estimate(index)),
    // `sizes` is a ref: `version` says it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keys, estimate, version],
  );

  const virtualWindow = useMemo<VirtualWindow>(() => {
    if (!enabled) return { start: 0, end: keys.length, before: 0, after: 0, total: 0 };
    return computeWindow(heights, view.scrollTop, view.viewport, overscan);
  }, [enabled, heights, keys.length, overscan, view]);

  return { window: virtualWindow, containerRef, measure };
}
