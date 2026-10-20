import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturesRepo } from '../../../db';
import { wipeAll } from '../../../db/maintenance';
import { createProcessing, processing, recorderService, recoveryService } from '../../../state';
import type { Job, ProcessingDeps } from '../../../state';
import { installPointerEvent } from '../../../state/testing';
import { ThemeProvider } from '../../../styles/theme';
import { ToastProvider } from '../../../ui/primitives';
import { RoutedShell } from '../../../ui/shell';
import { NavPill } from '../../../ui/shell/NavPill';
import { SECTIONS } from '../../../ui/shell/destinations';
import { stubCanvas } from '../../../ui/testUtils';
import { ImportSheet } from './ImportSheet';
import { ProcessingNotifier } from './ProcessingNotifier';
import { QuickThoughtSheet } from './QuickThoughtSheet';
import { RecoveryPrompt } from './RecoveryPrompt';
import { useSphereMenu } from './SphereMenu';
import { useQuickActions } from './quickActions';

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function app(ui: JSX.Element, path = '/today') {
  return (
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          {ui}
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </ThemeProvider>
  );
}

beforeEach(async () => {
  stubCanvas();
  installPointerEvent();
  recorderService.reset();
  useQuickActions.getState().close();
  processing.store.setState({ jobs: {} });
  recoveryService.store.setState({ checked: true, items: [], busy: false, error: null });
  await wipeAll();
});

afterEach(() => vi.useRealTimers());

const items = SECTIONS.map((d) => ({ id: d.id, label: d.label, icon: d.icon, href: `#${d.to}` }));

function SphereHarness() {
  const { gesture, element } = useSphereMenu();
  return (
    <>
      <NavPill items={items} activeId={null} sphereGesture={gesture} />
      {element}
    </>
  );
}

