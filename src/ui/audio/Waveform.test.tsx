import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { barCount } from './peaks';
import { Waveform } from './Waveform';

const PEAKS = Array.from({ length: 180 }, (_, i) => Math.abs(Math.sin(i / 7)));

beforeAll(() => {
  // jsdom has no PointerEvent: clientX would be lost without a stand-in.
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventStandIn extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'mouse';
      }
    }
    Object.defineProperty(window, 'PointerEvent', { configurable: true, value: PointerEventStandIn });
  }
});

/** Gives the wave a real 300 px box, since jsdom lays nothing out. */
function sized(el: HTMLElement, left = 0, width = 300): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left,
    width,
    right: left + width,
    top: 0,
    bottom: 80,
    height: 80,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

const pointer = (type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel', el: HTMLElement, clientX: number): void => {
  fireEvent(el, createEvent[type](el, { clientX, pointerId: 1, pointerType: 'mouse', button: 0 }));
};

describe('Waveform as a slider', () => {
  it('exposes the position in seconds and in words', () => {
    render(<Waveform peaks={PEAKS} progress={0.5} durationSec={134} onSeek={() => undefined} />);
    const slider = screen.getByRole('slider', { name: 'Положение в записи' });
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '134');
    expect(slider).toHaveAttribute('aria-valuenow', '67');
    expect(slider).toHaveAttribute('aria-valuetext', '1 минута 7 секунд из 2 минуты 14 секунд');
    expect(slider).toHaveAttribute('tabindex', '0');
  });

  it('falls back to percent when the length is unknown', () => {
    render(<Waveform peaks={PEAKS} progress={0.25} onSeek={() => undefined} />);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('aria-valuemax', '100');
    expect(slider).toHaveAttribute('aria-valuenow', '25');
    expect(slider).toHaveAttribute('aria-valuetext', '25 %');
  });

  it('clamps a progress outside 0..1 and survives NaN', () => {
    const { rerender } = render(<Waveform peaks={PEAKS} progress={-4} durationSec={100} onSeek={() => undefined} />);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '0');
    rerender(<Waveform peaks={PEAKS} progress={9} durationSec={100} onSeek={() => undefined} />);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
    rerender(<Waveform peaks={PEAKS} progress={Number.NaN} durationSec={100} onSeek={() => undefined} />);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '0');
  });

  it('is only a picture without onSeek (a capsule in a list row)', () => {
    render(<Waveform peaks={PEAKS} progress={0.3} label="Волна записи" />);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByRole('img', { name: 'Волна записи' })).not.toHaveAttribute('tabindex');
  });

  it('is not interactive while disabled', () => {
    const onSeek = vi.fn();
    render(<Waveform peaks={PEAKS} onSeek={onSeek} disabled />);
    const wave = screen.getByTestId('waveform');
    expect(wave).not.toHaveAttribute('tabindex');
    fireEvent.keyDown(wave, { key: 'ArrowRight' });
    expect(onSeek).not.toHaveBeenCalled();
  });
});

describe('Waveform keyboard scrubbing', () => {
  const setup = (progress = 0.5) => {
    const onSeek = vi.fn();
    render(<Waveform peaks={PEAKS} progress={progress} durationSec={100} onSeek={onSeek} />);
    return { onSeek, slider: screen.getByRole('slider') };
  };

  it('steps 5 s with the arrows and 15 s with Shift', () => {
    const { onSeek, slider } = setup();
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onSeek).toHaveBeenLastCalledWith(expect.closeTo(0.55, 10));
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onSeek).toHaveBeenLastCalledWith(expect.closeTo(0.45, 10));
    fireEvent.keyDown(slider, { key: 'ArrowRight', shiftKey: true });
    expect(onSeek).toHaveBeenLastCalledWith(expect.closeTo(0.65, 10));
  });

  it('jumps to the ends with Home and End and by a tenth with the page keys', () => {
    const { onSeek, slider } = setup();
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onSeek).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(slider, { key: 'PageUp' });
    expect(onSeek).toHaveBeenLastCalledWith(expect.closeTo(0.6, 10));
  });

  it('stops at both ends instead of overshooting', () => {
    const start = setup(0.02);
    fireEvent.keyDown(start.slider, { key: 'ArrowLeft' });
    expect(start.onSeek).toHaveBeenLastCalledWith(0);
  });

  it('leaves other keys and shortcuts alone', () => {
    const { onSeek, slider } = setup();
    fireEvent.keyDown(slider, { key: 'a' });
    fireEvent.keyDown(slider, { key: 'Tab' });
    fireEvent.keyDown(slider, { key: 'ArrowRight', ctrlKey: true });
    fireEvent.keyDown(slider, { key: 'ArrowRight', metaKey: true });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('prevents the page from scrolling on a handled key only', () => {
    const { slider } = setup();
    const handled = createEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent(slider, handled);
    expect(handled.defaultPrevented).toBe(true);
    const ignored = createEvent.keyDown(slider, { key: 'x' });
    fireEvent(slider, ignored);
    expect(ignored.defaultPrevented).toBe(false);
  });
});

