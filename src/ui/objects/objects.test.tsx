import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMatchMedia } from '../../styles/mockMatchMedia';
import type { MatchMediaControl } from '../../styles/mockMatchMedia';
import { ThemeProvider } from '../../styles/theme';
import { CollectionCard, LONG_PRESS_MS } from './CollectionCard';
import { InsightStar } from './InsightStar';
import { Passport } from './Passport';
import { Poster } from './Poster';
import { StoryViewer } from './StoryViewer';
import type { StorySlide } from './StoryViewer';
import { Ticket } from './Ticket';

// jsdom has no PointerEvent: without it fireEvent.pointer* loses clientX/clientY.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {
    pointerType: string;
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? 'mouse';
      this.pointerId = init.pointerId ?? 1;
    }
  }
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventShim, configurable: true });
}

let media: MatchMediaControl;
beforeEach(() => {
  media = installMatchMedia({ width: 390 });
});
afterEach(() => {
  media.restore();
  vi.useRealTimers();
});

describe('InsightStar', () => {
  it('shows the phrase and the type caption, and exposes them as the image label', () => {
    render(<InsightStar phrase="Ты обещаешь больше, чем успеваешь." kind="pattern" />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toContain('Ты обещаешь больше, чем успеваешь.');
    expect(img.getAttribute('viewBox')).toBe('0 0 300 400'); // 3:4
    expect(img.textContent).toContain('ПАТТЕРН');
  });

  it('keeps long phrases inside the star by shrinking, then truncating', () => {
    const { container } = render(<InsightStar phrase={'очень длинная мысль '.repeat(40)} />);
    expect(container.textContent).toContain('…');
  });

  it('offers the save button only when asked, and passes the svg', () => {
    const onSave = vi.fn();
    const { rerender } = render(<InsightStar phrase="Фраза" />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<InsightStar phrase="Фраза" onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить картинкой' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0]![0] as SVGSVGElement).tagName.toLowerCase()).toBe('svg');
  });
});

describe('Ticket', () => {
  it('is a 3:2 card that reads out the day, the hero number and both states', () => {
    render(<Ticket date="2026-10-08" from={-1} to={2} hero={{ value: 7, label: 'записей' }} stats={[{ label: 'ОБЕЩАНИЙ', value: 3 }]} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('viewBox')).toBe('0 0 360 240');
    const label = img.getAttribute('aria-label')!;
    expect(label).toContain('записей 7');
    expect(label).toContain('Утром: Не очень');
    expect(label).toContain('вечером: Приятно');
    expect(label).toContain('обещаний: 3');
  });

  it('copes with missing states and cuts the notches with a mask', () => {
    const { container } = render(<Ticket date="2026-10-08" hero={{ value: 0, label: 'записей' }} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Утром: не отмечено');
    expect(container.querySelector('mask')).not.toBeNull();
    expect(container.querySelectorAll('mask circle')).toHaveLength(2);
  });
});

describe('Passport', () => {
  it('prints the hero number, four stats and MRZ lines from the same numbers', () => {
    const stats = [
      { label: 'Решений', value: 37 },
      { label: 'Обещаний', value: 120 },
      { label: 'Идей', value: 9 },
      { label: 'Людей', value: 64 },
    ];
    const { container } = render(<Passport year={2026} hero={{ value: 412, label: 'записей' }} stats={stats} issuedOn="2026-12-31" />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('viewBox')).toBe('0 0 300 400'); // 3:4
    expect(img.getAttribute('aria-label')).toContain('записей: 412');
    const mrz = container.querySelectorAll('g[aria-hidden="true"] text');
    expect(mrz).toHaveLength(2);
    for (const line of mrz) {
      expect(line.textContent).toHaveLength(44);
      expect(line.textContent).toMatch(/^[A-Z0-9<]+$/);
    }
    expect(mrz[0]!.textContent).toContain('00412');
    expect(container.querySelectorAll('path[stroke-linecap="round"]')).toHaveLength(4);
  });
});

describe('Poster', () => {
  it('sets the month name across the whole width', () => {
    const { container } = render(
      <Poster month={9} year={2026} phrase="Тихий сентябрь" stats={[{ label: 'РЕШЕНИЙ', value: 12 }]} moods={[2, 1, null, -1]} />,
    );
    expect(screen.getByRole('img').getAttribute('viewBox')).toBe('0 0 360 640'); // 9:16
    const title = Array.from(container.querySelectorAll('text')).find((t) => t.textContent === 'СЕНТЯБРЬ')!;
    expect(title).toBeTruthy();
    expect(title.getAttribute('textLength')).toBe('320');
    expect(Number(title.getAttribute('font-size'))).toBeGreaterThanOrEqual(40);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Сентябрь 2026');
    expect(container.querySelectorAll('circle')).toHaveLength(30); // the 30 days of September
  });

  it('draws one dot per day, filled for days with a mood', () => {
    const { container } = render(<Poster month={2} year={2028} moods={[3, 3]} />);
    expect(container.querySelectorAll('g[aria-hidden="true"] circle')).toHaveLength(29);
    expect(container.querySelectorAll('g[aria-hidden="true"] circle[fill]:not([fill="none"])')).toHaveLength(2);
  });
});

describe('CollectionCard', () => {
  it('is one button with the type, the count and the privacy in its name', () => {
    const onOpen = vi.fn();
    render(<CollectionCard kind="decision" count={9} previews={['Переехать', 'Не брать кредит']} onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: 'Решения, 9 записей, только ты' });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(button.textContent).toContain('Переехать');
  });

  it('opens the menu on long press without also opening the card', () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const onMenu = vi.fn();
    render(<CollectionCard kind="idea" count={1} onOpen={onOpen} onMenu={onMenu} private={false} />);
    const button = screen.getByRole('button', { name: 'Идеи, 1 запись' });
    fireEvent.pointerDown(button, { clientX: 5, clientY: 5, pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    });
    expect(onMenu).toHaveBeenCalledWith(button);
    fireEvent.pointerUp(button);
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('cancels the long press when the finger moves, and offers the menu on right click', () => {
    vi.useFakeTimers();
    const onMenu = vi.fn();
    render(<CollectionCard kind="idea" count={2} onMenu={onMenu} />);
    const button = screen.getByRole('button');
    fireEvent.pointerDown(button, { clientX: 5, clientY: 5, pointerType: 'touch' });
    fireEvent.pointerMove(button, { clientX: 60, clientY: 5 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    });
    expect(onMenu).not.toHaveBeenCalled();
    fireEvent.contextMenu(button);
    expect(onMenu).toHaveBeenCalledTimes(1);
  });
});

function slides(n: number): StorySlide[] {
  return Array.from({ length: n }, (_, i) => ({ id: `s${i}`, label: `Слайд-${i}`, content: <p>Содержимое {i}</p> }));
}

describe('StoryViewer', () => {
  it('advances by itself every 5 seconds and finishes after the last slide', () => {
    vi.useFakeTimers();
    const onIndexChange = vi.fn();
    const onFinish = vi.fn();
    render(<StoryViewer slides={slides(2)} onIndexChange={onIndexChange} onFinish={onFinish} />);
    expect(screen.getByText('Содержимое 0')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4900);
    });
    expect(onIndexChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onIndexChange).toHaveBeenCalledWith(1);
    expect(screen.getByText('Содержимое 1')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5200);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('pauses while pressed and continues where it stopped', () => {
    vi.useFakeTimers();
    const onIndexChange = vi.fn();
    const { container } = render(<StoryViewer slides={slides(3)} onIndexChange={onIndexChange} />);
    const stage = container.querySelector('[class*="stage"]')!;
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    fireEvent.pointerDown(stage, { clientX: 200, clientY: 300, pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(onIndexChange).not.toHaveBeenCalled();
    expect(container.querySelector('section')).toHaveAttribute('data-paused');
    act(() => {
      vi.advanceTimersByTime(600); // a long hold ...
    });
    fireEvent.pointerUp(stage, { clientX: 200, clientY: 300, pointerType: 'touch' }); // ... releases without turning the page
    expect(onIndexChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1900);
    });
    expect(onIndexChange).not.toHaveBeenCalled(); // 3000 + 1900 < 5000
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it('pauses with the button and Space', () => {
    vi.useFakeTimers();
    const onIndexChange = vi.fn();
    render(<StoryViewer slides={slides(3)} onIndexChange={onIndexChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(screen.getByRole('button', { name: 'Продолжить' })).toHaveAttribute('aria-pressed', 'true');
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onIndexChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    const region = screen.getByRole('region', { name: 'Истории' });
    fireEvent.keyDown(region, { key: ' ' });
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeInTheDocument();
    fireEvent.keyDown(region, { key: ' ' });
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
  });

  it('pages with taps (left third back, rest forward) and swipes, and closes on a swipe down', () => {
    const onClose = vi.fn();
    const { container } = render(<StoryViewer slides={slides(4)} defaultIndex={1} autoAdvance={false} onClose={onClose} />);
    const stage = container.querySelector('[class*="stage"]')!;
    stage.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 300,
      height: 600,
      right: 300,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const tap = (x: number): void => {
      fireEvent.pointerDown(stage, { clientX: x, clientY: 200 });
      fireEvent.pointerUp(stage, { clientX: x, clientY: 200 });
    };
    tap(250);
    expect(screen.getByText('Содержимое 2')).toBeInTheDocument();
    tap(20);
    expect(screen.getByText('Содержимое 1')).toBeInTheDocument();
    fireEvent.pointerDown(stage, { clientX: 250, clientY: 200 });
    fireEvent.pointerUp(stage, { clientX: 100, clientY: 205 });
    expect(screen.getByText('Содержимое 2')).toBeInTheDocument();
    fireEvent.pointerDown(stage, { clientX: 100, clientY: 200 });
    fireEvent.pointerUp(stage, { clientX: 105, clientY: 380 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('responds to arrow keys, Home/End and Escape', () => {
    const onClose = vi.fn();
    const onFinish = vi.fn();
    render(<StoryViewer slides={slides(3)} autoAdvance={false} onClose={onClose} onFinish={onFinish} label="Чтение недели" />);
    const region = screen.getByRole('region', { name: 'Чтение недели' });
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    expect(screen.getByText('Содержимое 2')).toBeInTheDocument();
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    expect(onFinish).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(region, { key: 'ArrowLeft' });
    expect(screen.getByText('Содержимое 1')).toBeInTheDocument();
    fireEvent.keyDown(region, { key: 'Home' });
    expect(screen.getByText('Содержимое 0')).toBeInTheDocument();
    fireEvent.keyDown(region, { key: 'End' });
    expect(screen.getByText('Содержимое 2')).toBeInTheDocument();
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('announces the slide and works as a controlled component', () => {
    const onIndexChange = vi.fn();
    const { rerender } = render(<StoryViewer slides={slides(3)} index={0} onIndexChange={onIndexChange} autoAdvance={false} />);
    expect(screen.getByText('Слайд 1 из 3: Слайд-0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Вперёд' }));
    expect(onIndexChange).toHaveBeenCalledWith(1);
    expect(screen.getByText('Содержимое 0')).toBeInTheDocument(); // the parent decides
    rerender(<StoryViewer slides={slides(3)} index={1} onIndexChange={onIndexChange} autoAdvance={false} />);
    expect(screen.getByText('Слайд 2 из 3: Слайд-1')).toBeInTheDocument();
  });

  it('hands the slide element to onExport', () => {
    const onExport = vi.fn();
    render(<StoryViewer slides={slides(2)} autoAdvance={false} onExport={onExport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить картинку' }));
    const info = onExport.mock.calls[0]![0];
    expect(info.index).toBe(0);
    expect(info.slide.id).toBe('s0');
    expect(info.element).toHaveTextContent('Содержимое 0');
  });

  it('never advances by itself under reduced motion and hides the pause button', () => {
    vi.useFakeTimers();
    media.setFeature('prefers-reduced-motion', 'reduce');
    const onIndexChange = vi.fn();
    render(
      <ThemeProvider>
        <StoryViewer slides={slides(3)} onIndexChange={onIndexChange} />
      </ThemeProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onIndexChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Пауза' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Вперёд' })); // manual paging still works
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it('renders nothing for an empty story', () => {
    const { container } = render(<StoryViewer slides={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
