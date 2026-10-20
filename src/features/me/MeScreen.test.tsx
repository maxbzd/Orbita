import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capturesRepo, itemsRepo, patternsRepo, profileRepo } from '../../db';
import { wipeAll } from '../../db/maintenance';
import { installMatchMedia } from '../../styles/mockMatchMedia';
import type { MatchMediaControl } from '../../styles/mockMatchMedia';
import { ToastProvider } from '../../ui';
import MeScreen from './MeScreen';

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

function renderMe(entry = '/me') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Where />
        <Routes>
          <Route path="/me" element={<MeScreen />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('«Я»', () => {
  it('пустой профиль: «Контекст 0 %», подсказки что добавить, неделя без давления', async () => {
    renderMe();
    expect(await screen.findByText('Контекст 0 %')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Контекст' })).toHaveAttribute('aria-valuetext', '0 %');
    const steps = screen.getByRole('list', { name: 'Что добавить' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3);
    expect(within(steps).getAllByText('+20 %')).toHaveLength(2);
    expect(screen.getByText(/Недель с записями: 0 из 12/)).toBeInTheDocument();
    expect(screen.getByText(/ничего не сбрасывает/)).toBeInTheDocument();
  });

  it('процент и серия считаются из данных', async () => {
    await profileRepo.save({ name: 'Дима', about: 'Консультант по математике, веду школу' });
    await itemsRepo.create({ kind: 'fact', title: 'Клиентов', value: '14' });
    await itemsRepo.create({ kind: 'fact', title: 'Старый', value: '1', status: 'dropped' });
    await patternsRepo.create({ title: 'Откладываю счета', description: 'Каждый месяц', kind: 'behavior', status: 'confirmed' });
    await capturesRepo.create({ kind: 'text', text: 'привет', status: 'done' });

    renderMe();
    // name 10 + about 20 + 1 of 5 facts = 4 + 1 of 3 patterns = 5
    expect(await screen.findByText('Контекст 39 %')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Дима' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Недель с записями: 1 из 12/)).toBeInTheDocument());
  });

  it('ссылки ведут в разделы', async () => {
    renderMe();
    await screen.findByText('Контекст 0 %');
    for (const [name, path] of [
      ['Коллекции', '/items'],
      ['Паспорт', '/reviews'],
      ['Настройки', '/settings'],
      ['Контекст для ИИ', '/context'],
      ['Спросить', '/ask'],
    ] as const) {
      expect(screen.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute('href', `#${path}`);
    }
    fireEvent.click(screen.getByRole('link', { name: /^Настройки/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/settings');
  });

  it('«Память»: профиль правится и сохраняется, факты и подтверждённые паттерны видны', async () => {
    await itemsRepo.create({ kind: 'fact', title: 'Клиентов', value: '14' });
    await patternsRepo.create({ title: 'Откладываю счета', description: 'Каждый месяц', kind: 'behavior', status: 'confirmed' });
    await patternsRepo.create({ title: 'Не мой паттерн', description: 'x', kind: 'behavior', status: 'candidate' });

    renderMe();
    fireEvent.click(await screen.findByRole('button', { name: /Память/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Память' });
    expect(within(sheet).getByRole('link', { name: /Клиентов/ })).toHaveAttribute('href', expect.stringContaining('/items/fact?item='));
    expect(within(sheet).getByText('Откладываю счета')).toBeInTheDocument();
    expect(within(sheet).queryByText('Не мой паттерн')).not.toBeInTheDocument();

    const save = within(sheet).getByRole('button', { name: 'Сохранить' });
    expect(save).toBeDisabled();
    fireEvent.change(within(sheet).getByLabelText(/^Кто я/), { target: { value: 'Консультант по математике, веду онлайн-школу' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(async () => expect((await profileRepo.get()).about).toBe('Консультант по математике, веду онлайн-школу'));
    expect(await within(sheet).findByText('Память обновлена')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/Контекст \d+ %/)[0]).toHaveTextContent('Контекст 29 %'));
  });
});