describe('Waveform pointer scrubbing', () => {
  it('previews while dragging and commits once on release', () => {
    const onSeek = vi.fn();
    const onScrub = vi.fn();
    render(<Waveform peaks={PEAKS} progress={0.1} durationSec={100} onSeek={onSeek} onScrub={onScrub} />);
    const wave = screen.getByTestId('waveform');
    sized(wave, 20, 300);

    pointer('pointerDown', wave, 170);
    expect(onScrub).toHaveBeenLastCalledWith(0.5);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '50'); // follows the finger at once

    pointer('pointerMove', wave, 245);
    expect(onScrub).toHaveBeenLastCalledWith(0.75);
    expect(onSeek).not.toHaveBeenCalled();

    pointer('pointerUp', wave, 245);
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(0.75);
    expect(onScrub).toHaveBeenLastCalledWith(null);
  });

  it('a tap is a seek', () => {
    const onSeek = vi.fn();
    render(<Waveform peaks={PEAKS} durationSec={100} onSeek={onSeek} />);
    const wave = screen.getByTestId('waveform');
    sized(wave, 0, 200);
    pointer('pointerDown', wave, 50);
    pointer('pointerUp', wave, 50);
    expect(onSeek).toHaveBeenCalledWith(0.25);
  });

  it('clamps a drag past the edges', () => {
    const onSeek = vi.fn();
    render(<Waveform peaks={PEAKS} durationSec={100} onSeek={onSeek} />);
    const wave = screen.getByTestId('waveform');
    sized(wave, 100, 200);
    pointer('pointerDown', wave, 150);
    pointer('pointerMove', wave, 9999);
    pointer('pointerUp', wave, 9999);
    expect(onSeek).toHaveBeenLastCalledWith(1);
    pointer('pointerDown', wave, 150);
    pointer('pointerUp', wave, -50);
    expect(onSeek).toHaveBeenLastCalledWith(0);
  });

  it('a cancelled gesture (the page started to scroll) seeks nowhere', () => {
    const onSeek = vi.fn();
    const onScrub = vi.fn();
    render(<Waveform peaks={PEAKS} progress={0.4} durationSec={100} onSeek={onSeek} onScrub={onScrub} />);
    const wave = screen.getByTestId('waveform');
    sized(wave, 0, 300);
    pointer('pointerDown', wave, 150);
    pointer('pointerCancel', wave, 150);
    expect(onSeek).not.toHaveBeenCalled();
    expect(onScrub).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '40'); // back to the real position
  });

  it('ignores moves when no press started inside', () => {
    const onScrub = vi.fn();
    render(<Waveform peaks={PEAKS} durationSec={100} onSeek={() => undefined} onScrub={onScrub} />);
    const wave = screen.getByTestId('waveform');
    sized(wave);
    pointer('pointerMove', wave, 100);
    pointer('pointerUp', wave, 100);
    expect(onScrub).not.toHaveBeenCalled();
  });

  it('does not react to the right mouse button', () => {
    const onScrub = vi.fn();
    render(<Waveform peaks={PEAKS} durationSec={100} onSeek={() => undefined} onScrub={onScrub} />);
    const wave = screen.getByTestId('waveform');
    sized(wave);
    fireEvent(wave, createEvent.pointerDown(wave, { clientX: 100, pointerId: 1, pointerType: 'mouse', button: 2 }));
    expect(onScrub).not.toHaveBeenCalled();
  });
});

describe('Waveform drawing', () => {
  it('draws one stroke per bar: 2 px bars with a 1 px gap across the width', () => {
    render(<Waveform peaks={PEAKS} />);
    const d = screen.getByTestId('wave-rest').getAttribute('d') ?? '';
    // no measured width in jsdom: the 320 px fallback
    expect(d.match(/M/g)).toHaveLength(barCount(320));
  });

  it('shows the played part in the AI gradient up to the playhead, the rest in ink-3', () => {
    const { container } = render(<Waveform peaks={PEAKS} progress={0.25} />);
    const clip = container.querySelector('clipPath rect');
    expect(Number(clip?.getAttribute('width'))).toBeCloseTo(320 * 0.25, 5);
    const played = screen.getByTestId('wave-played');
    expect(played.getAttribute('stroke')).toMatch(/^url\(#.+-g\)$/);
    expect(played.getAttribute('clip-path')).toMatch(/^url\(#.+-c\)$/);
    const stops = Array.from(container.querySelectorAll('stop')).map((s) => (s as SVGStopElement).style.stopColor);
    expect(stops).toEqual(['var(--ai-1)', 'var(--ai-2)', 'var(--ai-3)']);
  });

  it('adds the mirror image at 35 % of the height, and can leave it out', () => {
    const { container, rerender } = render(<Waveform peaks={PEAKS} height={56} />);
    const svg = container.querySelector('svg');
    expect(Number(svg?.getAttribute('height'))).toBe(56 + Math.round(56 * 0.35) + 3);
    expect(container.querySelectorAll('path')).toHaveLength(4);
    rerender(<Waveform peaks={PEAKS} height={56} reflection={false} />);
    expect(container.querySelectorAll('path')).toHaveLength(2);
  });

  it('draws a quiet line for empty or broken peaks instead of crashing', () => {
    const { container, rerender } = render(<Waveform peaks={[]} />);
    expect(container.querySelectorAll('path')[0]?.getAttribute('d')).toContain('M');
    rerender(<Waveform peaks={[Number.NaN, 9, -2, Number.POSITIVE_INFINITY]} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('moves the playhead with the progress', () => {
    const { container, rerender } = render(<Waveform peaks={PEAKS} progress={0} onSeek={() => undefined} />);
    expect(container.querySelector('line')?.getAttribute('x1')).toBe('0');
    rerender(<Waveform peaks={PEAKS} progress={0.5} onSeek={() => undefined} />);
    expect(container.querySelector('line')?.getAttribute('x1')).toBe('160');
  });
});
