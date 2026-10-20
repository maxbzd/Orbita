import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { wipeAll } from '../../db/maintenance';
import { capturesRepo, checkinsRepo, itemsRepo } from '../../db';
import { installMatchMedia } from '../../styles/mockMatchMedia';
import type { MatchMediaControl } from '../../styles/mockMatchMedia';
import { ToastProvider } from '../../ui';
import StreamScreen from './StreamScreen';

let media: MatchMediaControl;
beforeEach(async () => {
  media = installMatchMedia({ width: 390 });
  await wipeAll();
});
afterEach(() => media.restore());

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function renderStream(entry = '/stream') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Where />
        <Routes>
          <Route path="/stream" element={<StreamScreen />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

const localIso = (y: number, m: number, d: number, h: number): string => new Date(y, m - 1, d, h).toISOString();

describe('«Поток»', () => {
  it('invites to record when there is nothing yet', async () => {
    renderStream();
    expect(await screen.findByText(/Здесь будут твои записи/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Записать' })).toBeInTheDocument();
  });

  it('lists unsorted records on top with the right action, and the rest by day and part of the day', async () => {
    await capturesRepo.create({ kind: 'voice', title: 'Сырая мысль', text: 'раз', status: 'transcribed', createdAt: localIso(2026, 10, 7, 21) });
    await capturesRepo.create({ kind: 'voice', title: 'Сломалась', text: 'два', status: 'failed', error: 'Нет связи', createdAt: localIso(2026, 10, 7, 20) });
    await capturesRepo.create({ kind: 'text', title: 'Ждёт разбора', text: 'три', status: 'review', createdAt: localIso(2026, 10, 7, 19) });
    await capturesRepo.create({ kind: 'text', title: 'Готовая утренняя', text: 'четыре', status: 'done', createdAt: localIso(2026, 10, 6, 9) });
    await capturesRepo.create({ kind: 'text', title: 'Готовая дневная', text: 'пять', status: 'done', createdAt: localIso(2026, 10, 6, 14) });

    renderStream();
    const inbox = await screen.findByRole('region', { name: /Неразобранные/ });
    expect(within(inbox).getAllByTestId('capture-row')).toHaveLength(3);
    expect(within(inbox).getAllByRole('button', { name: /Разобрать/ })).toHaveLength(2); // process + review
    expect(within(inbox).getByRole('button', { name: /Повторить/ })).toBeInTheDocument();
    expect(within(inbox).getByText('Нет связи')).toBeInTheDocument();

    // Finished records are below, not repeated in the inbox, day heading then part labels (newest first).
    const list = screen.getByTestId('stream-list');
    expect(within(list).getAllByTestId('capture-row')).toHaveLength(2);
    expect(within(list).getByText('Утро')).toBeInTheDocument();
    expect(within(list).getByText('День')).toBeInTheDocument();
    const texts = within(list).getAllByRole('link').map((link) => link.textContent);
    expect(texts[0]).toContain('Готовая дневная');
    expect(texts[1]).toContain('Готовая утренняя');
  });

  it('shows the objects of a record as chips, a mood flower and the length', async () => {
    const capture = await capturesRepo.create({ kind: 'voice', title: 'С объектами', text: 'x', status: 'done', durationSec: 75 });
    await itemsRepo.create({ kind: 'decision', title: 'Запустить интенсив', chosen: 'да', captureId: capture.id });
    await itemsRepo.create({ kind: 'task', title: 'Отклонённое', captureId: capture.id, status: 'proposed' });
    const dismissed = await itemsRepo.create({ kind: 'idea', title: 'Не покажется', captureId: capture.id, status: 'proposed' });
    await itemsRepo.dismiss(dismissed.id);
    await checkinsRepo.create({ valence: 0.8, energy: 0.6, captureId: capture.id });

    renderStream();
    const row = await screen.findByTestId('capture-row');
    expect(within(row).getByText('Запустить интенсив')).toBeInTheDocument();
    expect(within(row).getByText(/Отклонённое/)).toBeInTheDocument();
    expect(within(row).queryByText('Не покажется')).toBeNull();
    expect(within(row).getByText(/ждёт подтверждения/)).toBeInTheDocument();
    expect(within(row).getByText(/1 мин 15 с/)).toBeInTheDocument();
    expect(within(row).getByRole('img', { name: /Состояние/ })).toBeInTheDocument();
  });

  it('filters by object type and keeps the choice in the address', async () => {
    const a = await capturesRepo.create({ kind: 'text', title: 'Про решение', text: 'a', status: 'done' });
    const b = await capturesRepo.create({ kind: 'text', title: 'Про идею', text: 'b', status: 'done' });
    await itemsRepo.create({ kind: 'decision', title: 'Решил', chosen: 'x', captureId: a.id });
    await itemsRepo.create({ kind: 'idea', title: 'Придумал', captureId: b.id });

    renderStream();
    await screen.findByText('Про идею');
    fireEvent.click(screen.getByRole('button', { name: 'Идеи' }));
    await waitFor(() => expect(screen.queryByText('Про решение')).toBeNull());
    expect(screen.getByText('Про идею')).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toContain('type=idea');
    expect(screen.getByRole('button', { name: 'Идеи' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Все' }));
    await screen.findByText('Про решение');
  });

  it('says so when the filters leave nothing, and resets them', async () => {
    await capturesRepo.create({ kind: 'text', title: 'Одна', text: 'a', status: 'done' });
    renderStream('/stream?type=prediction');
    expect(await screen.findByText(/С такими фильтрами записей нет/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    // Only the sheet filters are reset by this button; the type chip stays: "Все" clears it.
    fireEvent.click(screen.getByRole('button', { name: 'Все' }));
    expect(await screen.findByText('Одна')).toBeInTheDocument();
  });

  it('searches the records with the matches marked, and "Спросить" goes to the ask screen', async () => {
    await capturesRepo.create({ kind: 'text', title: 'Цена интенсива', text: 'Решил поднять цену до пятнадцати тысяч', status: 'done' });
    await capturesRepo.create({ kind: 'text', title: 'Про сон', text: 'Надо ложиться раньше', status: 'done' });

    renderStream();
    const field = await screen.findByRole('searchbox');
    fireEvent.change(field, { target: { value: 'цену' } });
    const results = await screen.findByRole('list', { name: 'Результаты поиска' });
    expect(within(results).getAllByRole('listitem')).toHaveLength(1);
    expect(results.querySelector('mark')?.textContent?.toLowerCase()).toContain('цен');
    expect(screen.queryByText('Про сон')).toBeNull();

    fireEvent.change(field, { target: { value: 'абвгд' } });
    expect(await screen.findByText(/ничего не нашлось/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Спросить' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Что я обещал?' } });
    fireEvent.click(screen.getByRole('button', { name: /Спросить/ }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/ask?q=%D0%A7%D1%82%D0%BE%20%D1%8F%20%D0%BE%D0%B1%D0%B5%D1%89%D0%B0%D0%BB%3F'));
  });

  it('renders only the rows near the viewport once the list passes 200 lines', async () => {
    // One record per day: a heading, a part label and the record make three lines each.
    for (let day = 0; day < 100; day += 1) {
      await capturesRepo.create({ kind: 'text', title: `Запись ${day}`, text: 'x', status: 'done', createdAt: new Date(2026, 9, 7 - day, 12).toISOString() });
    }
    renderStream();
    const list = await screen.findByTestId('stream-list');
    expect(list).toHaveAttribute('data-virtual');
    const rendered = within(list).getAllByTestId('capture-row').length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(40);
    expect(screen.getByText('Запись 0')).toBeInTheDocument();
    expect(screen.queryByText('Запись 99')).toBeNull();
  });
});
