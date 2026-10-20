import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMatchMedia } from '../../styles/mockMatchMedia';
import type { MatchMediaControl } from '../../styles/mockMatchMedia';
import { ThemeProvider } from '../../styles/theme';
import { stubCanvas } from '../testUtils';
import { CssOrb } from './CssOrb';
import { Orb } from './Orb';
import { OrbButton } from './OrbButton';
import { resetSpriteCache } from './sprites';
import { useOrbLevel } from './useOrbLevel';
import type { LevelListener } from './useOrbLevel';

/** A 2D context that only counts. */
function fakeContext() {
  const calls = { drawImage: 0, clearRect: 0, setTransform: [] as number[][] };
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    clearRect: () => {
      calls.clearRect += 1;
    },
    drawImage: () => {
      calls.drawImage += 1;
    },
    fillRect: () => undefined,
    setTransform: (...args: number[]) => {
      calls.setTransform.push(args);
    },
    createRadialGradient: () => ({ addColorStop: () => undefined }),
  };
  return { ctx, calls };
}

let media: MatchMediaControl | undefined;

function withTier(effects: 'max' | 'reduced' | 'min', theme: 'night' | 'dawn' = 'night') {
  localStorage.setItem('orbit:ui:theme', theme);
  localStorage.setItem('orbit:ui:effects', effects);
}

const mount = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

beforeEach(() => {
  localStorage.clear();
  resetSpriteCache();
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  media?.restore();
  media = undefined;
  localStorage.clear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('Orb on the high tier', () => {
  it('paints at once, keeps the backing store at 2x the CSS size at most, and keeps painting', () => {
    const { ctx, calls } = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(3);
    withTier('max');
    const { container } = mount(<Orb size={220} state="idle" />);

    const orb = container.querySelector('[data-engine="canvas"]');
    expect(orb).not.toBeNull();
    const canvas = container.querySelector('canvas');
    expect(canvas?.width).toBe(440);
    expect(canvas?.height).toBe(440);
    expect(calls.setTransform.at(-1)).toEqual([2, 0, 0, 2, 0, 0]);
    expect(calls.drawImage).toBeGreaterThan(300); // a full first frame, before any animation tick

    const after = calls.drawImage;
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(calls.drawImage).toBeGreaterThan(after + 300);
  });

  it('is decorative unless it is given a name', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext().ctx as unknown as CanvasRenderingContext2D);
    withTier('max');
    const { container, rerender } = mount(<Orb />);
    expect(container.querySelector('[data-engine]')).toHaveAttribute('aria-hidden', 'true');
    rerender(
      <ThemeProvider>
        <Orb label="Орб: слушаю" />
      </ThemeProvider>,
    );
    expect(screen.getByRole('img', { name: 'Орб: слушаю' })).toBeInTheDocument();
  });

  it('exposes the state, and shows radar rings only for a listening hero orb', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext().ctx as unknown as CanvasRenderingContext2D);
    withTier('max');
    const { container, rerender } = mount(<Orb size={220} state="listening" />);
    expect(container.querySelector('[data-state="listening"]')).not.toBeNull();
    expect(screen.getAllByTestId('orb-radar')).toHaveLength(3);

    rerender(
      <ThemeProvider>
        <Orb size={68} state="listening" />
      </ThemeProvider>,
    );
    expect(screen.queryAllByTestId('orb-radar')).toHaveLength(0);

    rerender(
      <ThemeProvider>
        <Orb size={220} state="thinking" />
      </ThemeProvider>,
    );
    expect(screen.queryAllByTestId('orb-radar')).toHaveLength(0);
  });

  it('stops painting when the tab is hidden and resumes when it is back', () => {
    const { ctx, calls } = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    withTier('max');
    mount(<Orb />);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const frozen = calls.drawImage;
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(calls.drawImage).toBe(frozen);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(calls.drawImage).toBeGreaterThan(frozen);
  });

  it('runs at 15 frames per second in walk mode, at 30 % brightness', () => {
    const { ctx, calls } = fakeContext();
    const alphas = new Set<number>();
    Object.defineProperty(ctx, 'globalAlpha', {
      get: () => 1,
      set: (v: number) => alphas.add(v),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    withTier('max');
    mount(<Orb walk />);
    const afterFirst = calls.clearRect;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const frames = calls.clearRect - afterFirst;
    expect(frames).toBeGreaterThanOrEqual(12);
    expect(frames).toBeLessThanOrEqual(17);
    expect(Math.max(...[...alphas].filter((a) => a < 1))).toBeLessThanOrEqual(0.3 + 1e-9);
  });

  it('follows a level ref without re-rendering', () => {
    const { ctx } = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    withTier('max');
    const level = { current: 0 };
    const renders = vi.fn();
    function Probe() {
      renders();
      return <Orb state="listening" level={level} size={120} />;
    }
    mount(<Probe />);
    const before = renders.mock.calls.length;
    level.current = 0.9;
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(renders.mock.calls.length).toBe(before);
  });
});

