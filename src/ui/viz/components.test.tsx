import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMatchMedia } from '../../styles/mockMatchMedia';
import type { MatchMediaControl } from '../../styles/mockMatchMedia';
import { CalibrationChart } from './CalibrationChart';
import { Constellation } from './Constellation';
import { DayOrbit } from './DayOrbit';
import { Heat } from './Heat';
import { MonthRing } from './MonthRing';
import { MoodFlower } from './MoodFlower';
import { MoodSlider } from './MoodSlider';
import { PeopleSphereList } from './PeopleSphere';
import { Sparkline } from './Sparkline';
import { WeekOrbit } from './WeekOrbit';
import { YearSky } from './YearSky';

let media: MatchMediaControl;
beforeEach(() => {
  media = installMatchMedia({ width: 390 });
});
afterEach(() => media.restore());

describe('DayOrbit', () => {
  it('draws the planet, ring dots and satellites, and reports taps', () => {
    const onEntry = vi.fn();
    const onSat = vi.fn();
    const onPlanet = vi.fn();
    render(
      <DayOrbit
        mood={2}
        value={5}
        nowMinutes={600}
        entries={[
          { id: 'e1', kind: 'decision', label: 'Решил переехать', minutes: 540 },
          { id: 'e2', kind: 'idea', label: 'Идея про приложение', minutes: 900 },
        ]}
        satellites={[
          { id: 'c1', title: 'Отправить договор', dueLabel: 'через 2 дня' },
          { id: 'c2', title: 'Позвонить маме', overdue: true, dueLabel: 'просрочено на 1 день' },
        ]}
        onEntryClick={onEntry}
        onSatelliteClick={onSat}
        onPlanetClick={onPlanet}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Решил переехать/ }));
    expect(onEntry).toHaveBeenCalledWith('e1');
    fireEvent.click(screen.getByRole('button', { name: /Позвонить маме/ }));
    expect(onSat).toHaveBeenCalledWith('c2');
    expect(screen.getAllByRole('button', { name: /просрочено/ }).length).toBeGreaterThan(0);
  });

  it('describes the whole day in text for a screen reader', () => {
    const { container } = render(<DayOrbit mood={0} entries={[{ id: 'e1', kind: 'idea', label: 'Мысль', minutes: 60 }]} />);
    expect(container.textContent).toContain('Мысль');
  });
});

describe('calendar figures', () => {
  it('MonthRing selects a day', () => {
    const onSelect = vi.fn();
    render(<MonthRing month="2026-10" today="2026-10-08" days={[{ date: '2026-10-07', mood: 2, count: 3 }]} onSelect={onSelect} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(31);
    fireEvent.click(radios[6]!);
    expect(onSelect).toHaveBeenCalledWith('2026-10-07');
  });

  it('WeekOrbit has seven days', () => {
    const onSelect = vi.fn();
    render(<WeekOrbit week="2026-10-07" today="2026-10-07" onSelect={onSelect} cursor={{ date: '2026-10-07', minutes: 720 }} />);
    const days = screen.getAllByRole('radio');
    expect(days).toHaveLength(7);
    fireEvent.click(days[0]!);
    expect(onSelect).toHaveBeenCalledWith('2026-10-05');
  });

  it('YearSky shows twelve months', () => {
    const onMonth = vi.fn();
    const { container } = render(
      <YearSky
        year={2026}
        today="2026-10-08"
        onSelectMonth={onMonth}
        days={[{ date: '2026-03-02', mood: -1, count: 1 }]}
        variant="garden"
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
    const month = screen.getAllByRole('button').find((b) => /март/i.test(b.getAttribute('aria-label') ?? ''));
    expect(month).toBeTruthy();
    fireEvent.click(month!);
    expect(onMonth).toHaveBeenCalledWith('2026-03');
  });

  it('Heat is a grid of days and selects one', () => {
    const onSelect = vi.fn();
    render(<Heat from="2026-09-28" to="2026-10-11" values={{ '2026-10-01': 3, '2026-10-02': 1 }} onSelect={onSelect} />);
    const cells = screen.getAllByRole('radio');
    expect(cells.length).toBeGreaterThanOrEqual(14);
    fireEvent.click(cells[0]!);
    expect(onSelect).toHaveBeenCalledWith('2026-09-28');
  });
});

describe('MoodFlower and MoodSlider', () => {
  it('names the flower by mood and can be decorative', () => {
    const { rerender } = render(<MoodFlower value={2} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Приятно');
    rerender(<MoodFlower value={2} decorative />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('is a slider with 7 steps driven by the keyboard', () => {
    const onChange = vi.fn();
    render(<MoodSlider value={0} onChange={onChange} />);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('aria-valuemin', '-3');
    expect(slider).toHaveAttribute('aria-valuemax', '3');
    expect(slider).toHaveAttribute('aria-valuenow', '0');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(-3);
  });

  it('does not change when disabled', () => {
    const onChange = vi.fn();
    render(<MoodSlider value={1} onChange={onChange} disabled />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('graph figures', () => {
  it('Constellation draws every node and says what links what', () => {
    const { container } = render(
      <Constellation
        animate={false}
        nodes={[
          { id: 'a', label: 'Запись A' },
          { id: 'b', label: 'Запись B' },
          { id: 'c', label: 'Запись C' },
        ]}
        edges={[
          { a: 'a', b: 'b', status: 'confirmed' },
          { a: 'b', b: 'c', status: 'candidate' },
        ]}
      />,
    );
    expect(container.querySelectorAll('line, path').length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toMatch(/Запись A/);
  });

  it('CalibrationChart says "мало данных" under five closed predictions', () => {
    render(<CalibrationChart forecasts={[{ probability: 0.7, happened: true }]} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('мало данных');
  });

  it('CalibrationChart shows the Brier score when there is enough', () => {
    const forecasts = [0.9, 0.8, 0.7, 0.6, 0.5].map((probability) => ({ probability, happened: true }));
    render(<CalibrationChart forecasts={forecasts} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('0.11');
  });

  it('Sparkline summarises itself for assistive tech', () => {
    render(<Sparkline values={[1, 3, null, 2]} summary="Настроение за 4 дня" />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Настроение за 4 дня');
  });

  it('PeopleSphereList is the static, keyboard-friendly variant of the sphere', () => {
    const onSelect = vi.fn();
    render(
      <PeopleSphereList
        onSelect={onSelect}
        people={[
          { id: 'p1', name: 'Анна', role: 'client', mentions: 5 },
          { id: 'p2', name: 'Борис', role: 'client', mentions: 1 },
        ]}
      />,
    );
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Анна/ }));
    expect(onSelect).toHaveBeenCalledWith('p1');
  });
});
