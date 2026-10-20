import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubCanvas } from '../testUtils';
import { DockRecorder } from './DockRecorder';
import { LevelBars } from './LevelBars';
import { LiveTranscript } from './LiveTranscript';
import { MiniRecorder } from './MiniRecorder';
import { RecordControls } from './RecordControls';
import { TimeDisplay } from './TimeDisplay';

beforeEach(() => stubCanvas());
afterEach(() => vi.useRealTimers());

describe('RecordControls', () => {
  it('has exactly three organs: Текст, Готово, Пауза', () => {
    render(<RecordControls />);
    const buttons = within(screen.getByRole('group', { name: 'Управление записью' })).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Текст', 'Готово', 'Пауза']);
  });

  it('wires each organ to its handler', () => {
    const onText = vi.fn();
    const onDone = vi.fn();
    const onTogglePause = vi.fn();
    render(<RecordControls onText={onText} onDone={onDone} onTogglePause={onTogglePause} />);
    fireEvent.click(screen.getByRole('button', { name: 'Текст' }));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(onText).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onTogglePause).toHaveBeenCalledTimes(1);
  });

  it('turns the pause button into "Продолжить" while paused, and "Готово" still saves', () => {
    const onDone = vi.fn();
    render(<RecordControls paused onDone={onDone} />);
    expect(screen.queryByRole('button', { name: 'Пауза' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('can leave out the text organ and keeps the main action in the middle', () => {
    render(<RecordControls hideText />);
    expect(screen.queryByRole('button', { name: 'Текст' })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('disables everything at once', () => {
    const onDone = vi.fn();
    render(<RecordControls disabled onDone={onDone} />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('TimeDisplay', () => {
  it('shows 02:14 and says "2 минуты 14 секунд"', () => {
    render(<TimeDisplay seconds={134} label="Запись" />);
    const time = screen.getByLabelText('Запись: 2 минуты 14 секунд');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', 'PT2M14S');
    expect(time).toHaveTextContent('02:14');
  });

  it('can be unpadded and shows a total after a slash', () => {
    render(<TimeDisplay seconds={42} total={134} pad={false} label="Положение" size="hero" />);
    const time = screen.getByLabelText('Положение: 42 секунды из 2 минуты 14 секунд');
    expect(time).toHaveTextContent('0:42/ 2:14');
  });

  it('can be a timer role for a running recording', () => {
    render(<TimeDisplay seconds={3} timer />);
    expect(screen.getByRole('timer')).toBeInTheDocument();
  });
});

describe('LiveTranscript', () => {
  it('separates what is sure from what is still being recognised', () => {
    render(<LiveTranscript final="Решил запустить интенсив" interim="в ноябре потому что" />);
    expect(screen.getByTestId('transcript-final')).toHaveTextContent('Решил запустить интенсив');
    const interim = screen.getByTestId('transcript-interim');
    expect(interim).toHaveTextContent('в ноябре потому что');
    expect(interim.className).not.toBe('');
    expect(screen.getByTestId('transcript-final').className).toBe('');
  });

  it('is a region that is not read aloud word by word', () => {
    render(<LiveTranscript final="Привет" />);
    const region = screen.getByRole('region', { name: 'Живой текст записи' });
    expect(region).toHaveAttribute('aria-live', 'off');
  });

  it('shows 3 to 5 lines, 4 by default', () => {
    const { rerender } = render(<LiveTranscript final="а" />);
    const lines = (): string => screen.getByTestId('live-transcript').style.getPropertyValue('--lines');
    expect(lines()).toBe('4');
    rerender(<LiveTranscript final="а" lines={5} />);
    expect(lines()).toBe('5');
    rerender(<LiveTranscript final="а" lines={3} />);
    expect(lines()).toBe('3');
    rerender(<LiveTranscript final="а" lines={9 as 5} />);
    expect(lines()).toBe('5');
    rerender(<LiveTranscript final="а" lines={1 as 3} />);
    expect(lines()).toBe('3');
  });

  it('prompts before the first word, and can stay silent', () => {
    const { rerender } = render(<LiveTranscript final="" />);
    expect(screen.getByText('Говори. Слова появятся здесь.')).toBeInTheDocument();
    rerender(<LiveTranscript final="  " interim=" " placeholder="" />);
    expect(screen.getByTestId('live-transcript')).toBeEmptyDOMElement();
  });

  it('puts one space between sure and interim text, and none when one is missing', () => {
    const { rerender } = render(<LiveTranscript final="раз" interim="два" />);
    expect(screen.getByTestId('live-transcript').textContent).toBe('раз два');
    rerender(<LiveTranscript final="" interim="два" />);
    expect(screen.getByTestId('live-transcript').textContent).toBe('два');
  });
});

describe('MiniRecorder', () => {
  it('is a labelled group with the time in its button name', () => {
    render(<MiniRecorder seconds={134} />);
    expect(screen.getByRole('group', { name: 'Идёт запись' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Вернуться к записи, 2 минуты 14 секунд' })).toBeInTheDocument();
  });

  it('opens the recording, pauses and saves', () => {
    const onOpen = vi.fn();
    const onTogglePause = vi.fn();
    const onDone = vi.fn();
    render(<MiniRecorder seconds={5} onOpen={onOpen} onTogglePause={onTogglePause} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: /Вернуться к записи/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onTogglePause).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('says it is paused, in words and in the button', () => {
    render(<MiniRecorder seconds={134} paused />);
    expect(screen.getByRole('group', { name: 'Запись на паузе' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Вернуться к записи, 2 минуты 14 секунд, пауза' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Продолжить запись' })).toBeInTheDocument();
    expect(screen.getByText('Пауза')).toBeInTheDocument();
  });

  it('has the four level bars', () => {
    render(<MiniRecorder seconds={1} level={0.5} />);
    expect(screen.getByTestId('level-bars').children).toHaveLength(4);
  });
});

describe('DockRecorder', () => {
  it('carries a listening orb, the time and the two actions', () => {
    const onDone = vi.fn();
    const onTogglePause = vi.fn();
    const { container } = render(<DockRecorder seconds={65} onDone={onDone} onTogglePause={onTogglePause} />);
    expect(container.querySelector('[data-state="listening"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Вернуться к записи, 1 минута 5 секунд' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(onTogglePause).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('freezes the orb and says so when paused', () => {
    const { container } = render(<DockRecorder seconds={65} paused />);
    expect(container.querySelector('[data-state="paused"]')).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Запись на паузе' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Продолжить запись' })).toBeInTheDocument();
  });

  it('opens the recording on a click on its body', () => {
    const onOpen = vi.fn();
    render(<DockRecorder seconds={3} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Вернуться к записи/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('LevelBars', () => {
  const heights = (): number[] =>
    Array.from(screen.getByTestId('level-bars').children).map((c) => parseFloat((c as HTMLElement).style.getPropertyValue('--h')));

  it('draws a plain number at once, loudest in the middle', () => {
    render(<LevelBars level={1} bars={5} />);
    const h = heights();
    expect(h).toHaveLength(5);
    expect(h[2]).toBeGreaterThan(h[0]!);
    expect(Math.max(...h)).toBeLessThanOrEqual(1);
  });

  it('is flat while paused', () => {
    render(<LevelBars level={1} bars={4} paused />);
    expect(heights()).toEqual([0, 0, 0, 0]);
  });

  it('follows a live ref: the newest level enters at the right and travels left', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const level = { current: 0 };
    render(<LevelBars level={level} bars={4} />);
    level.current = 1;
    act(() => {
      vi.advanceTimersByTime(250);
    });
    const h = heights();
    expect(h[3]).toBeGreaterThan(0.8);
    expect(h[3]).toBeGreaterThanOrEqual(h[0]!);
  });

  it('is decorative for assistive technology', () => {
    render(<LevelBars level={0.3} />);
    expect(screen.getByTestId('level-bars')).toHaveAttribute('aria-hidden', 'true');
  });
});
