import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { itemsRepo } from '../../db';
import { wipeAll } from '../../db/maintenance';
import { installMatchMedia } from '../../styles/mockMatchMedia';
import type { MatchMediaControl } from '../../styles/mockMatchMedia';
import { ToastProvider } from '../../ui';
import CollectionsScreen from './CollectionsScreen';

let media: MatchMediaControl;
beforeEach(async () => {
  media = installMatchMedia({ width: 390 });
  await wipeAll();
});
afterEach(() => media.restore());

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname}</output>;
}

describe('«Коллекции»', () => {
  it('восемь карточек со счётчиком (ждущие подтверждения и отклонённые не в счёте) и переход в список', async () => {
    await itemsRepo.create({ kind: 'commitment', direction: 'i_owe', title: 'Прислать договор' });
    await itemsRepo.create({ kind: 'commitment', direction: 'i_owe', title: 'Старое', status: 'done' });
    await itemsRepo.create({ kind: 'commitment', direction: 'i_owe', title: 'Ещё не принято', status: 'proposed' });
    await itemsRepo.create({ kind: 'commitment', direction: 'i_owe', title: 'Отклонено', status: 'dismissed' });

    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/items']}>
          <Where />
          <Routes>
            <Route path="/items" element={<CollectionsScreen />} />
            <Route path="*" element={null} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
    const card = await screen.findByRole('button', { name: /^Обязательства, 2 записи/ });
    expect(screen.getAllByRole('button', { name: /только ты/ })).toHaveLength(8);
    expect(screen.getByRole('button', { name: /^Прогнозы, 0 записей/ })).toBeInTheDocument();
    fireEvent.click(card);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/items/commitment'));
  });
});
