import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capturesRepo, itemsRepo, peopleRepo } from '../../db';
import { wipeAll } from '../../db/maintenance';
import { installMatchMedia } from '../../styles/mockMatchMedia';
import type { MatchMediaControl } from '../../styles/mockMatchMedia';
import { ToastProvider } from '../../ui';
import PersonScreen from './PersonScreen';

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

function renderCard(id: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/people/${id}`]}>
        <Where />
        <Routes>
          <Route path="/people/:personId" element={<PersonScreen />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('карточка человека', () => {
  it('показывает обязательства в обе стороны и хронологию упоминаний', async () => {
    const anna = await peopleRepo.create({ name: 'Анна', role: 'parent', notes: 'Мама Миши' });
    const capture = await capturesRepo.create({ kind: 'text', text: 'Говорил с Анной про оплату', title: 'Разговор с Анной', personIds: [anna.id], status: 'done' });
    await itemsRepo.create({ kind: 'commitment', title: 'Прислать план занятий', direction: 'i_owe', counterpartyId: anna.id, status: 'active', dueAt: '2020-01-01T10:00:00.000Z', captureId: capture.id });
    await itemsRepo.create({ kind: 'commitment', title: 'Оплатить месяц', direction: 'owed_to_me', counterpartyId: anna.id, status: 'active' });
    await itemsRepo.create({ kind: 'commitment', title: 'Старое дело', direction: 'i_owe', counterpartyId: anna.id, status: 'done' });

    renderCard(anna.id);
    expect(await screen.findByRole('heading', { level: 1, name: 'Анна' })).toBeInTheDocument();

    const owe = await screen.findByRole('list', { name: 'Я должен' });
    expect(within(owe).getByText('Прислать план занятий')).toBeInTheDocument();
    expect(within(owe).getByText('просрочено')).toBeInTheDocument();
    expect(within(owe).queryByText('Старое дело')).toBeNull();
    const owed = screen.getByRole('list', { name: 'Мне должны' });
    expect(within(owed).getByText('Оплатить месяц')).toBeInTheDocument();

    const timeline = screen.getByRole('heading', { name: 'Хронология упоминаний' }).closest('section')!;
    const link = within(timeline).getByRole('link', { name: /Разговор с Анной/ });
    expect(link).toHaveAttribute('href', `#/entry/${capture.id}`);
  });

  it('«Подготовка к разговору» ведёт в конструктор контекста с этим человеком', async () => {
    const boris = await peopleRepo.create({ name: 'Борис' });
    renderCard(boris.id);
    fireEvent.click(await screen.findByRole('button', { name: 'Подготовка к разговору' }));
    expect(screen.getByTestId('where')).toHaveTextContent(`/context?person=${boris.id}`);
  });

  it('заметки правятся и сохраняются; архив обратим', async () => {
    const boris = await peopleRepo.create({ name: 'Борис' });
    renderCard(boris.id);
    fireEvent.change(await screen.findByLabelText('Заметки о человеке'), { target: { value: 'Любит графики' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить заметки' }));
    await waitFor(async () => expect((await peopleRepo.get(boris.id))?.notes).toBe('Любит графики'));

    fireEvent.click(screen.getByRole('button', { name: 'В архив' }));
    await waitFor(async () => expect((await peopleRepo.get(boris.id))?.archived).toBe(true));
    expect(await screen.findByRole('button', { name: 'Вернуть из архива' })).toBeInTheDocument();
  });

  it('слияние дублей: записи переходят к выбранному, старое имя становится псевдонимом', async () => {
    const masha = await peopleRepo.create({ name: 'Маша' });
    const full = await peopleRepo.create({ name: 'Маша Иванова' });
    await capturesRepo.create({ kind: 'text', text: 'с Машей', personIds: [masha.id], status: 'done' });

    renderCard(masha.id);
    fireEvent.click(await screen.findByRole('button', { name: 'Объединить с другим человеком' }));
    fireEvent.click(await screen.findByText('Маша Иванова'));
    fireEvent.click(await screen.findByRole('button', { name: 'Объединить' }));

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/people/${full.id}`));
    const merged = await peopleRepo.get(full.id);
    expect(merged?.aliases).toContain('Маша');
    expect(merged?.mentionCount).toBe(1);
    expect(await peopleRepo.get(masha.id)).toBeUndefined();
  });

  it('неизвестный человек: понятное сообщение', async () => {
    renderCard('nope');
    expect(await screen.findByText('Такого человека нет.')).toBeInTheDocument();
  });
});
