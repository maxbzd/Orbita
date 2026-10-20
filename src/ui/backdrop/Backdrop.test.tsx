import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../styles/theme';
import { stubCanvas } from '../testUtils';
import { Aura } from './Aura';
import { Backdrop } from './Backdrop';

beforeEach(() => {
  stubCanvas();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('Backdrop', () => {
  it('is a decorative layer: hidden from assistive technology, sky and aura inside', () => {
    render(<Backdrop />);
    const backdrop = screen.getByTestId('backdrop');
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('sky')).toBeInTheDocument();
    expect(screen.getByTestId('aura')).toBeInTheDocument();
  });

  it('draws no aura at intensity 0 (working lists)', () => {
    render(<Backdrop auraIntensity={0} />);
    expect(screen.queryByTestId('aura')).toBeNull();
  });

  it('omits the grain where it is switched off or cannot be drawn', () => {
    render(<Backdrop grain={false} />);
    expect(screen.queryByTestId('grain')).toBeNull();
  });

  it.each([
    ['night', true],
    ['dawn', false],
  ])('twinkling canvas in %s: %s (the high tier is forced so the host machine does not matter)', (theme, expected) => {
    localStorage.setItem('orbit:ui:theme', theme);
    localStorage.setItem('orbit:ui:effects', 'max');
    const { container } = render(
      <ThemeProvider>
        <Backdrop />
      </ThemeProvider>,
    );
    expect(container.querySelector('canvas') !== null).toBe(expected);
  });

  it('keeps the canvas off on the low tier', () => {
    localStorage.setItem('orbit:ui:theme', 'night');
    localStorage.setItem('orbit:ui:effects', 'min');
    const { container } = render(
      <ThemeProvider>
        <Backdrop />
      </ThemeProvider>,
    );
    expect(container.querySelector('canvas')).toBeNull();
  });
});

describe('Aura', () => {
  it('stamps the mood step that themes.css turns into colours', () => {
    const { container } = render(<Aura mood={0.7} />);
    expect(container.querySelector('[data-mood="2"]')).not.toBeNull();
  });

  it('cross-fades: a new mood adds a layer on top, the old one leaves after the fade', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Aura mood={0} />);
    expect(container.querySelectorAll('[data-mood]')).toHaveLength(1);

    rerender(<Aura mood={-1} />);
    const layers = container.querySelectorAll('[data-mood]');
    expect(layers).toHaveLength(2);
    expect(layers[0]).toHaveAttribute('data-mood', '0');
    expect(layers[1]).toHaveAttribute('data-mood', '-3');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const after = container.querySelectorAll('[data-mood]');
    expect(after).toHaveLength(1);
    expect(after[0]).toHaveAttribute('data-mood', '-3');
  });

  it('does not stack layers when the mood stays in the same step', () => {
    const { container, rerender } = render(<Aura mood={0.5} />);
    rerender(<Aura mood={0.6} />);
    expect(container.querySelectorAll('[data-mood]')).toHaveLength(1);
  });

  it('clamps the intensity to 0..1', () => {
    const { rerender } = render(<Aura intensity={3} />);
    expect(screen.getByTestId('aura').style.getPropertyValue('--aura-level')).toBe('1');
    rerender(<Aura intensity={-1} />);
    expect(screen.getByTestId('aura').style.getPropertyValue('--aura-level')).toBe('0');
  });
});
