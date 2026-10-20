import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BREAKPOINTS, breakpointFor, useBreakpoint, useDocumentVisible, useMediaQuery, useOverlayOpen } from './media';
import { installMatchMedia } from './mockMatchMedia';
import type { MatchMediaControl } from './mockMatchMedia';

describe('breakpointFor', () => {
  it.each([
    [320, 'phone'],
    [767, 'phone'],
    [768, 'tablet'],
    [1279, 'tablet'],
    [1280, 'desktop'],
    [1920, 'desktop'],
  ] as const)('%i px is %s', (width, expected) => {
    expect(breakpointFor(width)).toBe(expected);
  });

  it('uses the documented boundaries', () => {
    expect(BREAKPOINTS).toEqual({ tablet: 768, desktop: 1280 });
  });
});

describe('useBreakpoint', () => {
  let media: MatchMediaControl;
  beforeEach(() => {
    media = installMatchMedia({ width: 390 });
  });
  afterEach(() => media.restore());

  it('follows the viewport width live', () => {
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('phone');
    act(() => media.setWidth(800));
    expect(result.current).toBe('tablet');
    act(() => media.setWidth(1440));
    expect(result.current).toBe('desktop');
    act(() => media.setWidth(360));
    expect(result.current).toBe('phone');
  });

  it('starts right at the boundary values', () => {
    media.setWidth(768);
    expect(renderHook(() => useBreakpoint()).result.current).toBe('tablet');
    media.setWidth(1280);
    expect(renderHook(() => useBreakpoint()).result.current).toBe('desktop');
  });
});

describe('without matchMedia (jsdom default)', () => {
  it('falls back to window.innerWidth and reacts to resize', () => {
    const before = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 500 });
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('phone');
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1300 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe('desktop');
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: before });
  });

  it('useMediaQuery returns the fallback', () => {
    expect(renderHook(() => useMediaQuery('(prefers-reduced-motion: reduce)', true)).result.current).toBe(true);
    expect(renderHook(() => useMediaQuery('(prefers-reduced-motion: reduce)')).result.current).toBe(false);
  });
});

describe('useMediaQuery', () => {
  it('tracks a feature query', () => {
    const media = installMatchMedia({ features: { 'prefers-reduced-motion': 'no-preference' } });
    const { result } = renderHook(() => useMediaQuery('(prefers-reduced-motion: reduce)'));
    expect(result.current).toBe(false);
    act(() => media.setFeature('prefers-reduced-motion', 'reduce'));
    expect(result.current).toBe(true);
    media.restore();
  });
});

describe('useDocumentVisible', () => {
  it('turns false when the tab is hidden', () => {
    function Probe() {
      return <p>{useDocumentVisible() ? 'visible' : 'hidden'}</p>;
    }
    render(<Probe />);
    expect(screen.getByText('visible')).toBeInTheDocument();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getByText('hidden')).toBeInTheDocument();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });
});

describe('useOverlayOpen', () => {
  afterEach(() => document.documentElement.removeAttribute('data-overlay'));

  it('follows the data-overlay attribute that modal layers set on <html>', async () => {
    const { result } = renderHook(() => useOverlayOpen());
    expect(result.current).toBe(false);
    await act(async () => {
      document.documentElement.setAttribute('data-overlay', '');
      await Promise.resolve();
    });
    expect(result.current).toBe(true);
    await act(async () => {
      document.documentElement.removeAttribute('data-overlay');
      await Promise.resolve();
    });
    expect(result.current).toBe(false);
  });
});
