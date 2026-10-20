import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturesRepo, checkinsRepo, peopleRepo } from '../../db';
import { wipeAll } from '../../db/maintenance';
import { addDays, localDayKey } from '../../domain/dates';
import { installMatchMedia } from '../../styles/mockMatchMedia';
import type { MatchMediaControl } from '../../styles/mockMatchMedia';
import { ToastProvider } from '../../ui';
import { stubCanvas } from '../../ui/testUtils';
import { OrbitScreen } from './OrbitScreen';

let media: MatchMediaControl;
beforeEach(async () => {
  stubCanvas();
  media = installMatchMedia({ width: 390 });
  await wipeAll();
});
afterEach(() => {
  media.restore();
  vi.restoreAllMocks();
});

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

const renderAt = (entry: string) =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Where />
        <Routes>
          <Route path="/orbit" element={<OrbitScreen />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );

describe('«Орбита»', () => {
  it('заголовок пишет текущий сегмент, сегмент живёт в URL', async () => {
    renderAt('/orbit?tab=people');
    expect(await screen.findByRole('heading', { level: 1, name: 'Люди' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Паттерны' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Паттерны' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/orbit?tab=patterns');
  });

  it('«Время» без записей: счётчик дней, а не пустая фигура', async () => {
    renderAt('/orbit');
    expect(await screen.findByText('Картина недели появится через 3 дня записей.')).toBeInTheDocument();
  });

  it('«Время» с данными: фигура недели, слои, тренд, детали дня со ссылкой на запись', async () => {
    // A Thursday: the four recorded days all fall into one calendar week, whatever day the suite runs on.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 15, 12, 0, 0) });
    const today = localDayKey();
    const created: string[] = [];
    for (let i = 0; i < 4; i++) {
      const day = addDays(today, -i);
      const capture = await capturesRepo.create({ kind: 'text', text: `запись ${i}`, title: `Запись ${i}`, day, status: 'done', tags: ['Деньги'] });
      created.push(capture.id);
      await checkinsRepo.create({ valence: 0.2, energy: i < 2 ? 0.3 : 0.8, day, at: `${day}T10:00:00.000Z` });
    }
    renderAt(`/orbit?tab=time&view=week&day=${today}`);
    expect(await screen.findByRole('group', { name: 'Слои' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Тренд замечен' })).toBeInTheDocument();
    expect(screen.getByText('Деньги')).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: /Запись 0/ });
    expect(link).toHaveAttribute('href', `#/entry/${created[0]}`);

    // A layer off hides its rows.
    fireEvent.click(screen.getByRole('button', { name: 'Записи' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: /Запись 0/ })).toBeNull());

    // The view switch is in the URL.
    fireEvent.click(screen.getByRole('radio', { name: 'Месяц' }));
    expect(screen.getByTestId('where').textContent).toContain('view=month');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('«Люди»: пустой список подсказывает, как появятся люди; созданный вручную виден', async () => {
    renderAt('/orbit?tab=people');
    expect(await screen.findByText('Назови кого-нибудь в записи, и человек появится здесь сам.')).toBeInTheDocument();
    await peopleRepo.create({ name: 'Анна', role: 'parent' });
    expect(await screen.findByRole('link', { name: /Анна/ })).toHaveAttribute('href', expect.stringMatching(/^#\/people\//));
  });
});
