import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

/** A DOM-safe id (no colons, so `url(#id)` and selectors behave) that is stable across renders. */
export function useSvgId(prefix = 'viz'): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/**
 * Follows `target` smoothly: each change glides from the current value to the new one in
 * `duration` ms (300–450 for the mood flower, docs §2.7). With `disabled` (reduced motion) it jumps.
 * The first render never animates.
 */
export function useTweenedValue(target: number, { duration = 360, disabled = false }: { duration?: number; disabled?: boolean } = {}): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (frame.current !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current);
    frame.current = null;
    if (disabled || duration <= 0 || typeof requestAnimationFrame !== 'function' || current.current === target) {
      current.current = target;
      setValue(target);
      return;
    }
    const from = current.current;
    let start: number | null = null;
    const step = (now: number): void => {
      start ??= now;
      const t = Math.min(1, (now - start) / duration);
      const next = from + (target - from) * easeOutCubic(t);
      current.current = next;
      setValue(next);
      frame.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [target, duration, disabled]);

  return value;
}

export interface RovingOptions {
  count: number;
  /** The item that holds the tab stop while focus is outside the group (usually the selected one). */
  tabStop?: number;
  /** Wrap around at the ends. Default true. */
  wrap?: boolean;
  /**
   * Custom movement. Return the target index, `null` to ignore the key, or `undefined` to fall back
   * to the default (arrows ±1, Home/End).
   */
  navigate?: (index: number, key: string) => number | null | undefined;
  /** Called after focus moved by keyboard. */
  onMove?: (index: number) => void;
}

/**
 * Roving tab stop for a group of focusable SVG/HTML items: one Tab stop for the whole group,
 * arrow keys move between items. Spread `itemProps(i)` on each item.
 */
export function useRoving<T extends Element = SVGGElement>({ count, tabStop = 0, wrap = true, navigate, onMove }: RovingOptions) {
  const refs = useRef<Array<T | null>>([]);
  const [focused, setFocused] = useState<number | null>(null);
  const stop = Math.min(Math.max(0, focused ?? tabStop), Math.max(0, count - 1));

  const move = useCallback(
    (index: number, key: string): boolean => {
      let next: number | null | undefined = navigate?.(index, key);
      if (next === undefined) {
        // Default movement skips slots that hold no focusable item (a decoration among buttons).
        const direction = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : key === 'Home' ? 1 : key === 'End' ? -1 : 0;
        if (direction === 0) return false;
        let candidate = key === 'Home' ? 0 : key === 'End' ? count - 1 : index + direction;
        for (let guard = 0; guard < count; guard++) {
          if (wrap) candidate = (candidate + count) % count;
          if (candidate < 0 || candidate >= count) return false;
          if (refs.current[candidate]) break;
          candidate += direction;
        }
        next = candidate;
      }
      if (next === null) return false;
      const target = Math.min(count - 1, Math.max(0, next));
      const el = refs.current[target];
      if (!el || target === index) return false;
      (el as unknown as HTMLElement).focus();
      onMove?.(target);
      return true;
    },
    [count, navigate, onMove, wrap],
  );

  const itemProps = (index: number) => ({
    ref: (el: T | null) => {
      refs.current[index] = el;
    },
    tabIndex: index === stop ? 0 : -1,
    onFocus: () => setFocused(index),
    onBlur: () => setFocused((f) => (f === index ? null : f)),
    onKeyDown: (event: KeyboardEvent<Element>) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (move(index, event.key)) event.preventDefault();
    },
  });

  return { itemProps, focusItem: (index: number) => (refs.current[index] as unknown as HTMLElement | null)?.focus() };
}