describe('Orb fallbacks to the CSS sphere', () => {
  it('on the low tier', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext().ctx as unknown as CanvasRenderingContext2D);
    withTier('min');
    const { container } = mount(<Orb />);
    expect(container.querySelector('[data-engine="css"]')).not.toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('under prefers-reduced-motion', () => {
    media = installMatchMedia({ features: { 'prefers-reduced-motion': 'reduce' } });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext().ctx as unknown as CanvasRenderingContext2D);
    withTier('max');
    const { container } = mount(<Orb state="listening" />);
    const css = container.querySelector('[data-engine="css"]');
    expect(css).not.toBeNull();
    expect(css).toHaveAttribute('data-reduced', 'true');
    expect(css).toHaveAttribute('data-state', 'listening');
  });

  it('where there is no 2D canvas', () => {
    stubCanvas();
    withTier('max');
    const { container } = mount(<Orb />);
    expect(container.querySelector('[data-engine="css"]')).not.toBeNull();
  });
});

describe('CssOrb', () => {
  beforeEach(() => stubCanvas());

  it('shows the voice as a brightness/ring variable while listening, and clears it after', () => {
    const level = { current: 0 };
    const { container, rerender } = render(<CssOrb state="listening" level={level} size={120} />);
    const orb = container.querySelector<HTMLElement>('[data-engine="css"]')!;
    level.current = 1;
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(parseFloat(orb.style.getPropertyValue('--level'))).toBeGreaterThan(0.8);

    rerender(<CssOrb state="paused" level={level} size={120} />);
    expect(orb.style.getPropertyValue('--level')).toBe('0');
  });

  it('takes its size from the prop', () => {
    const { container } = render(<CssOrb size={68} />);
    expect(container.querySelector<HTMLElement>('[data-engine="css"]')?.style.getPropertyValue('--orb-size')).toBe('68px');
  });
});

describe('OrbButton', () => {
  beforeEach(() => stubCanvas());

  it('is a named button that starts a recording on click', () => {
    const onClick = vi.fn();
    render(<OrbButton onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Записать' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('marks a running recording and listens', () => {
    const { container } = render(<OrbButton recording label="Идёт запись" />);
    const button = screen.getByRole('button', { name: 'Идёт запись' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('data-recording', 'true');
    expect(container.querySelector('[data-state="listening"]')).not.toBeNull();
  });

  it('can be a plain span, for the sphere slot of the navigation pill (no button inside a button)', () => {
    render(
      <button type="button" aria-label="Записать">
        <OrbButton interactive={false} />
      </button>,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('respects disabled', () => {
    const onClick = vi.fn();
    render(<OrbButton disabled onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('useOrbLevel', () => {
  function Host({ subscribe, enabled }: { subscribe: ((l: LevelListener) => () => void) | null; enabled?: boolean }) {
    const level = useOrbLevel(subscribe, enabled);
    return <output data-testid="level">{level.current.toFixed(2)}</output>;
  }

  it('writes pushed levels into the ref, clamped, and unsubscribes on unmount', () => {
    let push: LevelListener = () => undefined;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((listener: LevelListener) => {
      push = listener;
      return unsubscribe;
    });
    let seen: { current: number; updatedAt?: number } | undefined;
    function Probe() {
      seen = useOrbLevel(subscribe);
      return null;
    }
    const { unmount } = render(<Probe />);
    expect(subscribe).toHaveBeenCalledTimes(1);
    push(0.4);
    expect(seen?.current).toBe(0.4);
    push(7);
    expect(seen?.current).toBe(1);
    push(Number.NaN);
    expect(seen?.current).toBe(0);
    push(0.5);
    expect(seen?.updatedAt).toBeDefined();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(seen?.current).toBe(0);
  });

  it('does not subscribe without a source or when disabled, and keeps one stable ref', () => {
    const subscribe = vi.fn(() => () => undefined);
    const { rerender } = render(<Host subscribe={null} />);
    expect(screen.getByTestId('level')).toHaveTextContent('0.00');
    rerender(<Host subscribe={subscribe} enabled={false} />);
    expect(subscribe).not.toHaveBeenCalled();
    rerender(<Host subscribe={subscribe} enabled />);
    expect(subscribe).toHaveBeenCalledTimes(1);
    rerender(<Host subscribe={subscribe} enabled />);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('accepts a meter object with a subscribe method, as src/audio provides', () => {
    let push: LevelListener = () => undefined;
    const unsubscribe = vi.fn();
    const meter = {
      subscribe: vi.fn((listener: LevelListener) => {
        push = listener;
        return unsubscribe;
      }),
    };
    let seen = { current: -1 };
    function Probe() {
      seen = useOrbLevel(meter);
      return null;
    }
    const { unmount } = render(<Probe />);
    expect(meter.subscribe).toHaveBeenCalledTimes(1);
    push(0.6);
    expect(seen.current).toBe(0.6);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
