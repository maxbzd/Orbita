import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { capturesRepo, peopleRepo, reviewsRepo } from '../../db';
import { wipeAll } from '../../db/maintenance';
import { ThemeProvider } from '../../styles/theme';
import { ToastProvider } from '../../ui';
import { stubCanvas } from '../../ui/testUtils';
import ReviewViewScreen from './ReviewViewScreen';
import ReviewsScreen from './ReviewsScreen';
import ShareScreen from './ShareScreen';

const saveAsImage = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => new Blob()));
vi.mock('../../ui/objects/exportImage', async (original) => ({ ...(await original<object>()), saveAsImage }));
vi.mock('./fontCss', () => ({ exportFontCss: async () => '' }));
const enqueue = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../../state', async (original) => ({ ...(await original<object>()), processing: { enqueue } }));

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function renderAt(path: string) {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/reviews" element={<ReviewsScreen />} />
            <Route path="/reviews/:reviewId" element={<ReviewViewScreen />} />
            <Route path="/share" element={<ShareScreen />} />
            <Route path="*" element={null} />
          </Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </ThemeProvider>,
  );
}

async function makeReview() {
  await peopleRepo.create({ name: 'Светлана', role: 'family' });
  return reviewsRepo.upsert({
    period: 'week',
    startDay: '2026-10-05',
    endDay: '2026-10-11',
    headline: 'Неделя про цену',
    sections: [
      { id: 'stats', title: 'Цифры', kind: 'stats', body: '', data: { captures: 3, activeDays: 2, days: 7, itemsCreatedTotal: 1, done: 0, overdue: 1 } },
      { id: 'overdue', title: 'Что просрочено', kind: 'overdue', body: '• Позвонить Светлане' },
    ],
    questions: ['Что дальше?', 'Что оставить?'],
    generatedBy: 'rules',
  });
}

beforeEach(async () => {
  stubCanvas();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  saveAsImage.mockClear();
  enqueue.mockClear();
  await wipeAll();
});

describe('review story', () => {
  it('shows the slides and keeps the answers in the review and in the stream', async () => {
    const review = await makeReview();
    renderAt(`/reviews/${review.id}`);
    expect(await screen.findByRole('region', { name: /Обзор: Неделя 5–11 октября/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /запис/ })).toBeInTheDocument();

    const field = screen.getByRole('textbox', { name: 'Что дальше?' });
    fireEvent.change(field, { target: { value: 'Поднять цену' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Сохранить ответ' })[0]!);
    await waitFor(async () => expect((await reviewsRepo.get(review.id))?.answers).toHaveLength(1));
    const saved = (await reviewsRepo.get(review.id))!.answers![0]!;
    expect(saved).toMatchObject({ question: 'Что дальше?', answer: 'Поднять цену' });
    const capture = await capturesRepo.get(saved.captureId!);
    expect(capture).toMatchObject({ kind: 'review_answer', text: 'Поднять цену', summary: 'Что дальше?' });

    // The same question edits the same capture instead of adding another.
    fireEvent.change(await screen.findByRole('textbox', { name: 'Что дальше?' }), { target: { value: 'Поднять цену до 1500' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Обновить ответ' }));
    await waitFor(async () => expect((await capturesRepo.get(saved.captureId!))?.text).toBe('Поднять цену до 1500'));
    expect(await capturesRepo.list({})).toHaveLength(1);
    expect((await reviewsRepo.get(review.id))?.answers).toHaveLength(1);
  });

  it('hides names with the switch and offers it before saving a picture that shows one', async () => {
    const review = await makeReview();
    renderAt(`/reviews/${review.id}`);
    const viewer = await screen.findByRole('region', { name: /Обзор:/ });
    fireEvent.click(within(viewer).getByRole('button', { name: 'Вперёд' }));
    await waitFor(() => expect(viewer.querySelector('[data-slide="overdue"]')?.textContent).toContain('Светлан'));

    fireEvent.click(within(viewer).getByRole('button', { name: 'Сохранить картинку' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Скрыть имена перед сохранением?' });
    expect(saveAsImage).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Скрыть имена и сохранить' }));

    await waitFor(() => expect(saveAsImage).toHaveBeenCalledTimes(1));
    expect(viewer.querySelector('[data-slide="overdue"]')?.textContent).not.toContain('Светлан');
    expect(viewer.querySelector('[data-slide="overdue"]')?.textContent).toContain('•••');
    expect(screen.getByRole('switch', { name: /Скрыть имена/ })).toBeChecked();
    expect(saveAsImage.mock.calls[0]?.[1]).toBe(`orbita-week-2026-10-05-2.png`);

    // With the switch on there is nothing to ask: the next export goes straight out.
    fireEvent.click(within(viewer).getByRole('button', { name: 'Сохранить картинку' }));
    await waitFor(() => expect(saveAsImage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('says so when the review does not exist', async () => {
    renderAt('/reviews/nope');
    expect(await screen.findByText('Такого обзора нет')).toBeInTheDocument();
  });
});

describe('reviews list', () => {
  it('offers the weekly reading, builds a review by rules without a key and opens it', async () => {
    renderAt('/reviews');
    expect(await screen.findByRole('heading', { name: 'Обзоры' })).toBeInTheDocument();
    expect(screen.getByText(/Без ИИ-ключа обзор собирается по правилам/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Собрать чтение недели' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/^\/reviews\/.+/), { timeout: 5000 });
    const [review] = await reviewsRepo.list({ period: 'week' });
    expect(review?.generatedBy).toBe('rules');
  });

  it('lists the stored reviews', async () => {
    await makeReview();
    renderAt('/reviews');
    expect(await screen.findByText('Неделя 5–11 октября')).toBeInTheDocument();
    expect(screen.getByText(/Ответов 0 из 2/)).toBeInTheDocument();
  });
});

describe('share target', () => {
  it('shows what arrived, saves nothing until confirmed, then saves it as text and goes to processing', async () => {
    window.history.replaceState(null, '', '/?title=Идея&text=%3Cb%3Eкурс%3C%2Fb%3E&url=javascript%3Aalert(1)');
    renderAt('/share');
    const field = await screen.findByRole('textbox', { name: 'Текст записи' });
    expect((field as HTMLTextAreaElement).value).toContain('<b>курс</b>');
    expect(document.querySelector('b')).toBeNull();
    expect(await capturesRepo.list({})).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и разобрать' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/^\/review\/.+/));
    const [capture] = await capturesRepo.list({});
    expect(capture).toMatchObject({ kind: 'text', title: 'Идея', source: { importedFrom: 'share' } });
    expect(capture?.source?.url).toBeUndefined();
    expect(enqueue).toHaveBeenCalledWith(capture?.id);
    expect(window.location.search).toBe('');
  });

  it('"Не сохранять" creates nothing, and an empty share explains itself', async () => {
    window.history.replaceState(null, '', '/?text=привет');
    const first = renderAt('/share');
    fireEvent.click(await screen.findByRole('button', { name: 'Не сохранять' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/today'));
    expect(await capturesRepo.list({})).toHaveLength(0);
    first.unmount();

    renderAt('/share');
    expect(await screen.findByText(/Сейчас ничего не пришло/)).toBeInTheDocument();
  });
});
