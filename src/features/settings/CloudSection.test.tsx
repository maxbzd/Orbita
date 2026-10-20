import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../ui';

const api = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  syncNow: vi.fn(),
  wipeCloud: vi.fn(),
  sendPasswordReset: vi.fn(),
  setNewPassword: vi.fn(),
  resolveAccountConflict: vi.fn(),
}));

vi.mock('../../sync', async () => {
  const real = await vi.importActual<typeof import('../../sync/service')>('../../sync/service');
  return { ...api, useCloud: real.useCloud };
});

import { useCloud } from '../../sync/service';
import { CloudSection } from './CloudSection';

const draw = () =>
  render(
    <ToastProvider>
      <CloudSection />
    </ToastProvider>,
  );

const state = (patch: Partial<ReturnType<typeof useCloud.getState>>) =>
  useCloud.setState({ status: 'signed-out', email: null, userId: null, lastSyncAt: null, lastReport: null, error: null, needsNewPassword: false, ...patch });

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.signIn.mockResolvedValue(undefined);
  api.syncNow.mockResolvedValue(undefined);
  state({});
});

describe('signed out', () => {
  it('checks the fields before asking the server', async () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByText('Проверьте адрес почты.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'max@example.com' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: '123' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Войти' }).at(-1) as HTMLElement);
    expect(await screen.findByText(/Пароль короче 6/)).toBeInTheDocument();
    expect(api.signIn).not.toHaveBeenCalled();
  });

  it('signs in with what was typed and shows the server’s answer when it fails', async () => {
    api.signIn.mockRejectedValueOnce(new Error('Неверная почта или пароль.'));
    draw();
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: ' max@example.com ' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'орбита-2026' } });
    fireEvent.submit(screen.getByLabelText('Пароль').closest('form') as HTMLFormElement);
    expect(await screen.findByText('Неверная почта или пароль.')).toBeInTheDocument();
    expect(api.signIn).toHaveBeenCalledWith('max@example.com', 'орбита-2026');
  });

  it('a new account that needs its mail confirmed says what to do next', async () => {
    api.signUp.mockResolvedValue('confirm-email');
    draw();
    fireEvent.click(screen.getByRole('radio', { name: 'Создать аккаунт' }));
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'max@example.com' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'орбита-2026' } });
    fireEvent.submit(screen.getByLabelText('Пароль').closest('form') as HTMLFormElement);
    expect(await screen.findByText(/Письмо отправлено на max@example.com/)).toBeInTheDocument();
  });

  it('asks for the mail before sending a reset link', async () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Забыли пароль?' }));
    expect(await screen.findByText(/Введите почту выше/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'max@example.com' } });
    api.sendPasswordReset.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Забыли пароль?' }));
    await waitFor(() => expect(api.sendPasswordReset).toHaveBeenCalledWith('max@example.com'));
  });
});

describe('signed in', () => {
  it('shows the account and when it last synced, and syncs on request', async () => {
    state({ status: 'idle', email: 'max@example.com', userId: 'u1', lastSyncAt: Date.now(), lastReport: { pushed: 2, pulled: 5, applied: 3, rejected: 0, audioUp: 0, audioDown: 1 } });
    draw();
    expect(screen.getByText('max@example.com')).toBeInTheDocument();
    expect(screen.getByText(/Синхронизировано сегодня/)).toBeInTheDocument();
    expect(screen.getByText(/получено: 3, отправлено: 2, аудио: 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Синхронизировать' }));
    expect(api.syncNow).toHaveBeenCalledWith({ push: true });
  });

  it('says plainly when there is no connection', () => {
    state({ status: 'offline', email: 'max@example.com', userId: 'u1' });
    draw();
    expect(screen.getByText(/Нет соединения/)).toBeInTheDocument();
  });

  it('signing out and deleting the cloud copy both ask first', async () => {
    state({ status: 'idle', email: 'max@example.com', userId: 'u1' });
    api.signOut.mockResolvedValue(undefined);
    api.wipeCloud.mockResolvedValue(undefined);
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    expect(api.signOut).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Выйти' })).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button', { name: 'Выйти' }).at(-1) as HTMLElement);
    await waitFor(() => expect(api.signOut).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Удалить из облака' }));
    expect(api.wipeCloud).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Удалить из облака' }).at(-1) as HTMLElement);
    await waitFor(() => expect(api.wipeCloud).toHaveBeenCalled());
  });
});

describe('special states', () => {
  it('another account’s data on the device is not mixed in without a choice', async () => {
    state({ status: 'account-conflict', email: 'max@example.com', userId: 'u2' });
    api.resolveAccountConflict.mockResolvedValue(undefined);
    draw();
    fireEvent.click(screen.getByRole('button', { name: /Очистить устройство/ }));
    await waitFor(() => expect(api.resolveAccountConflict).toHaveBeenCalledWith('replace'));
    fireEvent.click(screen.getByRole('button', { name: /Объединить/ }));
    await waitFor(() => expect(api.resolveAccountConflict).toHaveBeenCalledWith('merge'));
  });

  it('a reset link opens the new-password form', async () => {
    state({ status: 'idle', email: 'max@example.com', userId: 'u1', needsNewPassword: true });
    api.setNewPassword.mockResolvedValue(undefined);
    draw();
    fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: 'новый-пароль-1' } });
    fireEvent.submit(screen.getByLabelText('Новый пароль').closest('form') as HTMLFormElement);
    await waitFor(() => expect(api.setNewPassword).toHaveBeenCalledWith('новый-пароль-1'));
  });
});
