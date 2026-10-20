import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturesRepo, checkinsRepo, itemsRepo, patternsRepo, reviewsRepo } from '../../db';
import { wipeAll } from '../../db/maintenance';
import { addDays, localDayKey } from '../../domain/dates';
import { ThemeProvider } from '../../styles/theme';
import { ToastProvider } from '../../ui';
import { stubCanvas } from '../../ui/testUtils';
import TodayScreen from './TodayScreen';

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function renderToday() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={['/today']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <TodayScreen />
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </ThemeProvider>,
  );
}

/** Only `Date` is faked: IndexedDB and React keep their real timers. */
function at(hour: number): void {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 7, hour, 30) });
}

beforeEach(async () => {
  stubCanvas();
  await wipeAll();
});
afterEach(() => vi.useRealTimers());

describe('"Сегодня" for a new user', () => {
  it('shows the honest emptiness with the two ways forward', async () => {
    at(10);
    renderToday();
    expect(await screen.findByText('Пока тихо. Скажи первую мысль, я разложу её.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Тихий день' })).toBeInTheDocument();
    expect(screen.getByText(/Доброе утро/)).toBeInTheDocument();
    // Nothing below the hero: no blocks to fake importance.
    expect(screen.queryByRole('heading', { name: 'Горит сегодня' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Что заметил' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Загрузить демо-данные' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Записать' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/capture?autostart=1');
  });

  it('loads the demo data on request and then shows a living day', async () => {
    renderToday();
    fireEvent.click(await screen.findByRole('button', { name: 'Загрузить демо-данные' }));
    expect(await screen.findByRole('heading', { name: 'Горит сегодня' }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.queryByText('Пока тихо. Скажи первую мысль, я разложу её.')).toBeNull();
  }, 20_000);
});

describe('"Сегодня" with data', () => {
  const today = localDayKey();

  it('shows the verdict, the burning rows and the metrics from the database, live', async () => {
    at(14);
    const day = localDayKey();
    const record = await capturesRepo.create({ kind: 'text', text: 'Позвонить Анне', status: 'done', day });
    await itemsRepo.create({
      kind: 'commitment',
      status: 'active',
      title: 'Отправить отчёт Анне',
      direction: 'i_owe',
      counterpartyName: 'Анна',
      captureId: record.id,
      dueAt: new Date(2026, 9, 4, 12).toISOString(),
    });
    renderToday();

    expect(await screen.findByRole('heading', { level: 1, name: 'Есть долги по обещаниям' })).toBeInTheDocument();
    const burning = screen.getByRole('region', { name: 'Горит сегодня' });
    expect(within(burning).getByText('Отправить отчёт Анне')).toBeInTheDocument();
    expect(within(burning).getByText('просрочено на 3 дня')).toBeInTheDocument();
    const metrics = screen.getByRole('group', { name: 'Итоги дня' });
    expect(within(metrics).getByText('Записей').previousSibling).toHaveTextContent('1');

    // Reactive: a second overdue promise appears without a reload.
    await act(async () => {
      await itemsRepo.create({ kind: 'commitment', status: 'active', title: 'Ответить Борису', direction: 'i_owe', dueAt: new Date(2026, 9, 6, 12).toISOString() });
    });
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Горит сегодня' })).getByText('Ответить Борису')).toBeInTheDocument());
  });

  it('colours the day by the check-ins and offers to confirm what the AI suggested', async () => {
    at(11);
    await checkinsRepo.create({ valence: 0.34, energy: 0.6, day: localDayKey(), at: new Date(2026, 9, 7, 9).toISOString(), origin: 'manual' });
    await checkinsRepo.create({ valence: -0.3, energy: 0.4, day: localDayKey(), at: new Date(2026, 9, 7, 10).toISOString(), origin: 'ai_suggested' });
    await capturesRepo.create({ kind: 'text', text: 'Заметка', status: 'done', day: localDayKey() });
    renderToday();
    const metrics = await screen.findByRole('group', { name: 'Итоги дня' });
    expect(within(metrics).getByText('Спокойно')).toBeInTheDocument();
    expect(screen.getByText(/ИИ заметил состояние/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Сейчас: спокойно/ })).toBeInTheDocument();
  });

  it('answers a candidate pattern with one tap', async () => {
    at(12);
    await capturesRepo.create({ kind: 'text', text: 'Заметка', status: 'done', day: localDayKey() });
    const pattern = await patternsRepo.create({
      title: 'Откладываю разговоры про деньги',
      description: 'Три раза за месяц',
      kind: 'behavior',
      evidence: [],
      confidence: 0.7,
      status: 'candidate',
      firstSeenDay: addDays(localDayKey(), -20),
      lastSeenDay: addDays(localDayKey(), -1),
      occurrences: 3,
    });
    renderToday();
    expect(await screen.findByText('Откладываю разговоры про деньги')).toBeInTheDocument();
    expect(screen.getByText('ИИ может ошибаться. Проверь.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Да, про меня' }));
    await waitFor(async () => expect((await patternsRepo.get(pattern.id))?.status).toBe('confirmed'));
  });

  it('is honest about patterns that are not there yet', async () => {
    at(12);
    await capturesRepo.create({ kind: 'text', text: 'Раз', status: 'done', day: today });
    renderToday();
    expect(await screen.findByText('Паттерны появятся после 14 записей. Сейчас 1.')).toBeInTheDocument();
  });

  it('offers "Закрыть день" only in the evening, and closes the day with a review', async () => {
    at(14);
    await capturesRepo.create({ kind: 'text', text: 'Днём', status: 'done', day: localDayKey() });
    const afternoon = renderToday();
    await screen.findByRole('heading', { name: 'Горит сегодня' });
    expect(screen.queryByRole('button', { name: 'Закрыть день' })).toBeNull();
    afternoon.unmount();

    at(20);
    renderToday();
    fireEvent.click(await screen.findByRole('button', { name: 'Закрыть день' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/^\/reviews\/.+/));
    const reviews = await reviewsRepo.list({ period: 'day' });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.startDay).toBe(localDayKey());
  });
});
