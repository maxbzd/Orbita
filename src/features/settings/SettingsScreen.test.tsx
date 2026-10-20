import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturesRepo, getSettings, getStoredSettings, profileRepo, setSessionSecrets, wipeAll } from '../../db';
import { PBKDF2_MIN_ITERATIONS } from '../../domain/schemas';
import { ThemeProvider } from '../../styles/theme';
import { ToastProvider } from '../../ui';
import { initLock, setLockIterations, useLockStore } from '../lock';
import SettingsScreen from './SettingsScreen';

const { testConnection } = vi.hoisted(() => ({ testConnection: vi.fn() }));
vi.mock('../../ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ai')>()),
  createLlmProvider: vi.fn(() => ({ id: 'mock', test: testConnection })),
}));

function renderScreen() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter>
          <SettingsScreen />
        </MemoryRouter>
      </ToastProvider>
    </ThemeProvider>,
  );
}

beforeEach(async () => {
  setLockIterations(PBKDF2_MIN_ITERATIONS);
  await wipeAll();
  setSessionSecrets(null);
  await initLock();
  testConnection.mockReset();
});

afterEach(() => {
  document.head.querySelectorAll('meta[http-equiv]').forEach((tag) => tag.remove());
});

describe('settings are saved and merged', () => {
  it('stores a switch, a segment and the looks, each without touching the others', async () => {
    renderScreen();
    const audio = await screen.findByRole('switch', { name: /Хранить аудио/ });
    expect(audio).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(audio);
    await waitFor(async () => expect((await getSettings()).capture.keepAudio).toBe(false));

    fireEvent.click(screen.getByRole('radio', { name: 'Минимум' }));
    fireEvent.click(screen.getByRole('switch', { name: /Меньше движения/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Рассвет' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Инициалы' }));
    await waitFor(async () => {
      const settings = await getSettings();
      expect(settings.ui).toEqual({ effects: 'min', reduceMotion: true });
      expect(settings.theme).toBe('light');
      expect(settings.privacy.contextLevel).toBe('initials');
      expect(settings.capture.keepAudio).toBe(false);
      expect(settings.capture.walkMode).toBe(true);
    });
  });

  it('shows the threshold only while auto-accept is on and saves it', async () => {
    renderScreen();
    expect(screen.queryByRole('radiogroup', { name: 'Порог уверенности' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('switch', { name: /Принимать уверенное/ }));
    fireEvent.click(await screen.findByRole('radio', { name: '95%' }));
    await waitFor(async () => expect((await getSettings()).autoAccept).toEqual({ enabled: true, minConfidence: 0.95 }));
  });
});

describe('AI keys', () => {
  it('saves a key, shows it masked and never in full', async () => {
    renderScreen();
    const input = await screen.findByLabelText('Ключ Anthropic');
    fireEvent.change(input, { target: { value: 'sk-ant-api03-SECRETSECRET-a3f9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить ключ' }));

    expect(await screen.findByText('••••••••a3f9')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('SECRETSECRET');
    expect(screen.queryByDisplayValue(/SECRET/)).not.toBeInTheDocument();
    expect((await getSettings()).ai.anthropic.apiKey).toBe('sk-ant-api03-SECRETSECRET-a3f9');

    fireEvent.click(screen.getByRole('button', { name: 'Удалить: Ключ Anthropic' }));
    await waitFor(async () => expect((await getSettings()).ai.anthropic.apiKey).toBe(''));
  });

  it('explains the CSP limit for a host that is not on the list, in plain words', async () => {
    const meta = document.createElement('meta');
    meta.setAttribute('http-equiv', 'Content-Security-Policy');
    meta.setAttribute('content', "default-src 'self'; connect-src 'self' https://api.openai.com");
    document.head.append(meta);

    renderScreen();
    fireEvent.click(await screen.findByRole('radio', { name: 'OpenAI-совм.' }));
    const url = await screen.findByLabelText('Адрес сервера (baseUrl)');
    expect(screen.queryByText('Этот адрес браузер пока заблокирует')).not.toBeInTheDocument();

    fireEvent.change(url, { target: { value: 'https://llm.example.org/v1' } });
    fireEvent.blur(url);
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('Этот адрес браузер пока заблокирует');
    expect(note).toHaveTextContent('index.html');
    expect(within(note).getByText('https://llm.example.org')).toBeInTheDocument();
    await waitFor(async () => expect((await getSettings()).ai.openaiCompat.baseUrl).toBe('https://llm.example.org/v1'));
  });

  it('checks the connection and tells the result', async () => {
    testConnection.mockResolvedValueOnce({ ok: true, message: 'Соединение есть: модель отвечает.' });
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Проверить соединение' }));
    expect(await screen.findByText('Соединение есть: модель отвечает.')).toBeInTheDocument();

    testConnection.mockRejectedValueOnce(new Error('сеть упала'));
    fireEvent.click(screen.getByRole('button', { name: 'Проверить соединение' }));
    expect(await screen.findByText(/Не удалось/)).toBeInTheDocument();
  });
});

describe('glossary', () => {
  it('adds a typed term and a suggested one, and removes one', async () => {
    renderScreen();
    fireEvent.change(await screen.findByLabelText('Новый термин'), { target: { value: 'ретроспектива' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    fireEvent.click(await screen.findByRole('button', { name: '+ OKR' }));
    await waitFor(async () => expect((await profileRepo.get()).glossary.map((e) => e.term)).toEqual(['ретроспектива', 'OKR']));

    fireEvent.click(await screen.findByRole('button', { name: 'Убрать термин «ретроспектива»' }));
    await waitFor(async () => expect((await profileRepo.get()).glossary.map((e) => e.term)).toEqual(['OKR']));
  });
});

describe('lock', () => {
  it('turns on with a password (keys leave the stored settings) and off again', async () => {
    renderScreen();
    fireEvent.click(await screen.findByLabelText('Ключ Anthropic').then(() => screen.getByRole('button', { name: 'Включить блокировку' })));
    const sheet = await screen.findByRole('dialog', { name: 'Включить блокировку' });
    fireEvent.change(within(sheet).getByLabelText('Новый пароль'), { target: { value: 'орбита-1' } });
    fireEvent.change(within(sheet).getByLabelText('Повторите'), { target: { value: 'другое-2' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Включить блокировку' }));
    expect(await within(sheet).findByText('Повтор не совпадает.')).toBeInTheDocument();
    expect((await getStoredSettings()).lock.enabled).toBe(false);

    fireEvent.change(within(sheet).getByLabelText('Повторите'), { target: { value: 'орбита-1' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Включить блокировку' }));
    await waitFor(async () => expect((await getStoredSettings()).lock.enabled).toBe(true));
    expect(useLockStore.getState().status).toBe('unlocked');
    expect(await screen.findByRole('button', { name: 'Заблокировать сейчас' })).toBeInTheDocument();
  });
});

describe('dangerous actions ask for the word', () => {
  it('erase-all stays disabled until «удалить» is typed, then wipes the data', async () => {
    await capturesRepo.create({ kind: 'text', text: 'Запись' });
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить всё' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Удалить всё?' });
    const confirm = within(dialog).getByRole('button', { name: 'Удалить всё' });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/введите «удалить»/), { target: { value: 'удалит' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/введите «удалить»/), { target: { value: 'Удалить' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(async () => expect(await capturesRepo.list()).toHaveLength(0));
  });

  it('deleting raw material is a separate action that keeps the text', async () => {
    const capture = await capturesRepo.create({ kind: 'text', text: 'Итоговый текст', rawText: 'исходный' });
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить сырьё' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('исходных текстов 1');
    fireEvent.change(within(dialog).getByLabelText(/введите «удалить»/), { target: { value: 'удалить' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить сырьё' }));
    await waitFor(async () => expect((await capturesRepo.get(capture.id))?.rawText).toBeUndefined());
    expect((await capturesRepo.get(capture.id))?.text).toBe('Итоговый текст');
  });
});
