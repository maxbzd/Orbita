import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturesRepo, patternsRepo, updateSettings } from '../../db';
import { wipeAll } from '../../db/maintenance';
import { installMatchMedia } from '../../styles/mockMatchMedia';
import type { MatchMediaControl } from '../../styles/mockMatchMedia';
import { ToastProvider } from '../../ui';
import { PatternsView } from './PatternsView';

let media: MatchMediaControl;
beforeEach(async () => {
  vi.stubEnv('VITE_MOCK_AI', '');
  media = installMatchMedia({ width: 390 });
  await wipeAll();
});
afterEach(() => {
  media.restore();
  vi.unstubAllEnvs();
});

const renderView = () =>
  render(
    <ToastProvider>
      <MemoryRouter>
        <PatternsView />
      </MemoryRouter>
    </ToastProvider>,
  );

const seedPattern = () =>
  patternsRepo.create({
    title: 'Откладываю разговоры про деньги',
    description: 'Молчу, пока не станет стыдно.',
    kind: 'behavior',
    suggestion: 'Отправь сообщение сразу.',
    confidence: 0.7,
    evidence: [
      { captureId: 'c1', day: '2026-10-01', quote: 'опять не стал писать про оплату' },
      { captureId: 'c2', day: '2026-10-04', quote: 'снова отложил звонок' },
    ],
  });

describe('паттерны', () => {
  it('меньше 14 записей и нет паттернов: счётчик вместо пустоты', async () => {
    await capturesRepo.create({ kind: 'text', text: 'раз', status: 'done' });
    renderView();
    expect(await screen.findByText('Паттерны появятся после 14 записей. Сейчас 1.')).toBeInTheDocument();
  });

  it('карточка: доказательства со ссылками на запись, уверенность, что делать', async () => {
    await seedPattern();
    renderView();
    expect(await screen.findByRole('heading', { name: 'Откладываю разговоры про деньги' })).toBeInTheDocument();
    expect(screen.getByText('Уверенность высокая, 70 %')).toBeInTheDocument();
    expect(screen.getByText('«опять не стал писать про оплату»')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Открыть запись' })[0]).toHaveAttribute('href', '#/entry/c1');
    expect(screen.getByText('Отправь сообщение сразу.')).toBeInTheDocument();
  });

  it('«Да, это про меня» подтверждает, «Уже не актуально» переводит в решённые', async () => {
    const created = await seedPattern();
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Да, это про меня' }));
    await waitFor(async () => expect((await patternsRepo.get(created.id))?.status).toBe('confirmed'));
    expect(await screen.findByText('Подтверждён')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Уже не актуально' }));
    await waitFor(async () => expect((await patternsRepo.get(created.id))?.status).toBe('resolved'));
    expect(await screen.findByText('Пока нет паттернов для проверки.')).toBeInTheDocument();
  });

  it('«Нет» отклоняет, паттерн уходит в «Отклонённые»', async () => {
    const created = await seedPattern();
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Нет' }));
    await waitFor(async () => expect((await patternsRepo.get(created.id))?.status).toBe('rejected'));
    fireEvent.click(await screen.findByRole('button', { name: /Отклонённые/ }));
    expect(await screen.findByRole('heading', { name: 'Откладываю разговоры про деньги' })).toBeInTheDocument();
  });

  it('без ключа «Пересчитать» выключена, причина написана по-русски', async () => {
    await seedPattern();
    await updateSettings({ ai: { provider: 'anthropic' } });
    renderView();
    expect(await screen.findByText(/Не задан ключ Anthropic/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Пересчитать' })).toBeDisabled();
  });
});
