import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { capturesRepo, itemsRepo, peopleRepo, settingsRepo } from '../../db';
import { wipeAll } from '../../db/maintenance';
import type { Capture, ID, Item } from '../../domain/types';
import { processing } from '../../state';
import { installPointerEvent } from '../../state/testing';
import { ThemeProvider } from '../../styles/theme';
import { ToastProvider } from '../../ui/primitives';
import { stubCanvas } from '../../ui/testUtils';
import { ReviewScreen } from './ReviewScreen';

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderReview(captureId: ID) {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/review/${captureId}`]}>
          <Routes>
            <Route path="/review/:captureId" element={<ReviewScreen />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </ThemeProvider>,
  );
}

beforeEach(async () => {
  // Springs and fly-outs finish at once; the thresholds are what these tests are about.
  MotionGlobalConfig.skipAnimations = true;
  stubCanvas();
  installPointerEvent();
  localStorage.clear();
  processing.store.setState({ jobs: {} });
  await wipeAll();
});

async function inReview(): Promise<{ capture: Capture; items: Item[] }> {
  const capture = await capturesRepo.create({ kind: 'voice', title: 'Цена на тестовый урок', text: 'Решил поднять цену до 1500. Пообещал Фёдору прислать план. Сказал, что подумаю про курс.', status: 'review' });
  // The pipeline spreads the objects over consecutive milliseconds to keep the extraction order; so does the test.
  const at = (offset: number): string => new Date(Date.now() + offset).toISOString();
  const items = [
    await itemsRepo.create({ createdAt: at(0), kind: 'decision', title: 'Поднять цену до 1500 ₽', chosen: 'Поднять цену', status: 'proposed', captureId: capture.id, confidence: 0.9, quote: 'Решил поднять цену до 1500' } as itemsRepo.NewItem),
    await itemsRepo.create({ createdAt: at(1), kind: 'commitment', title: 'Прислать план Фёдору', direction: 'i_owe', counterpartyName: 'Фёдор', status: 'proposed', captureId: capture.id, confidence: 0.8 } as itemsRepo.NewItem),
    await itemsRepo.create({ createdAt: at(2), kind: 'idea', title: 'Сделать мини-курс', status: 'proposed', captureId: capture.id, confidence: 0.6 } as itemsRepo.NewItem),
  ];
  return { capture, items };
}

describe('the quick path', () => {
  it('«Нашёл N объектов»: rows by type, the cream button counts what it will accept', async () => {
    const { capture } = await inReview();
    renderReview(capture.id);

    const sheet = await screen.findByRole('dialog', { name: 'Нашёл 3 объекта' });
    expect(within(sheet).getByRole('region', { name: 'Решения' })).toBeInTheDocument();
    expect(within(sheet).getByText('Поднять цену до 1500 ₽')).toBeInTheDocument();
    expect(within(sheet).getByText('Кому: Фёдор')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Принять всё (3)' })).toBeInTheDocument();
    expect(within(sheet).getByText('ИИ может ошибаться. Проверь.')).toBeInTheDocument();
  });

  it('«Принять всё» activates the objects, settles the capture, and shows what went to memory with an «Отменить»', async () => {
    const { capture, items } = await inReview();
    renderReview(capture.id);

    fireEvent.click(await screen.findByRole('button', { name: 'Принять всё (3)' }));

    expect(await screen.findByTestId('review-done')).toBeInTheDocument();
    for (const item of items) expect((await itemsRepo.get(item.id))?.status).toBe('active');
    expect((await capturesRepo.get(capture.id))?.status).toBe('done');
    expect(screen.getAllByText('обязательство перед Фёдором').length).toBeGreaterThan(0);
    expect(screen.getByText('Добавлено в память: 3')).toBeInTheDocument();

    // «Отменить» (5 s): the three wait for review again and the screen goes back to the list.
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(async () => expect((await itemsRepo.get(items[0]!.id))?.status).toBe('proposed'));
    expect(await screen.findByRole('dialog', { name: 'Нашёл 3 объекта' })).toBeInTheDocument();
    expect((await capturesRepo.get(capture.id))?.status).toBe('review');
  });

  it('✓ and ✕ on a row decide that object only', async () => {
    const { capture, items } = await inReview();
    renderReview(capture.id);
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Принять: Поднять цену до 1500 ₽' }));
    await waitFor(async () => expect((await itemsRepo.get(items[0]!.id))?.status).toBe('active'));
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить: Сделать мини-курс' }));
    await waitFor(async () => expect((await itemsRepo.get(items[2]!.id))?.status).toBe('dismissed'));

    expect((await itemsRepo.get(items[1]!.id))?.status).toBe('proposed');
    expect(await screen.findByRole('button', { name: 'Принять всё (1)' })).toBeInTheDocument();
  });

  it('a suspected duplicate is marked and left out of «Принять всё»', async () => {
    const { capture } = await inReview();
    const earlier = await itemsRepo.create({ kind: 'task', title: 'Позвонить Маше', status: 'active' });
    await itemsRepo.create({ kind: 'task', title: 'Позвонить Маше завтра', status: 'proposed', captureId: capture.id, duplicateOf: earlier.id });
    renderReview(capture.id);

    expect(await screen.findByText(/Похоже на уже сохранённое/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Принять всё (3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Всё равно сохранить: Позвонить Маше завтра' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Принять всё (3)' }));
    expect(await screen.findByRole('button', { name: 'Нечего принимать сразу' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Всё равно сохранить: Позвонить Маше завтра' })).toBeInTheDocument();
  });

  it('the auto-accept switch is saved in the settings at 80 %', async () => {
    const { capture } = await inReview();
    renderReview(capture.id);

    fireEvent.click(await screen.findByRole('switch', { name: /Всегда принимать, если уверенность ≥ 80 %/ }));

    await waitFor(async () => expect((await settingsRepo.getSettings()).autoAccept).toEqual({ enabled: true, minConfidence: 0.8 }));
  });

  it('shows the model\'s question with chips and answers it by linking the person', async () => {
    const { capture } = await inReview();
    const artem = await peopleRepo.create({ name: 'Фёдор' });
    processing.store.setState({
      jobs: { [capture.id]: { captureId: capture.id, stage: 'done', mode: 'auto', startedAt: 0, result: { outcome: 'review', questionsForUser: ['Кому ты это обещал?'], newPeople: [], newProjects: [], mergeHints: [], ambiguous: [], items: [], autoAccepted: 0 } as never } },
    });
    renderReview(capture.id);

    const question = await screen.findByRole('group', { name: 'Вопрос от ИИ' });
    expect(within(question).getByText('Кому ты это обещал?')).toBeInTheDocument();
    fireEvent.click(await within(question).findByRole('button', { name: 'Фёдор' }));

    await waitFor(() => expect(screen.queryByRole('group', { name: 'Вопрос от ИИ' })).toBeNull());
    expect((await capturesRepo.get(capture.id))?.personIds).toEqual([artem.id]);
  });
});

describe('one by one', () => {
  const openStack = async (captureId: ID) => {
    renderReview(captureId);
    fireEvent.click(await screen.findByRole('button', { name: 'По одному' }));
    return screen.findByTestId('top-card');
  };

  it('opens on the first object with story segments and the one-time hint', async () => {
    const { capture } = await inReview();
    const card = await openStack(capture.id);

    expect(within(card).getByText('Поднять цену до 1500 ₽')).toBeInTheDocument();
    expect(screen.getByText('1 из 3')).toBeInTheDocument();
    expect(screen.getByText('Свайп вправо, чтобы сохранить')).toBeInTheDocument();
  });

  it('a tapped row opens the stack on that object', async () => {
    const { capture } = await inReview();
    renderReview(capture.id);
    fireEvent.click(await screen.findByText('Сделать мини-курс'));
    const card = await screen.findByTestId('top-card');
    expect(within(card).getByText('Сделать мини-курс')).toBeInTheDocument();
  });

  it('the keyboard decides: → accepts, ← dismisses, and the toast offers «Отменить»', async () => {
    const { capture, items } = await inReview();
    const card = await openStack(capture.id);

    fireEvent.keyDown(card, { key: 'ArrowRight' });
    await waitFor(async () => expect((await itemsRepo.get(items[0]!.id))?.status).toBe('active'));
    expect(await screen.findByText(/Добавлено в память: решение: Поднять цену/)).toBeInTheDocument();

    // The next card takes the place of the one that left.
    await waitFor(() => expect(within(screen.getByTestId('top-card')).getByText('Прислать план Фёдору')).toBeInTheDocument());
    fireEvent.keyDown(screen.getByTestId('top-card'), { key: 'ArrowLeft' });
    await waitFor(async () => expect((await itemsRepo.get(items[1]!.id))?.status).toBe('dismissed'));
    expect(await screen.findByText('Отклонено.')).toBeInTheDocument();

    // Undo brings the dismissed commitment back as the top card.
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(async () => expect((await itemsRepo.get(items[1]!.id))?.status).toBe('proposed'));
    expect(within(await screen.findByTestId('top-card')).getByText('Прислать план Фёдору')).toBeInTheDocument();
  });

  it('a swipe past 96 px accepts; a short drag springs back', async () => {
    const { capture, items } = await inReview();
    const card = await openStack(capture.id);

    // A slow drag: the finger rests 150 ms before it moves, so there is no flick to count.
    const drag = async (dx: number) => {
      fireEvent.pointerDown(card, { pointerId: 1, clientX: 200, clientY: 300 });
      await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 150))));
      fireEvent.pointerMove(card, { pointerId: 1, clientX: 200 + dx, clientY: 300 });
      await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 150))));
      fireEvent.pointerUp(card, { pointerId: 1, clientX: 200 + dx, clientY: 300 });
    };

    await drag(40);
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 400))));
    expect((await itemsRepo.get(items[0]!.id))?.status).toBe('proposed');

    await drag(140);
    await waitFor(async () => expect((await itemsRepo.get(items[0]!.id))?.status).toBe('active'), { timeout: 3000 });
  });

  it('a gesture that starts at the screen edge is left to the system', async () => {
    const { capture, items } = await inReview();
    const card = await openStack(capture.id);
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 8, clientY: 300 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 208, clientY: 300 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 208, clientY: 300 });
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 400))));
    expect((await itemsRepo.get(items[0]!.id))?.status).toBe('proposed');
  });

  it('«Откуда это» shows the quote and a way to the record', async () => {
    const { capture } = await inReview();
    const card = await openStack(capture.id);
    fireEvent.click(within(card).getByRole('button', { name: 'Откуда это' }));
    expect(within(card).getByText('«Решил поднять цену до 1500»')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'К записи' })).toHaveAttribute('href', expect.stringContaining(`/entry/${capture.id}`));
  });

  it('the edit button opens the wording; saving accepts the edited object', async () => {
    const { capture, items } = await inReview();
    await openStack(capture.id);

    fireEvent.click(screen.getByRole('button', { name: 'Править' }));
    const field = await screen.findByLabelText('Суть');
    fireEvent.change(field, { target: { value: 'Поднять цену до 1700 ₽' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и принять' }));

    await waitFor(async () => expect(await itemsRepo.get(items[0]!.id)).toMatchObject({ status: 'active', title: 'Поднять цену до 1700 ₽' }));
  });

  it('the hint is shown once', async () => {
    const { capture } = await inReview();
    const card = await openStack(capture.id);
    fireEvent.keyDown(card, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.queryByText('Свайп вправо, чтобы сохранить')).toBeNull());
    expect(localStorage.getItem('orbit.review.coach')).toBe('1');
  });
});

describe('the other states of a capture', () => {
  it('a missing capture says so', async () => {
    renderReview('nope');
    expect(await screen.findByText('Такой записи нет.')).toBeInTheDocument();
  });

  it('without a key the capture waits, and the clipboard mode is one tap away', async () => {
    const capture = await capturesRepo.create({ kind: 'text', text: 'Решил поднять цену', status: 'transcribed' });
    processing.store.setState({
      jobs: { [capture.id]: { captureId: capture.id, stage: 'waiting', waiting: 'no-key', message: 'Не задан ключ Anthropic.', mode: 'auto', startedAt: 0 } },
    });
    renderReview(capture.id);

    expect(await screen.findByTestId('review-waiting')).toHaveAttribute('data-reason', 'no-key');
    expect(screen.getByText('Не задан ключ Anthropic.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Через буфер обмена' })).toBeInTheDocument();
    expect(screen.getByText('Решил поднять цену')).toBeInTheDocument();
  });

  it('a recording with no text asks for the text, saves it and starts processing', async () => {
    const capture = await capturesRepo.create({ kind: 'voice', text: '', status: 'raw' });
    processing.store.setState({
      jobs: { [capture.id]: { captureId: capture.id, stage: 'waiting', waiting: 'no-transcript', message: 'Слов пока нет.', mode: 'auto', startedAt: 0 } },
    });
    renderReview(capture.id);

    fireEvent.change(await screen.findByLabelText('Что было в записи'), { target: { value: 'Говорил про цену на тестовый урок' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и разобрать' }));

    await waitFor(async () => expect(await capturesRepo.get(capture.id)).toMatchObject({ text: 'Говорил про цену на тестовый урок', status: expect.stringMatching(/transcribed|extracting|failed|review|done/) }));
  });

  it('a failure keeps the record and offers «Повторить»', async () => {
    const capture = await capturesRepo.create({ kind: 'text', text: 'Текст', status: 'failed' });
    processing.store.setState({
      jobs: { [capture.id]: { captureId: capture.id, stage: 'failed', message: 'Провайдер не принял ключ API.', mode: 'auto', startedAt: 0 } },
    });
    renderReview(capture.id);

    const failed = await screen.findByTestId('review-failed');
    expect(within(failed).getByRole('alert')).toHaveTextContent('Провайдер не принял ключ API.');
    expect(within(failed).getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('processing shows only the steps that exist for the capture and tells that leaving is fine', async () => {
    const capture = await capturesRepo.create({ kind: 'text', text: 'Текст', status: 'extracting' });
    processing.store.setState({ jobs: { [capture.id]: { captureId: capture.id, stage: 'running', mode: 'auto', startedAt: Date.now() } } });
    renderReview(capture.id);

    const view = await screen.findByTestId('review-processing');
    expect(within(view).getByRole('list', { name: 'Шаги обработки' }).textContent).toBe('Запись сохраненаСтруктурирую');
    expect(within(view).getByText(/Можно уйти/)).toBeInTheDocument();
  });

  it('when all is decided the screen shows what is in memory and leads on', async () => {
    const capture = await capturesRepo.create({ kind: 'text', text: 'Текст', status: 'done', title: 'Разговор с Фёдором' });
    await itemsRepo.create({ kind: 'idea', title: 'Мини-курс', status: 'active', captureId: capture.id });
    await itemsRepo.create({ kind: 'task', title: 'Лишнее', status: 'dismissed', captureId: capture.id });
    renderReview(capture.id);

    const done = await screen.findByTestId('review-done');
    expect(within(done).getByText('В память добавлено: 1, отклонено: 1.')).toBeInTheDocument();
    fireEvent.click(within(done).getByRole('button', { name: 'Открыть запись' }));
    expect(await screen.findByTestId('where')).toHaveTextContent(`/entry/${capture.id}`);
  });
});
