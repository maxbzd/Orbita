import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturesRepo, getSettings, profileRepo } from '../../db';
import { hasDemoData, wipeAll } from '../../db/maintenance';
import { ThemeProvider } from '../../styles/theme';
import { useCloud } from '../../sync';
import { ToastProvider } from '../../ui';
import { stubCanvas } from '../../ui/testUtils';
import OnboardingScreen from './OnboardingScreen';
import { trainerPhrase } from './logic';

const { enqueue, testConnection } = vi.hoisted(() => ({
  enqueue: vi.fn(),
  testConnection: vi.fn(),
}));

vi.mock('../../state/processing', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../state/processing')>();
  return { ...original, processing: { ...original.processing, enqueue } };
});
vi.mock('../../ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ai')>()),
  createLlmProvider: vi.fn(() => ({ id: 'mock', test: testConnection })),
}));

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function renderOnboarding() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={['/onboarding']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <OnboardingScreen />
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </ThemeProvider>,
  );
}

/** Walks to a screen by the visible buttons, like a user. */
async function toDialogue() {
  fireEvent.click(await screen.findByRole('button', { name: 'Начать' }));
  return screen.findByLabelText('Имя');
}

async function toAi() {
  fireEvent.change(await toDialogue(), { target: { value: '  Фёдор ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Работа' }));
  fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
  return screen.findByRole('heading', { name: 'Подключим ИИ' });
}

function withMicrophone(): void {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } });
}

