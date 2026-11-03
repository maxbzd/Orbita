import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getStoredSettings, resetSettings, updateSettings } from '../../db';
import { useCloud } from '../../sync/service';
import { ToastProvider } from '../../ui';
import { CloudKeySheet } from './CloudKeySheet';

const draw = () =>
  render(
    <ToastProvider>
      <CloudKeySheet open onClose={() => undefined} />
    </ToastProvider>,
  );

beforeEach(async () => {
  await resetSettings();
  useCloud.setState({ status: 'idle', error: null });
});

describe('the cloud encryption sheet', () => {
  it('turning it on shows the recovery key once, stores the key on the device only, and then offers to add a device', async () => {
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Включить' }));
    const key = await screen.findByTestId('recovery-key');
    expect(key.textContent).toMatch(/^([0-9A-Z]{5}-){10}[0-9A-Z]{5}$/);
    expect((await getStoredSettings()).e2e?.id).toBeTruthy();
    const done = screen.getByRole('button', { name: 'Готово' });
    expect(done).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(done);
    expect(await screen.findByRole('button', { name: 'Добавить устройство' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Показать ключ восстановления' })).toBeInTheDocument();
  });

  it('shows the same recovery key again later', async () => {
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Включить' }));
    const first = (await screen.findByTestId('recovery-key')).textContent;
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Показать ключ восстановления' }));
    await waitFor(() => expect(screen.getByTestId('recovery-key').textContent).toBe(first));
  });

  it('a device that needs the key opens straight on joining, and rejects a key that is not one', async () => {
    useCloud.setState({ status: 'e2e-locked' });
    draw();
    fireEvent.change(await screen.findByLabelText('Ключ восстановления'), { target: { value: 'not a key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Присоединиться по ключу' }));
    expect(await screen.findByText('Это недействительный ключ восстановления.')).toBeInTheDocument();
    expect((await getStoredSettings()).e2e).toBeNull();
  });

  it('offers no way to add a device before there is a key to give', async () => {
    await updateSettings({ e2e: null });
    draw();
    await screen.findByRole('button', { name: 'Включить' });
    expect(screen.queryByRole('button', { name: 'Добавить устройство' })).toBeNull();
  });
});
