import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { audioRepo, capturesRepo, itemsRepo } from '../../db';
import { wipeAll } from '../../db/maintenance';
import { installMatchMedia } from '../../styles/mockMatchMedia';
import type { MatchMediaControl } from '../../styles/mockMatchMedia';
import { ToastProvider } from '../../ui';
import EntryScreen from './EntryScreen';

let media: MatchMediaControl;
beforeEach(async () => {
  media = installMatchMedia({ width: 390 });
  Element.prototype.scrollIntoView = () => undefined;
  // jsdom has no object URLs.
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => undefined;
  await wipeAll();
});
afterEach(() => media.restore());

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname}</output>;
}

function renderEntry(id: string, search = '') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/entry/${id}${search}`]}>
        <Where />
        <Routes>
          <Route path="/entry/:captureId" element={<EntryScreen />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

const TEXT = 'Думаю про осень. Решил запустить интенсив в ноябре. Маше пообещал прислать программу до пятницы. Цена пока открыта.';

async function seedText() {
  const capture = await capturesRepo.create({ kind: 'text', title: 'Осенние планы', text: TEXT, status: 'review' });
  const decision = await itemsRepo.create({
    kind: 'decision',
    title: 'Запустить интенсив',
    chosen: 'в ноябре',
    captureId: capture.id,
    status: 'proposed',
    quote: 'запустить интенсив в ноябре',
    quoteStart: TEXT.indexOf('запустить интенсив в ноябре'),
  });
  const commitment = await itemsRepo.create({
    kind: 'commitment',
    title: 'Прислать Маше программу',
    direction: 'i_owe',
    counterpartyName: 'Маша',
    captureId: capture.id,
    status: 'proposed',
    quote: 'прислать программу до пятницы',
    quoteStart: TEXT.indexOf('прислать программу до пятницы'),
  });
  // The quote of this one is gone from the text (it was edited): the screen must say so.
  const lost = await itemsRepo.create({ kind: 'idea', title: 'Потерянная идея', captureId: capture.id, status: 'active', quote: 'этой фразы больше нет', quoteStart: 3 });
  return { capture, decision, commitment, lost };
}

describe('«Запись (детально)»', () => {
  it('says there is no such record', async () => {
    renderEntry('nope');
    expect(await screen.findByText('Такой записи нет.')).toBeInTheDocument();
  });

  it('offers to bring back a record from the trash', async () => {
    const capture = await capturesRepo.create({ kind: 'text', text: 'x' });
    await capturesRepo.remove(capture.id);
    renderEntry(capture.id);
    fireEvent.click(await screen.findByRole('button', { name: 'Вернуть' }));
    await waitFor(async () => expect((await capturesRepo.get(capture.id))?.deletedAt).toBeUndefined());
  });

  it('marks the quotes of the objects in the transcript and finds the missing one', async () => {
    await seedText();
    const { container } = renderEntry((await capturesRepo.listInbox())[0]!.id);
    await screen.findByText('Осенние планы');

    const quotes = [...container.querySelectorAll('[data-quote]')].map((el) => el.textContent);
    expect(quotes).toEqual(['запустить интенсив в ноябре', 'прислать программу до пятницы']);
    // No player for a typed record, and an honest line for the quote that is not in the text any more.
    expect(screen.queryByRole('region', { name: 'Плеер записи' })).toBeNull();
    expect(screen.getByText(/Цитаты нет в тексте/)).toBeInTheDocument();
  });

  it('goes both ways: a quote to its object and an object to its quote', async () => {
    const { capture, decision } = await seedText();
    const { container } = renderEntry(capture.id);
    await screen.findByText('Осенние планы');

    const quote = container.querySelector(`[data-quote="${decision.id}"]`) as HTMLElement;
    fireEvent.click(quote);
    const card = container.querySelector(`[data-item="${decision.id}"]`) as HTMLElement;
    await waitFor(() => expect(quote.className).toMatch(/selected/));
    expect(card.className).toMatch(/selected/);

    // The other way: "Откуда это" flashes the quote.
    fireEvent.click(within(card).getByRole('button', { name: /Откуда это/ }));
    await waitFor(() => expect(quote.className).toMatch(/flash/));
  });

  it('lands on the quote of the object named in the link', async () => {
    const { capture, commitment } = await seedText();
    const { container } = renderEntry(capture.id, `?item=${commitment.id}`);
    const quote = await waitFor(() => {
      const el = container.querySelector(`[data-quote="${commitment.id}"]`) as HTMLElement;
      expect(el.className).toMatch(/selected/);
      return el;
    });
    expect(quote.className).toMatch(/flash/);
  });

  it('accepts and dismisses objects, and accepts all', async () => {
    const { capture, decision, commitment } = await seedText();
    renderEntry(capture.id);
    await screen.findByText('Осенние планы');

    fireEvent.click(screen.getByRole('button', { name: 'Принять: Запустить интенсив' }));
    await waitFor(async () => expect((await itemsRepo.get(decision.id))?.status).toBe('active'));
    fireEvent.click(await screen.findByRole('button', { name: 'Отклонить: Прислать Маше программу' }));
    await waitFor(async () => expect((await itemsRepo.get(commitment.id))?.status).toBe('dismissed'));
    // A rejected object leaves the list for the folded "Отклонённые" group and can be brought back.
    expect(await screen.findByText(/Отклонённые · 1/)).toBeInTheDocument();
    // Nothing is left to review: the capture settles.
    await waitFor(async () => expect((await capturesRepo.get(capture.id))?.status).toBe('done'));
  });

  it('edits the text and keeps the quotes pointing at the right place', async () => {
    const { capture, decision } = await seedText();
    const { container } = renderEntry(capture.id);
    await screen.findByText('Осенние планы');

    fireEvent.click(screen.getByRole('button', { name: 'Править' }));
    const area = screen.getByRole('textbox', { name: 'Текст записи' });
    fireEvent.change(area, { target: { value: 'Вставка в начале. ' + TEXT } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(async () => expect((await capturesRepo.get(capture.id))?.text).toBe('Вставка в начале. ' + TEXT));
    await waitFor(async () => {
      const item = await itemsRepo.get(decision.id);
      expect(item?.quoteStart).toBe(('Вставка в начале. ' + TEXT).indexOf('запустить интенсив в ноябре'));
    });
    await waitFor(() => expect(container.querySelector(`[data-quote="${decision.id}"]`)?.textContent).toBe('запустить интенсив в ноябре'));
  });

  it('renames the record', async () => {
    const { capture } = await seedText();
    renderEntry(capture.id);
    await screen.findByText('Осенние планы');
    fireEvent.click(screen.getByRole('button', { name: 'Изменить название' }));
    const field = screen.getByLabelText('Название записи');
    fireEvent.change(field, { target: { value: 'Новое имя' } });
    fireEvent.submit(field.closest('form')!);
    await waitFor(async () => expect((await capturesRepo.get(capture.id))?.title).toBe('Новое имя'));
  });

  it('deletes with an undo that brings back the record and its pending objects', async () => {
    const { capture, decision } = await seedText();
    renderEntry(capture.id);
    await screen.findByText('Осенние планы');
    fireEvent.click(screen.getByRole('button', { name: 'Удалить запись' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/stream'));
    expect((await capturesRepo.get(capture.id))?.deletedAt).toBeDefined();
    expect((await itemsRepo.get(decision.id))?.status).toBe('dismissed');

    fireEvent.click(await screen.findByRole('button', { name: 'Вернуть' }));
    await waitFor(async () => expect((await capturesRepo.get(capture.id))?.deletedAt).toBeUndefined());
    await waitFor(async () => expect((await itemsRepo.get(decision.id))?.status).toBe('proposed'));
  });

  it('is honest about a recording that has no sound or whose sound is gone', async () => {
    const none = await capturesRepo.create({ kind: 'voice', title: 'Без звука', text: 'Текст есть', durationSec: 42, status: 'done' });
    const view = renderEntry(none.id);
    expect(await screen.findByTestId('no-audio')).toHaveTextContent('У этой записи нет звука');
    view.unmount();

    const missing = await capturesRepo.create({ kind: 'voice', title: 'Звук потерян', text: 'Текст есть', status: 'done', audioId: 'ghost' });
    renderEntry(missing.id);
    expect(await screen.findByTestId('no-audio')).toHaveTextContent('не найден на устройстве');
  });

  it('shows the player with markers placed by the share of the text, and keeps notes at a second', async () => {
    const { capture, decision } = await seedText();
    await capturesRepo.update(capture.id, { kind: 'voice', durationSec: 120 });
    await audioRepo.save(capture.id, new Blob(['fake'], { type: 'audio/wav' }));
    const { container } = renderEntry(capture.id);

    expect(await screen.findByRole('region', { name: 'Плеер записи' })).toBeInTheDocument();
    // The decision's marker sits at (quoteStart / text length) × 120 s.
    const marker = await waitFor(() => {
      const el = container.querySelector('[data-testid="marker-lane"] [data-kind="decision"]') as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    const at = (TEXT.indexOf('запустить интенсив в ноябре') / TEXT.length) * 120;
    expect(marker.getAttribute('aria-label')).toContain(`${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')}`);
    expect(decision.id).toBeTruthy();

    // A note on the current second (0:00 here), saved on the record.
    fireEvent.click(screen.getByRole('button', { name: /Пометка на 0:00/ }));
    fireEvent.change(screen.getByLabelText(/Пометка на 0:00/), { target: { value: 'Проверить цену' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await capturesRepo.get(capture.id))?.marks).toEqual([expect.objectContaining({ at: 0, text: 'Проверить цену' })]));
    expect(await screen.findByText('Проверить цену')).toBeInTheDocument();
  });
});
