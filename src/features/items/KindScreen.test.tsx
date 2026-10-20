import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { itemsRepo } from '../../db';
import { wipeAll } from '../../db/maintenance';
import { addDays, localDayKey, startOfDayInstant } from '../../domain/dates';
import { installMatchMedia } from '../../styles/mockMatchMedia';
import type { MatchMediaControl } from '../../styles/mockMatchMedia';
import { ToastProvider } from '../../ui';
import KindScreen from './KindScreen';

let media: MatchMediaControl;
beforeEach(async () => {
  media = installMatchMedia({ width: 390 });
  await wipeAll();
});
afterEach(() => media.restore());

const inDays = (count: number): string => startOfDayInstant(addDays(localDayKey(), count)).toISOString();

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function renderKind(entry: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Where />
        <Routes>
          <Route path="/items/:kind" element={<KindScreen />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('список объектов', () => {
  it('обязательства: группы Скоро / Активные / Закрытые, просрочка словами, переключатель направления', async () => {
    await itemsRepo.create({ kind: 'commitment', title: 'Прислать договор', direction: 'i_owe', counterpartyName: 'Фёдор', dueAt: inDays(-3) });
    await itemsRepo.create({ kind: 'commitment', title: 'Оплатить хостинг', direction: 'i_owe', dueAt: inDays(30) });
    await itemsRepo.create({ kind: 'commitment', title: 'Вернуть деньги', direction: 'owed_to_me', counterpartyName: 'Мария', dueAt: inDays(2) });
    await itemsRepo.create({ kind: 'commitment', title: 'Старое дело', direction: 'i_owe', status: 'done' });

    renderKind('/items/commitment');
    const soon = await screen.findByRole('region', { name: /Скоро/ });
    expect(within(soon).getByText('просрочено на 3 дня')).toBeInTheDocument();
    expect(within(soon).getByText('Прислать договор')).toBeInTheDocument();
    expect(within(soon).getByText('Вернуть деньги')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: /Активные/ })).getByText('Оплатить хостинг')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: /Закрытые/ })).getByText('Старое дело')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Мне должны' }));
    expect(screen.queryByText('Прислать договор')).not.toBeInTheDocument();
    expect(screen.getByText('Вернуть деньги')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Все' }));
    fireEvent.click(screen.getByRole('radio', { name: 'По людям' }));
    expect(screen.getByRole('region', { name: /Фёдор/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Мария/ })).toBeInTheDocument();
  });

  it('поиск сужает список, а «ничего не найдено» даёт сбросить фильтры', async () => {
    await itemsRepo.create({ kind: 'task', title: 'Позвонить маме' });
    await itemsRepo.create({ kind: 'task', title: 'Записать вебинар' });
    renderKind('/items/task');
    await screen.findByText('Позвонить маме');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по объектам' }), { target: { value: 'вебинар' } });
    expect(screen.queryByText('Позвонить маме')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по объектам' }), { target: { value: 'ничего' } });
    expect(await screen.findByText('Ничего не найдено.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(await screen.findByText('Позвонить маме')).toBeInTheDocument();
  });

  it('пустой вид зовёт добавить, неизвестный вид — к коллекциям', async () => {
    renderKind('/items/prediction');
    expect(await screen.findByText(/Сделай первый прогноз/)).toBeInTheDocument();
    renderKind('/items/nonsense');
    expect(await screen.findByText('Такого вида объектов нет.')).toBeInTheDocument();
  });
});

describe('карточка объекта', () => {
  it('«Откуда это» ведёт к записи, закрытие обязательства — с «Вернуть»', async () => {
    const item = await itemsRepo.create({ kind: 'commitment', title: 'Прислать договор', direction: 'i_owe', captureId: 'cap1', quote: 'пришлю договор до пятницы' });
    renderKind(`/items/commitment?item=${item.id}`);
    const sheet = await screen.findByTestId('item-sheet');
    expect(within(sheet).getByText('«пришлю договор до пятницы»')).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: /Откуда это/ })).toHaveAttribute('href', `/entry/cap1?item=${item.id}`);

    fireEvent.click(within(sheet).getByRole('button', { name: 'Выполнено' }));
    await waitFor(async () => expect(await itemsRepo.get(item.id)).toMatchObject({ status: 'done' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Вернуть' }));
    await waitFor(async () => expect(await itemsRepo.get(item.id)).toMatchObject({ status: 'active' }));
  });

  it('удаление уходит в корзину, «Вернуть» возвращает', async () => {
    const item = await itemsRepo.create({ kind: 'lesson', title: 'Не откладывать счета' });
    renderKind(`/items/lesson?item=${item.id}`);
    const sheet = await screen.findByTestId('item-sheet');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Удалить' }));
    await waitFor(async () => expect((await itemsRepo.get(item.id))?.deletedAt).toBeDefined());
    fireEvent.click(await screen.findByRole('button', { name: 'Вернуть' }));
    await waitFor(async () => expect((await itemsRepo.get(item.id))?.deletedAt).toBeUndefined());
  });

  it('прогноз: закрывается исходом, график — «мало данных» до пяти', async () => {
    const item = await itemsRepo.create({ kind: 'prediction', title: 'Наберу 20 учеников', probability: 0.7, dueAt: inDays(-1) });
    renderKind('/items/prediction');
    expect(await screen.findByTestId('calibration')).toHaveTextContent('Мало данных');
    expect(screen.getByRole('region', { name: /К закрытию/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Прогноз: Наберу 20 учеников/ }));
    const sheet = await screen.findByTestId('item-sheet');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сбылось' }));
    await waitFor(async () => expect(await itemsRepo.get(item.id)).toMatchObject({ status: 'done', outcome: 'true' }));
    await waitFor(() => expect(screen.getByTestId('calibration')).toHaveTextContent('Закрыто 1 из 5'));
  });

  it('решение: «как оно вышло?» — оценка и заметка записываются в итог', async () => {
    const item = await itemsRepo.create({ kind: 'decision', title: 'Поднять цену', chosen: 'Да', dueAt: inDays(-2) });
    renderKind(`/items/decision?item=${item.id}`);
    const sheet = await screen.findByTestId('item-sheet');
    const save = within(sheet).getByRole('button', { name: 'Записать итог' });
    expect(save).toBeDisabled();
    fireEvent.click(within(sheet).getByRole('radio', { name: /4 из 5/ }));
    fireEvent.change(within(sheet).getByLabelText('Заметка'), { target: { value: 'Ушло двое, пришло трое' } });
    fireEvent.click(save);
    await waitFor(async () =>
      expect(await itemsRepo.get(item.id)).toMatchObject({ status: 'done', outcome: { rating: 4, note: 'Ушло двое, пришло трое' } }),
    );
  });

  it('идея: «Слить сюда» превращает похожую в дубль, «Сделать задачей» создаёт задачу', async () => {
    const keep = await itemsRepo.create({ kind: 'idea', title: 'Запустить интенсив по OKR в ноябре' });
    const copy = await itemsRepo.create({ kind: 'idea', title: 'Запустить интенсив для OKR в ноябре' });
    renderKind(`/items/idea?item=${keep.id}`);
    const sheet = await screen.findByTestId('item-sheet');
    fireEvent.click(await within(sheet).findByRole('button', { name: /Слить в эту идею: Запустить интенсив для OKR/ }));
    await waitFor(async () => expect(await itemsRepo.get(copy.id)).toMatchObject({ status: 'dropped', duplicateOf: keep.id }));

    fireEvent.click(within(sheet).getByRole('button', { name: 'Сделать задачей' }));
    await waitFor(async () => expect((await itemsRepo.list({ kind: 'task' })).map((task) => task.title)).toEqual(['Запустить интенсив по OKR в ноябре']));
  });
});

describe('создание вручную', () => {
  it('«+» открывает форму выбранного вида; без сути не сохраняет', async () => {
    renderKind('/items/commitment');
    await screen.findByText(/Открытых обещаний нет/);
    fireEvent.click(screen.getByRole('button', { name: /Добавить: Обязательства/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Новый объект' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    expect(await within(dialog).findByText('Напиши суть в паре слов.')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Суть'), { target: { value: 'Прислать смету' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Мне должны' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить' }));

    await waitFor(async () => expect(await itemsRepo.list({ kind: 'commitment' })).toMatchObject([{ title: 'Прислать смету', direction: 'owed_to_me', status: 'active' }]));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/^\/items\/commitment\?item=/));
  });
});