describe('the arc over the sphere', () => {
  const sphere = () => screen.getByRole('button', { name: 'Записать' });

  // A phone: 390 x 844, the sphere at the bottom centre. jsdom measures everything as 0.
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 161, y: 766, left: 161, top: 766, width: 68, height: 68, right: 229, bottom: 834, toJSON: () => ({}) });
  });

  it('hold, slide to «Быстрая мысль» and lift: its sheet opens and no recording starts', async () => {
    vi.useFakeTimers();
    render(app(<SphereHarness />));
    fireEvent.pointerDown(sphere(), { pointerId: 1, clientX: 195, clientY: 800 });
    act(() => void vi.advanceTimersByTime(400));

    const arc = screen.getByTestId('sphere-arc');
    expect(within(arc).getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      'Текст',
      'Состояние',
      'Импорт ИИ-диалога',
      'Быстрая мысль',
    ]);

    // «Быстрая мысль» sits at -30 degrees, 96 px from the sphere: right and up.
    const x = 195 + Math.cos((-30 * Math.PI) / 180) * 96;
    const y = 800 + Math.sin((-30 * Math.PI) / 180) * 96;
    fireEvent.pointerMove(sphere(), { pointerId: 1, clientX: x, clientY: y });
    expect(within(arc).getByRole('menuitem', { name: 'Быстрая мысль' })).toHaveAttribute('data-hot');
    fireEvent.pointerUp(sphere(), { pointerId: 1, clientX: x, clientY: y });

    expect(screen.queryByTestId('sphere-arc')).toBeNull();
    expect(useQuickActions.getState().sheet).toBe('quick');
    vi.useRealTimers();
  });

  it('lifting over nothing leaves the arc open for a tap; «Текст» goes to the text mode', () => {
    vi.useFakeTimers();
    render(app(<SphereHarness />));
    fireEvent.pointerDown(sphere(), { pointerId: 1, clientX: 195, clientY: 800 });
    act(() => void vi.advanceTimersByTime(400));
    fireEvent.pointerUp(sphere(), { pointerId: 1, clientX: 195, clientY: 800 });

    const arc = screen.getByTestId('sphere-arc');
    expect(arc).toHaveAttribute('data-mode', 'tap');
    fireEvent.click(within(arc).getByRole('menuitem', { name: 'Текст' }));

    expect(screen.queryByTestId('sphere-arc')).toBeNull();
    expect(screen.getByTestId('where')).toHaveTextContent('/capture?mode=text');
    vi.useRealTimers();
  });

  it('Esc closes the arc', () => {
    vi.useFakeTimers();
    render(app(<SphereHarness />));
    fireEvent.pointerDown(sphere(), { pointerId: 1, clientX: 195, clientY: 800 });
    act(() => void vi.advanceTimersByTime(400));
    fireEvent.pointerUp(sphere(), { pointerId: 1, clientX: 195, clientY: 800 });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('sphere-arc')).toBeNull();
    vi.useRealTimers();
  });

  it('the keyboard gets the same four actions as a sheet', async () => {
    render(app(<SphereHarness />));
    fireEvent.keyDown(sphere(), { key: 'ArrowUp' });

    const sheet = await screen.findByRole('dialog', { name: 'Быстрые действия' });
    for (const name of ['Текст', 'Состояние', 'Импорт ИИ-диалога', 'Быстрая мысль']) {
      expect(within(sheet).getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
    }

    fireEvent.click(within(sheet).getByRole('button', { name: /Состояние/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/checkin');
  });
});

describe('«Быстрая мысль»', () => {
  it('saves the line at once as a text capture and says so', async () => {
    useQuickActions.getState().open('quick');
    render(app(<QuickThoughtSheet />));

    const field = await screen.findByRole('textbox', { name: 'Текст мысли' });
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    fireEvent.change(field, { target: { value: 'Проверить рассылку' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Записано. Разберу в фоне.')).toBeInTheDocument();
    const [capture] = await capturesRepo.list({ kind: 'text' });
    expect(capture).toMatchObject({ text: 'Проверить рассылку' });
    expect(useQuickActions.getState().sheet).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(screen.getByTestId('where')).toHaveTextContent(`/review/${capture!.id}`);
  });
});

describe('«Импорт ИИ-диалога»', () => {
  it('a pasted chat becomes one capture of kind ai_chat and opens its review', async () => {
    useQuickActions.getState().open('import');
    render(app(<ImportSheet />));

    fireEvent.change(await screen.findByRole('textbox', { name: 'Текст переписки' }), {
      target: { value: 'Я: Стоит ли поднимать цену?\nChatGPT: Проверь конверсию.\nЯ: Решил поднять до 1500.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать и разобрать' }));

    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/^\/review\//));
    const [capture] = await capturesRepo.list({ kind: 'ai_chat' });
    expect(capture?.source).toMatchObject({ importedFrom: 'paste' });
    expect(capture?.text).toContain('Решил поднять до 1500.');
    expect(useQuickActions.getState().sheet).toBeNull();
  });

  it('an empty paste cannot be sent, and a repeat of the same dialog is refused with a reason', async () => {
    useQuickActions.getState().open('import');
    render(app(<ImportSheet />));
    expect(await screen.findByRole('button', { name: 'Импортировать и разобрать' })).toBeDisabled();
  });

  it('a conversations.json from an export: pick which dialogs to bring in', async () => {
    useQuickActions.getState().open('import');
    render(app(<ImportSheet />));
    fireEvent.click(await screen.findByRole('radio', { name: 'Файл' }));

    const conversation = (id: string, name: string) => ({
      uuid: id + '-aaaa-bbbb',
      name,
      created_at: '2026-09-12T10:00:00.000000Z',
      chat_messages: [
        { uuid: 'm1', sender: 'human', text: 'Как поднять цену?', content: [], created_at: '2026-09-12T10:00:00.000000Z' },
        { uuid: 'm2', sender: 'assistant', text: 'Проверь конверсию.', content: [], created_at: '2026-09-12T10:01:00.000000Z' },
      ],
    });
    const file = new File([JSON.stringify([conversation('c1', 'Цена'), conversation('c2', 'Набор')])], 'conversations.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(JSON.stringify([conversation('c1', 'Цена'), conversation('c2', 'Набор')])) });
    fireEvent.change(screen.getByLabelText('Файл conversations.json'), { target: { files: [file] } });

    expect(await screen.findByText('Цена')).toBeInTheDocument();
    expect(screen.getByText('Набор')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Импортировать (2)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Набор/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать (1)' }));

    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/^\/review\//));
    expect(await capturesRepo.list({ kind: 'ai_chat' })).toHaveLength(1);
  });

  it('a file that is not an export says what is needed', async () => {
    useQuickActions.getState().open('import');
    render(app(<ImportSheet />));
    fireEvent.click(await screen.findByRole('radio', { name: 'Файл' }));
    const file = new File(['not json'], 'x.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve('not json') });
    fireEvent.change(screen.getByLabelText('Файл conversations.json'), { target: { files: [file] } });
    expect(await screen.findByText(/не похож на JSON/)).toBeInTheDocument();
  });
});

describe('recovery of a lost recording', () => {
  const lost = { captureId: 'lost-1', chunkCount: 3, sizeBytes: 3000, mime: 'audio/webm', lastChunkAt: '2026-10-08T10:00:00.000Z', durationSec: 187 };

  it('offers «Восстановить» for a recording the browser lost, and restores it on request', async () => {
    recoveryService.store.setState({ items: [lost as never] });
    const restore = vi.spyOn(recoveryService, 'restore').mockResolvedValue('lost-1');
    render(app(<RecoveryPrompt />));

    const dialog = await screen.findByRole('alertdialog', { name: 'Найдена незавершённая запись' });
    expect(within(dialog).getByText(/3:07/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Восстановить' }));

    await waitFor(() => expect(restore).toHaveBeenCalledWith('lost-1'));
    expect(await screen.findByText('Запись восстановлена. Разбираю.')).toBeInTheDocument();
  });

  it('«Не сейчас» hides it and keeps the pieces', async () => {
    recoveryService.store.setState({ items: [lost as never] });
    const discard = vi.spyOn(recoveryService, 'discard');
    render(app(<RecoveryPrompt />));
    fireEvent.click(await screen.findByRole('button', { name: 'Не сейчас' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(discard).not.toHaveBeenCalled();
  });

  it('does not interrupt a recording that is running now', () => {
    recoveryService.store.setState({ items: [lost as never] });
    recorderService.store.setState({ phase: 'recording' });
    render(app(<RecoveryPrompt />));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('news from the background', () => {
  function service() {
    const deps: ProcessingDeps = {
      getSettings: async () => (await import('../../../db')).settingsRepo.getSettings(),
      hasAudio: async () => false,
      textOf: async () => 'текст',
      createLlm: () => ({}) as never,
      createStt: () => ({}) as never,
      canTranscribe: () => true,
      readiness: () => ({ ready: true }),
      run: async () => ({ outcome: 'review', items: [{ status: 'proposed' }, { status: 'proposed' }, { status: 'active' }], autoAccepted: 1 }) as never,
      now: () => 0,
    };
    return createProcessing(deps);
  }

  it('tells how many objects wait, with a way to the review', async () => {
    const jobs = service();
    render(app(<ProcessingNotifier service={jobs} />));
    await act(async () => void (await jobs.enqueue('cap-9')));

    expect(await screen.findByText('Нашёл 2 объекта.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Разобрать' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/review/cap-9');
  });

  it('stays quiet while the user looks at that very review', async () => {
    const jobs = service();
    render(app(<ProcessingNotifier service={jobs} />, '/review/cap-9'));
    await act(async () => void (await jobs.enqueue('cap-9')));
    expect(screen.queryByText(/Нашёл/)).toBeNull();
  });

  it('a waiting capture is not a failure: it says why it waits', async () => {
    const jobs = createProcessing({
      getSettings: async () => (await import('../../../db')).settingsRepo.getSettings(),
      hasAudio: async () => false,
      textOf: async () => 'текст',
      createLlm: () => ({}) as never,
      createStt: () => ({}) as never,
      canTranscribe: () => true,
      readiness: () => ({ ready: false, reason: 'Не задан ключ' }),
      run: async () => ({}) as never,
      now: () => 0,
    });
    render(app(<ProcessingNotifier service={jobs} />));
    await act(async () => void (await jobs.enqueue('cap-9')));
    expect(await screen.findByText('Запись сохранена и ждёт обработки: не задан ключ ИИ.')).toBeInTheDocument();
  });
});

describe('the shell around a recording', () => {
  it('shows the mini recorder on other screens while a recording runs, and the sphere listens', async () => {
    recorderService.store.setState({ phase: 'recording', captureId: 'cap-1', elapsedMs: 134_000 });
    render(
      app(
        <Routes>
          <Route element={<RoutedShell />}>
            <Route path="/today" element={<p data-testid="page">Страница</p>} />
          </Route>
        </Routes>,
      ),
    );

    const mini = await screen.findByTestId('mini-recorder');
    expect(within(mini).getByRole('button', { name: /Вернуться к записи, 2 минуты 14 секунд/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Записать' }).querySelector('[data-recording]')).not.toBeNull();

    const pause = vi.spyOn(recorderService, 'pause').mockImplementation(() => undefined);
    fireEvent.click(within(mini).getByRole('button', { name: 'Пауза' }));
    expect(pause).toHaveBeenCalled();

    fireEvent.click(within(mini).getByRole('button', { name: /Вернуться к записи/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/capture');
  });

  it('the mini recorder ✓ saves at once and says so, without leaving the screen', async () => {
    recorderService.store.setState({ phase: 'recording', captureId: 'cap-1', elapsedMs: 9_000 });
    const done = vi.spyOn(recorderService, 'done').mockResolvedValue('cap-1');
    render(
      app(
        <Routes>
          <Route element={<RoutedShell />}>
            <Route path="/today" element={<p data-testid="page">Страница</p>} />
          </Route>
        </Routes>,
      ),
    );

    fireEvent.click(within(await screen.findByTestId('mini-recorder')).getByRole('button', { name: 'Готово' }));

    expect(done).toHaveBeenCalled();
    expect(await screen.findByText('Записано. Разбираю.')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/today');
  });

  it('no mini recorder when nothing records', async () => {
    render(
      app(
        <Routes>
          <Route element={<RoutedShell />}>
            <Route path="/today" element={<p data-testid="page">Страница</p>} />
          </Route>
        </Routes>,
      ),
    );
    await screen.findByTestId('page');
    expect(screen.queryByTestId('mini-recorder')).toBeNull();
  });

  it('the sphere starts the recording inside the tap and opens the recording screen', async () => {
    const start = vi.spyOn(recorderService, 'start').mockResolvedValue(true);
    render(
      app(
        <Routes>
          <Route element={<RoutedShell />}>
            <Route path="/today" element={<p data-testid="page">Страница</p>} />
          </Route>
        </Routes>,
      ),
    );
    await screen.findByTestId('page');
    fireEvent.click(screen.getByRole('button', { name: 'Записать' }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('where')).toHaveTextContent('/capture');
  });
});

export type { Job };
