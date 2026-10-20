import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AudioMarker } from './lanes';
import { MarkerLane } from './MarkerLane';

const MARKERS: AudioMarker[] = [
  { id: 'm1', time: 14, kind: 'decision', label: 'Запустить интенсив в ноябре' },
  { id: 'm2', time: 15, kind: 'commitment', label: 'Отправить программу Фёдору' },
  { id: 'm3', time: 90, kind: 'idea', label: 'Сделать тестовый урок бесплатным' },
];

describe('MarkerLane', () => {
  it('draws one button per marker, in time order, each named by its type, wording and second', () => {
    render(<MarkerLane markers={[MARKERS[2]!, MARKERS[0]!, MARKERS[1]!]} durationSec={120} />);
    const lane = screen.getByRole('group', { name: 'Что нашлось в записи' });
    const buttons = within(lane).getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveAccessibleName('Решение: Запустить интенсив в ноябре. Перейти к 0:14');
    expect(buttons[1]).toHaveAccessibleName('Обязательство: Отправить программу Фёдору. Перейти к 0:15');
    expect(buttons[2]).toHaveAccessibleName('Идея: Сделать тестовый урок бесплатным. Перейти к 1:30');
  });

  it('keeps neighbours apart on two lanes', () => {
    render(<MarkerLane markers={MARKERS} durationSec={120} />);
    const [a, b, c] = screen.getAllByRole('button');
    expect(a).toHaveAttribute('data-lane', '0');
    expect(b).toHaveAttribute('data-lane', '1'); // one second after the first: too close for the same lane
    expect(c).toHaveAttribute('data-lane', '0');
  });

  it('places a marker at its share of the recording', () => {
    render(<MarkerLane markers={[MARKERS[2]!]} durationSec={120} />);
    expect(screen.getByRole('button').style.getPropertyValue('--at')).toBe('75');
  });

  it('shows only the dot for a resting marker, and unfolds the active one into a pill', () => {
    render(<MarkerLane markers={MARKERS} durationSec={120} activeId="m1" />);
    const [a, b] = screen.getAllByRole('button');
    expect(a).toHaveAttribute('aria-current', 'true');
    expect(within(a!).getByText('Запустить интенсив в ноябре')).toBeInTheDocument();
    expect(within(a!).getByText('0:14')).toBeInTheDocument();
    expect(b).not.toHaveAttribute('aria-current');
    expect(within(b!).queryByText('Отправить программу Фёдору')).toBeNull();
  });

  it('follows the playhead: the marker just passed is the active one', () => {
    const { rerender } = render(<MarkerLane markers={MARKERS} durationSec={120} currentTime={16} />);
    expect(screen.getAllByRole('button')[1]).toHaveAttribute('aria-current', 'true'); // m2 at 15 s
    rerender(<MarkerLane markers={MARKERS} durationSec={120} currentTime={50} />);
    expect(screen.getAllByRole('button').some((b) => b.getAttribute('aria-current'))).toBe(false);
    rerender(<MarkerLane markers={MARKERS} durationSec={120} currentTime={91} />);
    expect(screen.getAllByRole('button')[2]).toHaveAttribute('aria-current', 'true');
  });

  it('lets the owner override the playhead, including with "none"', () => {
    const { rerender } = render(<MarkerLane markers={MARKERS} durationSec={120} currentTime={16} activeId="m3" />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[2]).toHaveAttribute('aria-current', 'true');
    expect(buttons[1]).not.toHaveAttribute('aria-current');
    rerender(<MarkerLane markers={MARKERS} durationSec={120} currentTime={16} activeId={null} />);
    expect(screen.getAllByRole('button').some((b) => b.getAttribute('aria-current'))).toBe(false);
  });

  it('flips the pill to grow leftwards near the right edge so it stays inside', () => {
    render(<MarkerLane markers={[MARKERS[0]!, MARKERS[2]!]} durationSec={120} activeId="m3" />);
    const [early, late] = screen.getAllByRole('button');
    expect(late!.className).toMatch(/end/);
    expect(early!.className).not.toMatch(/end/);
    render(<MarkerLane markers={[MARKERS[0]!]} durationSec={120} activeId="m1" />);
    expect(screen.getAllByRole('button').at(-1)!.className).toMatch(/start/);
  });

  it('a tap goes to that second', () => {
    const onSeek = vi.fn();
    render(<MarkerLane markers={MARKERS} durationSec={120} onSeek={onSeek} />);
    fireEvent.click(screen.getAllByRole('button')[2]!);
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(90, MARKERS[2]);
  });

  it('is reachable by keyboard: the markers are real buttons', () => {
    render(<MarkerLane markers={MARKERS} durationSec={120} />);
    for (const button of screen.getAllByRole('button')) expect(button.tagName).toBe('BUTTON');
  });

  it('draws nothing for a recording without findings', () => {
    const { container } = render(<MarkerLane markers={[]} durationSec={120} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('marks the type in the dot, not in the text colour', () => {
    const { container } = render(<MarkerLane markers={[MARKERS[0]!]} durationSec={120} activeId="m1" />);
    const dot = container.querySelector('[data-kind="decision"][aria-hidden="true"]') as HTMLElement | null;
    expect(dot?.style.getPropertyValue('--c')).toBe('var(--t-decision)');
  });
});