beforeEach(async () => {
  stubCanvas();
  enqueue.mockReset();
  testConnection.mockReset();
  await wipeAll();
});
afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('onboarding', () => {
  it('opens with the promise and says what the app does not do', async () => {
    renderOnboarding();
    expect(await screen.findByRole('heading', { name: 'Говори. Я разложу.' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Чего я не делаю' }));
    const dialog = await screen.findByRole('dialog', { name: 'Чего я не делаю' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(4);
    expect(within(dialog).getByText('Не отправляю ничего без твоего действия')).toBeInTheDocument();
    expect((await getSettings()).onboarding.done).toBe(false);
  });

  it('saves the name and what the user does into the profile', async () => {
    renderOnboarding();
    await toAi();
    const profile = await profileRepo.get();
    expect(profile.name).toBe('Фёдор');
    expect(profile.about).toBe('Работа');
  });

  it('saves what the user typed under "Другое"', async () => {
    renderOnboarding();
    fireEvent.change(await toDialogue(), { target: { value: 'Аня' } });
    fireEvent.click(screen.getByRole('button', { name: 'Другое' }));
    fireEvent.change(screen.getByLabelText('Чем именно'), { target: { value: 'Готовлю к OKR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    await screen.findByRole('heading', { name: 'Подключим ИИ' });
    expect((await profileRepo.get()).about).toBe('Готовлю к OKR');
  });

  it('checks the connection with the entered key and then stores provider and key', async () => {
    testConnection.mockResolvedValueOnce({ ok: true, message: 'Соединение работает.' });
    renderOnboarding();
    await toAi();
    expect(screen.getByRole('button', { name: 'Сохранить и дальше' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Ключ API'), { target: { value: ' sk-ant-test ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить соединение' }));
    expect(await screen.findByText('Соединение работает.')).toBeInTheDocument();
    // Testing does not store anything.
    expect((await getSettings()).ai.anthropic.apiKey).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и дальше' }));
    await screen.findByRole('heading', { name: /Попробуем/ });
    const settings = await getSettings();
    expect(settings.ai.provider).toBe('anthropic');
    expect(settings.ai.anthropic.apiKey).toBe('sk-ant-test');
  });

  it('shows why the connection failed and keeps the key unsaved', async () => {
    testConnection.mockResolvedValueOnce({ ok: false, message: 'Ключ не подошёл.' });
    renderOnboarding();
    await toAi();
    fireEvent.change(screen.getByLabelText('Ключ API'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить соединение' }));
    expect(await screen.findByText('Ключ не подошёл.')).toBeInTheDocument();
    expect((await getSettings()).ai.anthropic.apiKey).toBe('');
  });

  it('goes on "Пока без ИИ" without touching the AI settings', async () => {
    renderOnboarding();
    await toAi();
    fireEvent.click(screen.getByRole('button', { name: 'Пока без ИИ' }));
    await screen.findByRole('heading', { name: /Попробуем/ });
    expect((await getSettings()).ai.anthropic.apiKey).toBe('');
  });

  it('asks the browser for the microphone only when the user presses the button', async () => {
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    renderOnboarding();
    await toAi();
    expect(getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Разрешить микрофон' }));
    expect(await screen.findByText('Микрофон разрешён.')).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('finishes with "Пропустить": the flag is stored and the home screen opens', async () => {
    withMicrophone();
    renderOnboarding();
    await toAi();
    fireEvent.click(screen.getByRole('button', { name: 'Пока без ИИ' }));
    await screen.findByRole('heading', { name: /Попробуем/ });
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/today'));
    const { onboarding } = await getSettings();
    expect(onboarding.done).toBe(true);
    expect(onboarding.completedAt).toBeTruthy();
  });

  it('leads the first recording to the recording screen with the prompt', async () => {
    withMicrophone();
    renderOnboarding();
    await toAi();
    fireEvent.click(screen.getByRole('button', { name: 'Пока без ИИ' }));
    expect(await screen.findByText(`«${trainerPhrase()}»`)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Записать голосом' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('/capture?hint='));
    expect(decodeURIComponent(screen.getByTestId('where').textContent ?? '')).toContain(trainerPhrase());
    // Leaving for the recording ends the onboarding: coming back must not bounce to it again.
    expect((await getSettings()).onboarding.done).toBe(true);
  });

  it('falls back to typing when the device cannot record, and processes that text', async () => {
    renderOnboarding();
    await toAi();
    fireEvent.click(screen.getByRole('button', { name: 'Пока без ИИ' }));
    const area = await screen.findByLabelText('Напиши вместо этого');
    expect(screen.queryByRole('button', { name: 'Записать голосом' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Сохранить запись' })).toBeDisabled();
    fireEvent.change(area, { target: { value: 'Решил запустить интенсив в ноябре, потому что есть спрос' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить запись' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/^\/review\/.+/));
    const [capture] = await capturesRepo.list();
    expect(capture).toMatchObject({ kind: 'text', text: 'Решил запустить интенсив в ноябре, потому что есть спрос' });
    expect(enqueue).toHaveBeenCalledWith(capture?.id);
    expect((await getSettings()).onboarding.done).toBe(true);
  });

  it('loads the demo data on request', async () => {
    renderOnboarding();
    await toAi();
    fireEvent.click(screen.getByRole('button', { name: 'Пока без ИИ' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Загрузить демо-данные' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/today'), { timeout: 10_000 });
    expect(await hasDemoData()).toBe(true);
    expect((await getSettings()).onboarding.done).toBe(true);
    // The name typed in the dialogue is not overwritten by the demo profile.
    expect((await profileRepo.get()).name).toBe('Фёдор');
  }, 20_000);
});

describe('signing in to the cloud from the first screen', () => {
  const signedIn = (applied: number) =>
    useCloud.setState({
      status: 'idle',
      email: 'max@example.com',
      userId: 'u1',
      lastSyncAt: Date.now(),
      lastReport: { pushed: 0, pulled: applied, applied, rejected: 0, audioUp: 0, audioDown: 0 },
      error: null,
      needsNewPassword: false,
    });

  beforeEach(async () => {
    await wipeAll();
    useCloud.setState({ status: 'signed-out', email: null, userId: null, lastSyncAt: null, lastReport: null, error: null, needsNewPassword: false });
  });

  it('offers the sign-in form without leaving the introduction', async () => {
    renderOnboarding();
    fireEvent.click(await screen.findByRole('button', { name: 'У меня уже есть аккаунт' }));
    expect(await screen.findByLabelText('Почта')).toBeInTheDocument();
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
  });

  it('data that came down from the cloud ends the introduction and opens the day', async () => {
    renderOnboarding();
    fireEvent.click(await screen.findByRole('button', { name: 'У меня уже есть аккаунт' }));
    await screen.findByLabelText('Почта');
    signedIn(5);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/today'));
    expect((await getSettings()).onboarding.done).toBe(true);
  });

  it('an empty cloud lets the introduction go on', async () => {
    renderOnboarding();
    fireEvent.click(await screen.findByRole('button', { name: 'У меня уже есть аккаунт' }));
    await screen.findByLabelText('Почта');
    signedIn(0);
    expect(await screen.findByLabelText('Имя')).toBeInTheDocument();
    expect((await getSettings()).onboarding.done).toBe(false);
  });
});
