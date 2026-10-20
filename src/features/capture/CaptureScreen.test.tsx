import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturesRepo } from '../../db';
import { wipeAll } from '../../db/maintenance';
import { processing, recorderService } from '../../state';
import { ThemeProvider } from '../../styles/theme';
import { ToastProvider } from '../../ui/primitives';
import { stubCanvas } from '../../ui/testUtils';
import { CaptureScreen } from './CaptureScreen';

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function renderCapture(path = '/capture') {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/capture" element={<CaptureScreen />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </ThemeProvider>,
  );
}

/** The machine in the middle of a recording, without a microphone. */
function recordingState(patch: Partial<ReturnType<typeof recorderService.store.getState>> = {}): void {
  recorderService.store.setState({
    phase: 'recording',
    starting: false,
    captureId: 'cap-1',
    elapsedMs: 134_000,
    dictation: 'listening',
    transcript: { final: 'Решил поднять цену', interim: 'и написать Маше' },
    ...patch,
  });
}

beforeEach(async () => {
  stubCanvas();
  localStorage.clear();
  recorderService.reset();
  processing.store.setState({ jobs: {} });
  await wipeAll();
});
afterEach(() => {
  vi.useRealTimers();
  recorderService.reset();
});

describe('the screen before a recording', () => {
  it('invites to speak, with the orb as a button and the two other ways in reach', () => {
    renderCapture();
    expect(screen.getByRole('heading', { name: 'Запись', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Нажми и говори')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Начать запись' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Записать' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Текст' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('tapping the orb starts the recording inside the tap', () => {
    const start = vi.spyOn(recorderService, 'start').mockResolvedValue(true);
    renderCapture();
    fireEvent.click(screen.getByRole('button', { name: 'Начать запись' }));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('?autostart=1 (the PWA shortcut) starts at once, and only once', () => {
    const start = vi.spyOn(recorderService, 'start').mockResolvedValue(true);
    const { rerender } = renderCapture('/capture?autostart=1');
    expect(start).toHaveBeenCalledTimes(1);
    rerender(<div />);
  });

  it('a refused microphone shows an understandable screen with the way out: type instead', async () => {
    renderCapture('/capture?autostart=1');

    const denied = await screen.findByTestId('mic-denied');
    expect(within(denied).getByRole('heading', { name: 'Микрофон недоступен' })).toBeInTheDocument();
    // jsdom has no microphone at all: the message says what to do about it.
    expect(within(denied).getByRole('alert').textContent).toMatch(/браузер|микрофон/i);

    fireEvent.click(within(denied).getByRole('button', { name: 'Написать текстом' }));
    expect(await screen.findByTestId('text-capture')).toBeInTheDocument();
    expect(screen.queryByTestId('mic-denied')).toBeNull();
  });
});

describe('text mode', () => {
  it('saves typed text at once as a text capture and moves on to the review', async () => {
    renderCapture('/capture?mode=text');

    const field = screen.getByRole('textbox', { name: 'Текст записи' });
    expect(screen.getByRole('button', { name: 'Готово' })).toBeDisabled();
    fireEvent.change(field, { target: { value: 'Надо позвонить маме Саши.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));

    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/^\/review\//));
    const [capture] = await capturesRepo.list({ kind: 'text' });
    expect(capture).toMatchObject({ kind: 'text', text: 'Надо позвонить маме Саши.', status: expect.stringMatching(/transcribed|extracting|failed/) });
    expect(screen.getByTestId('where').textContent).toBe(`/review/${capture!.id}`);
  });

  it('keeps an unsent draft for the next time', () => {
    const first = renderCapture('/capture?mode=text');
    fireEvent.change(screen.getByRole('textbox', { name: 'Текст записи' }), { target: { value: 'Недописанная мысль' } });
    first.unmount();

    renderCapture('/capture?mode=text');
    expect(screen.getByRole('textbox', { name: 'Текст записи' })).toHaveValue('Недописанная мысль');
  });

  it('Ctrl+Enter saves too', async () => {
    renderCapture('/capture?mode=text');
    const field = screen.getByRole('textbox', { name: 'Текст записи' });
    fireEvent.change(field, { target: { value: 'Быстрая мысль' } });
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/^\/review\//));
  });
});

describe('a running recording', () => {
  it('shows the timer, the live words and the three controls, and the navigation stays out', () => {
    recordingState();
    renderCapture();

    expect(screen.getByRole('timer')).toHaveAccessibleName(/2 минуты 14 секунд/);
    expect(screen.getByText('Слушаю')).toBeInTheDocument();
    expect(screen.getByTestId('transcript-final')).toHaveTextContent('Решил поднять цену');
    expect(screen.getByTestId('transcript-interim')).toHaveTextContent('и написать Маше');
    const controls = screen.getByRole('group', { name: 'Управление записью' });
    expect(within(controls).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Текст', 'Готово', 'Пауза']);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('pause and resume go to the service, and the status says so', () => {
    recordingState();
    const pause = vi.spyOn(recorderService, 'pause').mockImplementation(() => recorderService.store.setState({ phase: 'paused' }));
    const resume = vi.spyOn(recorderService, 'resume').mockImplementation(() => recorderService.store.setState({ phase: 'recording' }));
    renderCapture();

    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(pause).toHaveBeenCalled();
    expect(screen.getByText('Пауза', { selector: '[role="status"]' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(resume).toHaveBeenCalled();
  });

  it('«Готово» hands over to the review as soon as the recording is saved', async () => {
    recordingState();
    vi.spyOn(recorderService, 'done').mockImplementation(async () => {
      recorderService.store.setState({ phase: 'processing' });
      return 'cap-1';
    });
    renderCapture();

    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/review/cap-1'));
  });

  it('without a live recogniser the screen stays whole: orb, timer, wave and one honest line', () => {
    recordingState({ dictation: 'unsupported', transcript: { final: '', interim: '' } });
    renderCapture();
    expect(screen.queryByTestId('live-transcript')).toBeNull();
    expect(screen.getByTestId('level-bars')).toBeInTheDocument();
    expect(screen.getByText(/Живой текст здесь недоступен/)).toBeInTheDocument();
  });

  it('CC hides and shows the live words', () => {
    recordingState();
    renderCapture();
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть живой текст' }));
    expect(screen.queryByTestId('live-transcript')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Показать живой текст' }));
    expect(screen.getByTestId('live-transcript')).toBeInTheDocument();
  });

  it('the context chip opens a row of contexts; a choice goes to the recording', () => {
    recordingState();
    const setContext = vi.spyOn(recorderService, 'setContext').mockImplementation((context) => recorderService.store.setState({ context }));
    renderCapture();

    expect(screen.queryByRole('button', { name: 'Прогулка' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Контекст' }));
    const row = screen.getByRole('group', { name: 'Контекст записи' });
    fireEvent.click(within(row).getByRole('button', { name: 'Прогулка' }));
    expect(setContext).toHaveBeenCalledWith('walk');
    expect(within(row).getByRole('button', { name: 'Прогулка', pressed: true })).toBeInTheDocument();
  });

  it('«Текст» pauses the recording and moves the words so far into the field', () => {
    recordingState();
    const pause = vi.spyOn(recorderService, 'pause').mockImplementation(() => recorderService.store.setState({ phase: 'paused' }));
    renderCapture();

    fireEvent.click(screen.getByRole('button', { name: 'Текст' }));

    expect(pause).toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Текст записи' })).toHaveValue('Решил поднять цену и написать Маше');
    expect(screen.getByText(/Запись на паузе/)).toBeInTheDocument();
  });

  it('saving the typed text of a running recording keeps the audio: the service gets the text', async () => {
    recordingState();
    vi.spyOn(recorderService, 'pause').mockImplementation(() => recorderService.store.setState({ phase: 'paused' }));
    const done = vi.spyOn(recorderService, 'done').mockImplementation(async () => {
      recorderService.store.setState({ phase: 'processing' });
      return 'cap-1';
    });
    renderCapture();
    fireEvent.click(screen.getByRole('button', { name: 'Текст' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Текст записи' }), { target: { value: 'Решил поднять цену до 1500.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));

    await waitFor(() => expect(done).toHaveBeenCalledWith({ text: 'Решил поднять цену до 1500.' }));
  });
});

describe('✕', () => {
  it('a long recording is cancelled with a toast «Вернуть» instead of a dialog; «Вернуть» goes to the review', async () => {
    recordingState();
    const undo = vi.fn().mockResolvedValue('cap-1');
    vi.spyOn(recorderService, 'cancel').mockResolvedValue({ kind: 'undoable', captureId: 'cap-1', undo });
    renderCapture();

    fireEvent.click(screen.getByRole('button', { name: 'Отменить запись' }));

    expect(await screen.findByText('Запись отменена.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть' }));
    await waitFor(() => expect(undo).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/review/cap-1'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a short one is dropped without ceremony', async () => {
    recordingState({ elapsedMs: 2_000 });
    vi.spyOn(recorderService, 'cancel').mockResolvedValue({ kind: 'discarded' });
    renderCapture();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить запись' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/today'));
    expect(screen.queryByText('Запись отменена.')).toBeNull();
  });
});

describe('walk mode', () => {
  it('goes dark after 20 seconds without a touch; the first touch only wakes the screen', async () => {
    vi.useFakeTimers();
    recordingState();
    renderCapture();
    const root = screen.getByTestId('capture-screen');
    expect(root).not.toHaveAttribute('data-walk');

    act(() => void vi.advanceTimersByTime(20_000));
    expect(root).toHaveAttribute('data-walk');
    const wake = screen.getByRole('button', { name: /Экран приглушён/ });

    fireEvent.click(wake);
    expect(root).not.toHaveAttribute('data-walk');
    // The touch woke the screen and did nothing else: the recording still runs.
    expect(recorderService.store.getState().phase).toBe('recording');
  });

  it('stays bright while the recording is paused', () => {
    vi.useFakeTimers();
    recordingState({ phase: 'paused' });
    renderCapture();
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByTestId('capture-screen')).not.toHaveAttribute('data-walk');
  });
});

describe('keyboard', () => {
  it('Space pauses, Ctrl+Enter finishes', () => {
    recordingState();
    const pause = vi.spyOn(recorderService, 'pause').mockImplementation(() => undefined);
    const done = vi.spyOn(recorderService, 'done').mockResolvedValue('cap-1');
    renderCapture();

    fireEvent.keyDown(document.body, { key: ' ' });
    expect(pause).toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    expect(done).toHaveBeenCalled();
  });
});
