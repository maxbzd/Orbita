import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildReviewDigest } from '../../ai';
import { checkinsRepo } from '../../db';
import { wipeAll } from '../../db/maintenance';
import { localDayKey } from '../../domain/dates';
import { ThemeProvider } from '../../styles/theme';
import { ToastProvider } from '../../ui';
import { stubCanvas } from '../../ui/testUtils';
import CheckInScreen from './CheckInScreen';
import { HIDE_FROM_AI_TAG } from './logic';

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderCheckIn() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={['/checkin']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <CheckInScreen />
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

const setMood = (steps: number): void => {
  const slider = screen.getByRole('slider', { name: 'Состояние' });
  slider.focus();
  for (let i = 0; i < Math.abs(steps); i++) fireEvent.keyDown(slider, { key: steps > 0 ? 'ArrowRight' : 'ArrowLeft' });
};

const stored = () => checkinsRepo.listByDay(localDayKey());

beforeEach(async () => {
  stubCanvas();
  await wipeAll();
});

describe('check-in', () => {
  it('can stop after the first step: the state is saved as a manual check-in', async () => {
    renderCheckIn();
    expect(await screen.findByRole('heading', { name: 'Как ты сейчас?' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Состояние' })).toHaveAttribute('aria-valuenow', '0');
    setMood(2);
    expect(screen.getByRole('slider', { name: 'Состояние' })).toHaveAttribute('aria-valuenow', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/today'));
    const [saved, ...rest] = await stored();
    expect(rest).toEqual([]);
    expect(saved).toMatchObject({ origin: 'manual', energy: 0.5, tags: [] });
    expect(saved?.valence).toBeCloseTo(2 / 3);
  });

  it('records energy, words and factors across the three steps in one check-in', async () => {
    renderCheckIn();
    await screen.findByRole('heading', { name: 'Как ты сейчас?' });
    setMood(-2);
    fireEvent.click(screen.getByRole('radio', { name: 'Мало' }));
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));

    expect(await screen.findByRole('heading', { name: 'Какие слова подходят?' })).toBeInTheDocument();
    // Step one was saved when moving on: leaving here would lose nothing.
    await waitFor(async () => expect(await stored()).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'грустно' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
    fireEvent.click(await screen.findByRole('button', { name: 'грустно' }));
    fireEvent.click(screen.getByRole('button', { name: 'устал' }));
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));

    expect(await screen.findByRole('heading', { name: 'Что на это влияет?' })).toBeInTheDocument();
    for (const factor of ['Деньги', 'Сон']) fireEvent.click(screen.getByRole('button', { name: factor }));
    fireEvent.change(screen.getByLabelText('Пара слов для себя'), { target: { value: 'Мало спал' } });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/today'));
    const all = await stored();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ origin: 'manual', energy: 0.2, note: 'Мало спал' });
    expect(all[0]?.valence).toBeCloseTo(-2 / 3);
    expect(all[0]?.tags).toEqual(['грустно', 'устал', 'деньги', 'сон']);
  });

  it('keeps a state out of the AI when asked, even in reviews', async () => {
    renderCheckIn();
    await screen.findByRole('heading', { name: 'Как ты сейчас?' });
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть от ИИ' }));
    expect(screen.getByRole('button', { name: 'Скрыть от ИИ' })).toHaveAttribute('aria-pressed', 'true');
    setMood(-1);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/today'));

    expect((await stored())[0]?.tags).toContain(HIDE_FROM_AI_TAG);
    // The review digest, which goes to the model, does not see it; a visible one is counted.
    const day = localDayKey();
    expect((await buildReviewDigest('day', day)).mood).toBeNull();
    await checkinsRepo.create({ valence: 0.3, energy: 0.5 });
    expect((await buildReviewDigest('day', day)).mood?.checkins).toBe(1);
  });

  it('lists what the AI suggested and confirms it on request', async () => {
    const suggestion = await checkinsRepo.create({ valence: 0.67, energy: 0.6, tags: ['продажи'], origin: 'ai_suggested' });
    renderCheckIn();
    expect(await screen.findByText('ИИ заметил в записях')).toBeInTheDocument();
    expect(screen.getByText('Приятно')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
    await waitFor(async () => expect((await checkinsRepo.get(suggestion.id))?.origin).toBe('ai_confirmed'));
  });

  it('closes without saving anything', async () => {
    renderCheckIn();
    await screen.findByRole('heading', { name: 'Как ты сейчас?' });
    setMood(1);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/today'));
    expect(await stored()).toEqual([]);
  });
});
